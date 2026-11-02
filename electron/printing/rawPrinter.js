'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * PowerShell is an external process, so it cannot read scripts from inside
 * app.asar. electron-builder unpacks this folder via `asarUnpack`, which puts
 * the real files in app.asar.unpacked with the same relative layout.
 */
function resolvePowerShellDir() {
  const dir = path.join(__dirname, 'powershell');
  if (dir.includes('app.asar') && !dir.includes('app.asar.unpacked')) {
    return dir.replace('app.asar', 'app.asar.unpacked');
  }
  return dir;
}

const POWERSHELL_DIR = resolvePowerShellDir();

function runPowerShell(scriptName, args = [], timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(POWERSHELL_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`PowerShell helper script not found: ${scriptPath}`));
      return;
    }

    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        ...args,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore kill errors.
      }
      finish(new Error(`PowerShell print command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    child.on('error', (error) => {
      finish(new Error(`Unable to start Windows PowerShell: ${error.message}`));
    });

    child.on('close', (code) => {
      const output = stdout.trim();
      const errorOutput = stderr.trim();
      if (code === 0) {
        finish(null, output);
      } else {
        finish(
          new Error(
            errorOutput ||
              output ||
              `Windows PowerShell exited with code ${code} while printing.`
          )
        );
      }
    });
  });
}

async function listPrinters() {
  if (process.platform !== 'win32') return [];

  try {
    const output = await runPowerShell('list-printers.ps1', [], 10000);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    throw new Error(`Unable to list Windows printers: ${error.message}`);
  }
}

/**
 * Sends raw ESC/POS bytes to a Windows printer through the spooler's RAW
 * datatype. This bypasses the printer driver's page rendering entirely, so no
 * A4/Letter page or extra blank slip is generated.
 */
async function sendRawToPrinter(printerName, buffer) {
  const name = String(printerName || '').trim();
  if (!name) {
    throw new Error('No printer is configured. Set the printer name in the print helper settings.');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('The ESC/POS print buffer is empty.');
  }
  if (process.platform !== 'win32') {
    throw new Error('Direct RAW printing is only supported on Windows.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpos-print-'));
  const filePath = path.join(tempDir, 'receipt.bin');

  try {
    fs.writeFileSync(filePath, buffer);
    await runPowerShell(
      'raw-print.ps1',
      ['-PrinterName', name, '-FilePath', filePath],
      30000
    );
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Temporary files are cleaned up on the next OS cleanup if this fails.
    }
  }
}

module.exports = {
  runPowerShell,
  listPrinters,
  sendRawToPrinter,
};
