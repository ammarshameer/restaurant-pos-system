package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
)

func testConfig() config {
	return config{
		port:           17778,
		printerName:    "POS-80",
		token:          "test-token",
		allowedOrigins: map[string]bool{"https://pos.example.com": true},
	}
}

type printRecorder struct {
	calls   int
	printer string
	data    []byte
}

func (p *printRecorder) rawPrint(printer string, data []byte) (string, error) {
	p.calls++
	p.printer = printer
	p.data = append([]byte(nil), data...)
	return printer, nil
}

func testHandler(cfg config, rec *printRecorder) http.Handler {
	return newHandler(
		cfg,
		func() ([]Printer, error) {
			return []Printer{{Name: "POS-80", Default: true}}, nil
		},
		rec.rawPrint,
	)
}

func requestToAgent(method, path, body string, headers map[string]string) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:17778"+path, strings.NewReader(body))
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	return r
}

func perform(handler http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}
