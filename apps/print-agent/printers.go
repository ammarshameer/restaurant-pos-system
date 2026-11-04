package main

// Printer is an installed OS print queue.
type Printer struct {
	Name    string `json:"name"`
	Default bool   `json:"default"`
}
