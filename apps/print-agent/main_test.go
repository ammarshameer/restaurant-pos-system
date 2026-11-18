package main

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
)

func TestDecodeBase64(t *testing.T) {
	payload := []byte{0x1b, 0x40, 'h', 'i', 0x0a}
	req := printRequest{DataBase64: base64.StdEncoding.EncodeToString(payload)}
	got, err := req.decode()
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("got %v, want %v", got, payload)
	}
}

func TestDecodeHex(t *testing.T) {
	req := printRequest{DataHex: "1b400a"}
	got, err := req.decode()
	if err != nil || !bytes.Equal(got, []byte{0x1b, 0x40, 0x0a}) {
		t.Fatalf("got %v err %v", got, err)
	}
}

func TestDecodeText(t *testing.T) {
	req := printRequest{Text: "hello\n"}
	got, err := req.decode()
	if err != nil || string(got) != "hello\n" {
		t.Fatalf("got %q err %v", got, err)
	}
}

func TestDecodeEmpty(t *testing.T) {
	req := printRequest{}
	if _, err := req.decode(); err == nil {
		t.Fatal("expected error for empty payload")
	}
}

func TestOriginPolicyDefaultDeny(t *testing.T) {
	s := &agentServer{cfg: testConfig()}

	if !s.originAllowed(requestToAgent("GET", "/health", "", nil)) {
		t.Fatal("a local non-browser client without Origin should pass the origin gate")
	}
	if !s.originAllowed(requestToAgent("GET", "/health", "", map[string]string{
		"Origin": "https://pos.example.com",
	})) {
		t.Fatal("configured origin should be allowed")
	}
	if s.originAllowed(requestToAgent("GET", "/health", "", map[string]string{
		"Origin": "https://evil.example",
	})) {
		t.Fatal("foreign origin must be rejected")
	}

	s.cfg.allowedOrigins = map[string]bool{}
	if s.originAllowed(requestToAgent("GET", "/health", "", map[string]string{
		"Origin": "https://pos.example.com",
	})) {
		t.Fatal("empty allowlist must allow no browser origins")
	}
}

func TestHostValidation(t *testing.T) {
	s := &agentServer{cfg: testConfig()}
	r := requestToAgent("GET", "/health", "", map[string]string{
		"Origin": "https://pos.example.com",
	})
	if !s.hostAllowed(r) {
		t.Fatal("configured loopback host should be allowed")
	}

	foreign := requestToAgent("GET", "/health", "", map[string]string{
		"Origin": "https://pos.example.com",
	})
	foreign.Host = "evil.example:17778"
	if s.hostAllowed(foreign) {
		t.Fatal("foreign Host must be rejected (DNS rebinding guard)")
	}
}

func TestTokenRequiredWhenNotConfigured(t *testing.T) {
	s := &agentServer{cfg: config{port: 17778, allowedOrigins: map[string]bool{}}}
	r := requestToAgent("POST", "/print", `{"text":"hello"}`, map[string]string{
		"X-Print-Token": "anything",
	})
	if s.authorized(r) {
		t.Fatal("empty configured token must lock protected routes")
	}
}

func TestForeignOriginGets403(t *testing.T) {
	rec := &printRecorder{}
	handler := testHandler(testConfig(), rec)
	r := requestToAgent("POST", "/print", `{"text":"hello"}`, map[string]string{
		"Origin":        "https://evil.example",
		"X-Print-Token": "test-token",
	})
	w := perform(handler, r)

	if w.Code != http.StatusForbidden {
		t.Fatalf("foreign origin: got %d, want 403; body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Header().Get("Access-Control-Allow-Origin"), "evil.example") {
		t.Fatal("foreign origin must not receive a CORS allow header")
	}
	if rec.calls != 0 {
		t.Fatal("foreign origin must not reach the printer")
	}
}

func TestMissingTokenGets401(t *testing.T) {
	rec := &printRecorder{}
	handler := testHandler(testConfig(), rec)
	headers := map[string]string{"Origin": "https://pos.example.com"}

	for _, path := range []string{"/print", "/printers"} {
		method := "GET"
		body := ""
		if path == "/print" {
			method = "POST"
			body = `{"text":"hello"}`
		}
		w := perform(handler, requestToAgent(method, path, body, headers))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s without token: got %d, want 401; body=%s", path, w.Code, w.Body.String())
		}
	}
	if rec.calls != 0 {
		t.Fatal("unauthorized request must not reach the printer")
	}
}

func TestCorrectTokenPrints(t *testing.T) {
	rec := &printRecorder{}
	handler := testHandler(testConfig(), rec)
	payload := []byte{0x1b, 0x40, 'h', 'i', 0x0a}
	body := `{"printer":"POS-80","dataBase64":"` + base64.StdEncoding.EncodeToString(payload) + `"}`
	w := perform(handler, requestToAgent("POST", "/print", body, map[string]string{
		"Origin":        "https://pos.example.com",
		"X-Print-Token": "test-token",
	}))

	if w.Code != http.StatusOK {
		t.Fatalf("authorized print: got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if rec.calls != 1 || rec.printer != "POS-80" || !bytes.Equal(rec.data, payload) {
		t.Fatalf("wrong spool call: calls=%d printer=%q data=%v", rec.calls, rec.printer, rec.data)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://pos.example.com" {
		t.Fatalf("configured origin should get CORS allow header, got %q", got)
	}
}

func TestCorrectTokenListsPrinters(t *testing.T) {
	rec := &printRecorder{}
	handler := testHandler(testConfig(), rec)
	w := perform(handler, requestToAgent("GET", "/printers", "", map[string]string{
		"Origin":        "https://pos.example.com",
		"X-Print-Token": "test-token",
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("printers with token: got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "POS-80") {
		t.Fatalf("printer list missing POS-80: %s", w.Body.String())
	}
}
