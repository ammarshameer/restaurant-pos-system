// Generic local print bridge. Runs on the machine that owns the printer and
// exposes a small loopback HTTP API that ANY client (browser page, app, script)
// can call to list installed printers and spool raw bytes to them.
// Single static binary — no runtime, no dependencies.
//
//	GET  /health    {success, app, version, port}
//	GET  /printers  {success, printers: [{name, default}]}
//	POST /print     {printer?, dataBase64 | dataHex | text} -> raw spool job
//	                (ESC/POS, ZPL, TSPL — any printer language)
//
// Configuration (all optional): env vars, or print-agent-config.json next to
// the binary: {"port":17778,"printerName":"POS-80","token":"...",
// "allowedOrigins":["https://example.com"]}
//
//	PORT                   listen port (default 17778; any free port works)
//	PRINTER_NAME           fallback printer when the request names none
//	PRINT_TOKEN            if set, POST /print requires X-Print-Token: <token>
//	PRINT_ALLOWED_ORIGINS  optional comma-separated browser-origin allowlist;
//	                       unset = any origin may call the bridge
package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	appID   = "local-print-agent"
	version = "1.0.0"
	maxBody = 8 << 20 // 8 MiB
)

type fileConfig struct {
	Port           int      `json:"port"`
	PrinterName    string   `json:"printerName"`
	Token          string   `json:"token"`
	AllowedOrigins []string `json:"allowedOrigins"`
}

type config struct {
	port           int
	printerName    string
	token          string
	allowedOrigins map[string]bool
}

func loadConfig() config {
	exe, _ := os.Executable()
	fc := fileConfig{}
	for _, dir := range []string{filepath.Dir(exe), "."} {
		data, err := os.ReadFile(filepath.Join(dir, "print-agent-config.json"))
		if err == nil {
			_ = json.Unmarshal(data, &fc)
			break
		}
	}

	cfg := config{
		port:           fc.Port,
		printerName:    fc.PrinterName,
		token:          fc.Token,
		allowedOrigins: map[string]bool{},
	}
	for _, o := range fc.AllowedOrigins {
		if o = strings.TrimSpace(o); o != "" {
			cfg.allowedOrigins[o] = true
		}
	}
	if v := os.Getenv("PORT"); v != "" {
		var p int
		if _, err := fmt.Sscanf(v, "%d", &p); err == nil && p > 0 {
			cfg.port = p
		}
	}
	if v := os.Getenv("PRINTER_NAME"); v != "" {
		cfg.printerName = v
	}
	if v := os.Getenv("PRINT_TOKEN"); v != "" {
		cfg.token = v
	}
	if v := os.Getenv("PRINT_ALLOWED_ORIGINS"); v != "" {
		cfg.allowedOrigins = map[string]bool{}
		for _, o := range strings.Split(v, ",") {
			if o = strings.TrimSpace(o); o != "" {
				cfg.allowedOrigins[o] = true
			}
		}
	}
	if cfg.port == 0 {
		cfg.port = 17778
	}
	return cfg
}

var cfg = loadConfig()

func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "*")
	// Lets an https-hosted page reach this loopback service from Chromium.
	h.Set("Access-Control-Allow-Private-Network", "true")
	origin := r.Header.Get("Origin")
	if len(cfg.allowedOrigins) == 0 {
		h.Set("Access-Control-Allow-Origin", "*")
	} else if cfg.allowedOrigins[origin] {
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Vary", "Origin")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || len(cfg.allowedOrigins) == 0 || cfg.allowedOrigins[origin]
}

func authorized(r *http.Request) bool {
	return cfg.token == "" || r.Header.Get("X-Print-Token") == cfg.token
}

type printRequest struct {
	Printer    string `json:"printer"`
	DataBase64 string `json:"dataBase64"`
	DataHex    string `json:"dataHex"`
	Text       string `json:"text"`
}

func (p *printRequest) decode() ([]byte, error) {
	switch {
	case p.DataBase64 != "":
		return base64.StdEncoding.DecodeString(p.DataBase64)
	case p.DataHex != "":
		return hex.DecodeString(p.DataHex)
	case p.Text != "":
		return []byte(p.Text), nil
	}
	return nil, errors.New("one of dataBase64, dataHex or text is required")
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, map[string]any{
		"success": true, "app": appID, "version": version, "port": cfg.port,
	})
}

func handlePrinters(w http.ResponseWriter, r *http.Request) {
	printers, err := listPrinters()
	if err != nil {
		writeJSON(w, r, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"success": true, "printers": printers})
}

func handlePrint(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		writeJSON(w, r, http.StatusUnauthorized, map[string]any{"success": false, "error": "invalid or missing print token"})
		return
	}
	var req printRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&req); err != nil {
		writeJSON(w, r, http.StatusBadRequest, map[string]any{"success": false, "error": "invalid JSON body"})
		return
	}
	data, err := req.decode()
	if err != nil {
		writeJSON(w, r, http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if len(data) == 0 {
		writeJSON(w, r, http.StatusBadRequest, map[string]any{"success": false, "error": "empty print data"})
		return
	}
	printer := strings.TrimSpace(req.Printer)
	if printer == "" {
		printer = cfg.printerName
	}
	used, err := rawPrint(printer, data)
	if err != nil {
		writeJSON(w, r, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	log.Printf("[print-agent] sent %d bytes to %q", len(data), used)
	writeJSON(w, r, http.StatusOK, map[string]any{"success": true, "printer": used, "bytes": len(data)})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /printers", handlePrinters)
	mux.HandleFunc("POST /print", handlePrint)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !originAllowed(r) {
			writeJSON(w, r, http.StatusForbidden, map[string]any{"success": false, "error": "origin not allowed"})
			return
		}
		if r.Method == http.MethodOptions {
			writeJSON(w, r, http.StatusNoContent, map[string]any{})
			return
		}
		mux.ServeHTTP(w, r)
	})

	// Loopback only: the bridge is never reachable from the network.
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.port)
	log.Printf("[print-agent] %s v%s listening on http://%s (token auth: %v)",
		appID, version, addr, cfg.token != "")
	if err := http.ListenAndServe(addr, handler); err != nil {
		if strings.Contains(err.Error(), "address already in use") ||
			strings.Contains(err.Error(), "Only one usage") {
			log.Fatalf("[print-agent] port %d is already in use. Stop that process or set PORT to a free port.", cfg.port)
		}
		log.Fatal(err)
	}
}
