//go:build !windows

package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return "", errors.New(msg)
		}
		return stdout.String(), nil
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		return "", fmt.Errorf("%s timed out", name)
	}
}

// listPrinters enumerates installed CUPS queues via lpstat.
func listPrinters() ([]Printer, error) {
	out, err := run("lpstat", "-e")
	if err != nil {
		return nil, err
	}
	def := ""
	if d, err := run("lpstat", "-d"); err == nil {
		if i := strings.Index(d, ":"); i >= 0 {
			def = strings.TrimSpace(d[i+1:])
		}
	}
	printers := []Printer{}
	for _, name := range strings.Split(out, "\n") {
		name = strings.TrimSpace(name)
		if name != "" {
			printers = append(printers, Printer{Name: name, Default: name == def})
		}
	}
	return printers, nil
}

// rawPrint spools data verbatim to the named (or default) queue via `lp -o raw`.
func rawPrint(printerName string, data []byte) (string, error) {
	printers, _ := listPrinters()
	name := printerName
	if name == "" {
		for _, p := range printers {
			if p.Default {
				name = p.Name
				break
			}
		}
		if name == "" && len(printers) > 0 {
			name = printers[0].Name
		}
	}
	if name == "" {
		return "", errors.New("no printer installed on this machine")
	}
	if printerName != "" && len(printers) > 0 {
		found := false
		for _, p := range printers {
			if p.Name == printerName {
				found = true
				break
			}
		}
		if !found {
			available := make([]string, len(printers))
			for i, p := range printers {
				available[i] = p.Name
			}
			return "", fmt.Errorf("printer %q not found; available: %s", printerName, strings.Join(available, ", "))
		}
	}

	dir, err := os.MkdirTemp("", "print-agent-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	job := filepath.Join(dir, "job.bin")
	if err := os.WriteFile(job, data, 0o600); err != nil {
		return "", err
	}
	if _, err := run("lp", "-d", name, "-o", "raw", job); err != nil {
		return "", err
	}
	return name, nil
}
