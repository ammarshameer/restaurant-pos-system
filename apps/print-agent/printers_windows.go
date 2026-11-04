//go:build windows

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
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		return "", fmt.Errorf("%s timed out", name)
	}
}

// listPrinters enumerates installed Windows printer queues.
func listPrinters() ([]Printer, error) {
	out, err := run("powershell.exe", "-NoProfile", "-Command",
		`Get-CimInstance Win32_Printer | ForEach-Object { "$($_.Name)|$($_.Default)" }`)
	if err != nil {
		return nil, err
	}
	printers := []Printer{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		printers = append(printers, Printer{
			Name:    parts[0],
			Default: len(parts) > 1 && parts[1] == "True",
		})
	}
	return printers, nil
}

// rawPrinterScript sends bytes to an installed printer as a RAW job via winspool.
const rawPrinterScript = `param([string]$Printer, [string]$File)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h, int l, [In] DOCINFO d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Cannot open printer '" + printer + "' (error " + Marshal.GetLastWin32Error() + ")");
    try {
      var di = new DOCINFO { pDocName = "Print Agent Job", pDataType = "RAW" };
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(h);
      int w;
      bool ok = WritePrinter(h, data, data.Length, out w);
      EndPagePrinter(h); EndDocPrinter(h);
      if (!ok) throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")");
    } finally { ClosePrinter(h); }
  }
}
"@
[RawPrinter]::Send($Printer, [System.IO.File]::ReadAllBytes($File))
`

// rawPrint sends data verbatim to the named (or default) Windows printer.
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
	script := filepath.Join(dir, "raw.ps1")
	if err := os.WriteFile(script, []byte(rawPrinterScript), 0o600); err != nil {
		return "", err
	}
	if _, err := run("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
		"-File", script, "-Printer", name, "-File", job); err != nil {
		return "", err
	}
	return name, nil
}
