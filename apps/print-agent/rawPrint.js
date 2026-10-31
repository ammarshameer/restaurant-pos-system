'use strict';

// Sends raw bytes to an installed printer through the OS spooler.
// Windows: winspool (PowerShell). Linux/macOS: CUPS `lp -o raw`.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().trim()));
      resolve(stdout.toString());
    });
  });

const PS_RAW = `
param([string]$Printer, [string]$File)
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
      var di = new DOCINFO { pDocName = "POS Receipt", pDataType = "RAW" };
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
`;

async function listPrinters() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Printer | ForEach-Object { "$($_.Name)|$($_.Default)" }',
    ]);
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [name, def] = l.split('|');
        return { name, default: def === 'True' };
      });
  }
  let names = [];
  try {
    names = (await run('lpstat', ['-e'])).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
  let def = '';
  try {
    def = (await run('lpstat', ['-d'])).split(':')[1]?.trim() || '';
  } catch {
    /* no default */
  }
  return names.map((name) => ({ name, default: name === def }));
}

async function rawPrint(printerName, data) {
  const printers = await listPrinters();
  const name = printerName || printers.find((p) => p.default)?.name || printers[0]?.name;
  if (!name) throw new Error('No printer installed on this machine');
  if (printerName && printers.length && !printers.some((p) => p.name === printerName)) {
    throw new Error(`Printer "${printerName}" not found. Available: ${printers.map((p) => p.name).join(', ')}`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-print-'));
  const file = path.join(dir, 'job.bin');
  fs.writeFileSync(file, data);
  try {
    if (process.platform === 'win32') {
      const script = path.join(dir, 'raw.ps1');
      fs.writeFileSync(script, PS_RAW);
      await run('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Printer',
        name,
        '-File',
        file,
      ]);
    } else {
      await run('lp', ['-d', name, '-o', 'raw', file]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return name;
}

module.exports = { rawPrint, listPrinters };
