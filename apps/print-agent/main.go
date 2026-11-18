// Secure loopback print bridge. Runs on the machine that owns the printer and
// exposes a small HTTP API for configured clients to list installed printers
// and spool raw bytes to them.
// Single static binary — no runtime, no dependencies.
//
//	GET  /health    {success, app, version, port} — unauthenticated detection
//	GET  /printers  {success, printers: [{name, default}]} — token required
//	POST /print     {printer?, dataBase64 | dataHex | text} — token required
//
// Security defaults:
//   - binds only to 127.0.0.1
//   - an empty allowedOrigins list allows NO browser origins
//   - /printers and /print always require X-Print-Token (empty token = locked)
//   - Host must be localhost/127.0.0.1 on the configured port (DNS rebinding guard)
//
// Configuration: print-agent-config.json next to the binary, or env vars.
// The installer generates a random token and writes the POS origin(s) there.
//
//	PORT                   listen port (default 17778)
//	PRINTER_NAME           fallback printer when the request names none
//	PRINT_TOKEN            required token for /print and /printers
//	PRINT_ALLOWED_ORIGINS  comma-separated exact browser origins; empty = none
package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	appID   = "local-print-agent"
	version = "1.1.0"
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
		token:          strings.TrimSpace(fc.Token),
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
		cfg.token = strings.TrimSpace(v)
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

type printerLister func() ([]Printer, error)
type rawPrintFunc func(printerName string, data []byte) (string, error)

type agentServer struct {
	cfg          config
	listPrinters printerLister
	rawPrint     rawPrintFunc
}

func newHandler(cfg config, list printerLister, raw rawPrintFunc) http.Handler {
	s := &agentServer{cfg: cfg, listPrinters: list, rawPrint: raw}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /printers", s.handlePrinters)
	mux.HandleFunc("POST /print", s.handlePrint)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.hostAllowed(r) {
			s.writeJSON(w, r, http.StatusForbidden, map[string]any{
				"success": false, "error": "host not allowed",
			})
			return
		}
		if !s.originAllowed(r) {
			s.writeJSON(w, r, http.StatusForbidden, map[string]any{
				"success": false, "error": "origin not allowed",
			})
			return
		}
		if r.Method == http.MethodOptions {
			s.setCORS(w, r)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *agentServer) setCORS(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Vary", "Origin")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, X-Print-Token")
	// Lets an https-hosted POS reach this loopback service from Chromium.
	h.Set("Access-Control-Allow-Private-Network", "true")
	origin := r.Header.Get("Origin")
	if origin != "" && s.cfg.allowedOrigins[origin] {
		h.Set("Access-Control-Allow-Origin", origin)
	}
}

func (s *agentServer) writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	s.setCORS(w, r)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// hostAllowed blocks DNS rebinding: only the configured loopback host:port may
// call the agent. Requests without an Origin (CLI, native apps) rely on this
// plus the mandatory token.
func (s *agentServer) hostAllowed(r *http.Request) bool {
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return false
	}
	hostname, port, err := net.SplitHostPort(host)
	if err != nil || port != strconv.Itoa(s.cfg.port) {
		return false
	}
	if ip := net.ParseIP(hostname); ip != nil {
		return ip.IsLoopback()
	}
	return strings.EqualFold(hostname, "localhost")
}

// originAllowed is default-deny: an empty allowlist allows no browser origin.
// Requests with no Origin are local non-browser clients and must additionally
// pass hostAllowed and present a valid token for protected routes.
func (s *agentServer) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return s.cfg.allowedOrigins[origin]
}

func tokenEqual(provided, configured string) bool {
	if configured == "" || provided == "" {
		return false
	}
	a := sha256.Sum256([]byte(provided))
	b := sha256.Sum256([]byte(configured))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

func (s *agentServer) authorized(r *http.Request) bool {
	return tokenEqual(r.Header.Get("X-Print-Token"), s.cfg.token)
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

func (s *agentServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, r, http.StatusOK, map[string]any{
		"success": true, "app": appID, "version": version, "port": s.cfg.port,
	})
}

func (s *agentServer) handlePrinters(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		s.writeJSON(w, r, http.StatusUnauthorized, map[string]any{
			"success": false, "error": "invalid or missing print token",
		})
		return
	}
	printers, err := s.listPrinters()
	if err != nil {
		s.writeJSON(w, r, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	s.writeJSON(w, r, http.StatusOK, map[string]any{"success": true, "printers": printers})
}

func (s *agentServer) handlePrint(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		s.writeJSON(w, r, http.StatusUnauthorized, map[string]any{
			"success": false, "error": "invalid or missing print token",
		})
		return
	}
	var req printRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&req); err != nil {
		s.writeJSON(w, r, http.StatusBadRequest, map[string]any{"success": false, "error": "invalid JSON body"})
		return
	}
	data, err := req.decode()
	if err != nil {
		s.writeJSON(w, r, http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if len(data) == 0 {
		s.writeJSON(w, r, http.StatusBadRequest, map[string]any{"success": false, "error": "empty print data"})
		return
	}
	printer := strings.TrimSpace(req.Printer)
	if printer == "" {
		printer = s.cfg.printerName
	}
	used, err := s.rawPrint(printer, data)
	if err != nil {
		s.writeJSON(w, r, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	log.Printf("[print-agent] sent %d bytes to %q", len(data), used)
	s.writeJSON(w, r, http.StatusOK, map[string]any{"success": true, "printer": used, "bytes": len(data)})
}

func main() {
	cfg := loadConfig()
	handler := newHandler(cfg, listPrinters, rawPrint)

	// Loopback only: the bridge is never reachable from the network.
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.port)
	tokenState := "configured"
	if cfg.token == "" {
		tokenState = "NOT CONFIGURED - protected routes will return 401"
	}
	log.Printf("[print-agent] %s v%s listening on http://%s (token: %s, allowed origins: %d)",
		appID, version, addr, tokenState, len(cfg.allowedOrigins))
	if err := http.ListenAndServe(addr, handler); err != nil {
		if strings.Contains(err.Error(), "address already in use") ||
			strings.Contains(err.Error(), "Only one usage") {
			log.Fatalf("[print-agent] port %d is already in use. Stop that process or set PORT to a free port.", cfg.port)
		}
		log.Fatal(err)
	}
}
