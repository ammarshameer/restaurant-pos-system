package main

import (
	"net/http"
	"net/http/httptest"
)

func reqWithOrigin(origin string) *http.Request {
	r := httptest.NewRequest("GET", "/health", nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

func reqWithToken(token string) *http.Request {
	r := httptest.NewRequest("POST", "/print", nil)
	if token != "" {
		r.Header.Set("X-Print-Token", token)
	}
	return r
}
