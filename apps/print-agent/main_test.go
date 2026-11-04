package main

import (
	"bytes"
	"encoding/base64"
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

func TestOriginPolicy(t *testing.T) {
	orig := cfg.allowedOrigins
	defer func() { cfg.allowedOrigins = orig }()

	cfg.allowedOrigins = map[string]bool{}
	r := reqWithOrigin("https://anything.example")
	if !originAllowed(r) {
		t.Fatal("open bridge should allow any origin")
	}

	cfg.allowedOrigins = map[string]bool{"https://pos.example.com": true}
	if originAllowed(reqWithOrigin("https://evil.example")) {
		t.Fatal("allowlist should reject foreign origins")
	}
	if !originAllowed(reqWithOrigin("https://pos.example.com")) {
		t.Fatal("allowlist should accept listed origins")
	}
}

func TestTokenAuth(t *testing.T) {
	tok := cfg.token
	defer func() { cfg.token = tok }()

	cfg.token = ""
	if !authorized(reqWithToken("")) {
		t.Fatal("no token configured should mean open")
	}
	cfg.token = "s3cret"
	if authorized(reqWithToken("wrong")) || authorized(reqWithToken("")) {
		t.Fatal("wrong/missing token must be rejected")
	}
	if !authorized(reqWithToken("s3cret")) {
		t.Fatal("correct token must be accepted")
	}
}
