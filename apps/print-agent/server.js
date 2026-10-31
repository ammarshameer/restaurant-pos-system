'use strict';

// Local thermal print agent. Run on the machine the printer is installed on.
//   PRINTER_NAME  OS printer name (default: system default printer)
//   PRINT_COLS    characters per line: 48 for 80mm (default), 32 for 58mm
//   CUT_MODE      partial (default) | full | none
//   PORT          default 3001
// Windows/Linux/macOS supported; no npm dependencies.

const http = require('http');
const { buildJob } = require('./escpos');
const { rawPrint, listPrinters } = require('./rawPrint');

const PORT = Number(process.env.PORT) || 3001;
const COLS = Number(process.env.PRINT_COLS) || 48;
const CUT_MODE = process.env.CUT_MODE || 'partial';
const DEFAULT_PRINTER = process.env.PRINTER_NAME || '';
const MODES = ['BOTH', 'CUSTOMER', 'KITCHEN'];

const send = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Lets an https-hosted POS reach this loopback service from Chrome.
    'Access-Control-Allow-Private-Network': 'true',
  });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { success: true });
    if (req.method === 'GET' && req.url === '/printers') {
      return send(res, 200, { success: true, printers: await listPrinters() });
    }
    if (req.method === 'POST' && req.url === '/print') {
      const { receiptData, mode = 'BOTH', printer } = JSON.parse((await readBody(req)) || '{}');
      if (!receiptData || !Array.isArray(receiptData.items)) {
        return send(res, 400, { success: false, error: 'receiptData with items is required' });
      }
      if (!MODES.includes(mode)) return send(res, 400, { success: false, error: 'Invalid mode' });
      const data = buildJob(receiptData, mode, { cols: COLS, cutMode: CUT_MODE });
      const used = await rawPrint(printer || DEFAULT_PRINTER, data);
      console.log(`[print-agent] sent ${mode} (${data.length} bytes) to "${used}"`);
      return send(res, 200, { success: true, printer: used });
    }
    send(res, 404, { success: false, error: 'Not found' });
  } catch (err) {
    console.error('[print-agent]', err.message);
    send(res, 500, { success: false, error: err.message });
  }
});

// Loopback only: the printer must not be reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[print-agent] listening on http://127.0.0.1:${PORT} (cols=${COLS}, cut=${CUT_MODE})`);
});
