'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { DEFAULT_PORT, ALLOWED_ORIGINS } = require('./constants');
const { createPrinterService } = require('./printerService');

const LOOPBACK_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin);
}

function isAllowedHost(hostHeader, port) {
  const host = String(hostHeader || '').toLowerCase();
  return host === `${LOOPBACK_HOST}:${port}` || host === `localhost:${port}`;
}

function safeTokenEqual(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function hasValidToken(req, expectedToken) {
  return safeTokenEqual(req.headers['x-print-token'], expectedToken);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Print-Token');
  res.setHeader('Access-Control-Max-Age', '600');
  // Required by Chromium's Private Network Access checks for a public HTTPS
  // page calling a loopback helper.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('Request body is too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('Invalid JSON request body.');
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

/**
 * Loopback-only HTTP API used by https://pos.gsmpilot.com.
 *
 * Security layers:
 *  - binds only to 127.0.0.1
 *  - exact Origin allow-list (no wildcards)
 *  - shared X-Print-Token header on every API request
 *  - Host header check to reduce DNS-rebinding risk
 */
function createPrintServer(options = {}) {
  const service =
    options.service ||
    createPrinterService({
      userDataPath: options.userDataPath,
      sendRaw: options.sendRaw,
      listPrinters: options.listPrinters,
    });

  const desiredPort = options.port === undefined ? DEFAULT_PORT : Number(options.port);
  let listeningPort = desiredPort;

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;

    try {
      // CORS preflight (including Chrome/Edge Private Network Access).
      if (req.method === 'OPTIONS') {
        if (!isAllowedHost(req.headers.host, listeningPort) || !isAllowedOrigin(origin)) {
          res.statusCode = 403;
          res.end('Origin not allowed');
          return;
        }
        setCorsHeaders(req, res);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (!isAllowedHost(req.headers.host, listeningPort)) {
        res.statusCode = 403;
        res.end('Invalid Host');
        return;
      }

      setCorsHeaders(req, res);

      if (!isAllowedOrigin(origin)) {
        sendJson(res, 403, {
          ok: false,
          error: 'Origin not allowed. This helper only accepts https://pos.gsmpilot.com.',
        });
        return;
      }

      if (!hasValidToken(req, service.getSettings().token)) {
        sendJson(res, 401, { ok: false, error: 'Invalid or missing print token.' });
        return;
      }

      const requestUrl = new URL(req.url || '/', `http://${req.headers.host}`);

      if (req.method === 'GET' && (requestUrl.pathname === '/status' || requestUrl.pathname === '/health')) {
        sendJson(res, 200, service.getStatus());
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/printers') {
        const printers = await service.getPrinters();
        sendJson(res, 200, { ok: true, printers });
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/print') {
        const payload = await readJsonBody(req);
        const result = await service.print(payload);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/test-print') {
        const result = await service.testPrint();
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found.' });
    } catch (error) {
      if (res.headersSent) return;
      const statusCode = error.statusCode || 500;
      sendJson(res, statusCode, { ok: false, error: error.message });
    }
  });

  function start() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('error', onError);
        reject(error);
      };

      server.once('error', onError);
      server.listen(desiredPort, LOOPBACK_HOST, () => {
        server.removeListener('error', onError);
        const address = server.address();
        listeningPort = typeof address === 'object' && address ? address.port : desiredPort;
        console.log(
          `[Print Helper] Listening on http://${LOOPBACK_HOST}:${listeningPort} (origin: ${ALLOWED_ORIGINS.join(', ')})`
        );
        resolve({ host: LOOPBACK_HOST, port: listeningPort });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  return {
    service,
    start,
    stop,
    getPort: () => listeningPort,
    getStatus: () => service.getStatus(),
  };
}

module.exports = {
  createPrintServer,
  isAllowedOrigin,
  isAllowedHost,
  hasValidToken,
  setCorsHeaders,
};
