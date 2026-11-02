'use strict';

/**
 * Cross-platform checks for the ESC/POS builder and the loopback HTTP API.
 * Run with: npm run test:print-helper
 *
 * Windows RAW spooler calls are mocked here; the actual spooler path must be
 * tested on the Windows 10 POS machine (see electron/print-helper/README.md).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { buildReceiptEscPos, buildTestEscPos, sanitizeText } = require('./escpos');
const { createPrintServer } = require('./printServer');
const { createPrinterService } = require('./printerService');

const ALLOWED_ORIGIN = 'https://pos.gsmpilot.com';
const TOKEN = 'selftest-token';

const receipt = {
  orderNumber: 1042,
  date: '2026-10-31T12:34:00.000Z',
  restaurant: {
    name: 'Dimlight Cafe',
    address: 'Main Boulevard, Gulberg III, Lahore',
    phone: '+92 (42) 3578-9000',
  },
  server: 'Alex Morgan',
  orderType: 'Dine In',
  customerName: 'Ali Khan',
  customerPhone: '+92 300 1234567',
  notes: 'No onions - extra spicy',
  items: [
    { name: 'Chicken Karahi', quantity: 2, unitPrice: 1250, total: 2500, notes: 'Less oil' },
    {
      name: 'Deal Platter',
      quantity: 1,
      unitPrice: 999,
      total: 999,
      dealComponents: ['1x Naan', '1x Drink'],
    },
  ],
  subtotal: 3499,
  tax: 349.9,
  taxRate: 10,
  serviceCharge: 100,
  total: 3948.9,
  totalPaid: 4000,
  change: 51.1,
  paymentMethod: 'CASH',
};

function countPartialCuts(buffer) {
  let count = 0;
  for (let index = 0; index < buffer.length - 2; index += 1) {
    if (buffer[index] === 0x1d && buffer[index + 1] === 0x56 && buffer[index + 2] === 0x01) {
      count += 1;
    }
  }
  return count;
}

function request(port, method, pathname, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  const both = buildReceiptEscPos(receipt, { mode: 'BOTH', openDrawer: true });
  assert.strictEqual(countPartialCuts(both), 2, 'BOTH should have exactly two cuts');
  assert(
    both.includes(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])),
    'cash drawer command should be present'
  );

  const bothText = both.toString('ascii');
  assert(bothText.includes('DIMLIGHT CAFE'), 'restaurant name should be printed');
  assert(bothText.includes('Ali Khan'), 'customer name should be printed');
  assert(bothText.includes('+92 300 1234567'), 'customer mobile should be printed');
  assert(bothText.includes('KITCHEN ORDER TICKET'), 'kitchen slip should be printed');
  assert(bothText.includes('Chicken Karahi'), 'item should be printed');
  assert.strictEqual(countPartialCuts(buildReceiptEscPos(receipt, { mode: 'CUSTOMER' })), 1);
  assert(buildTestEscPos({ printerName: 'Test' }).length > 0);
  assert.strictEqual(sanitizeText('Deal - extra'), 'Deal - extra');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpos-selftest-'));
  let sent = null;
  const service = createPrinterService({
    userDataPath: tempDir,
    sendRaw: async (printerName, buffer) => {
      sent = { printerName, buffer };
    },
    listPrinters: async () => ['Black Copper BC-88AC'],
  });

  service.updateSettings({ printerName: 'Black Copper BC-88AC', token: TOKEN, columns: 48 });
  const printResult = await service.print({ receipt, mode: 'BOTH', openDrawer: true });
  assert(printResult.ok);
  assert.strictEqual(sent.printerName, 'Black Copper BC-88AC');
  assert(sent.buffer.length > 100);
  assert.deepStrictEqual(await service.getPrinters(), ['Black Copper BC-88AC']);

  const mockService = {
    getSettings: () => ({ token: TOKEN, printerName: 'Test' }),
    getStatus: () => ({
      ok: true,
      app: 'restaurant-pos-print-helper',
      printerName: 'Test',
      configured: true,
    }),
    getPrinters: async () => ['Test'],
    print: async (payload) => ({ ok: true, message: 'printed', mode: payload.mode }),
    testPrint: async () => ({ ok: true, message: 'test printed' }),
  };

  const server = createPrintServer({ service: mockService, port: 0 });
  const { port } = await server.start();

  try {
    let response = await request(port, 'OPTIONS', '/print', {
      Origin: ALLOWED_ORIGIN,
      Host: `127.0.0.1:${port}`,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-print-token',
      'Access-Control-Request-Private-Network': 'true',
    });
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
    assert.strictEqual(response.headers['access-control-allow-private-network'], 'true');
    assert.strictEqual(
      response.headers['access-control-allow-headers'],
      'Content-Type, X-Print-Token'
    );

    response = await request(port, 'OPTIONS', '/print', {
      Origin: 'https://evil.example',
      Host: `127.0.0.1:${port}`,
    });
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.headers['access-control-allow-origin'], undefined);

    response = await request(port, 'GET', '/status', {
      Origin: ALLOWED_ORIGIN,
      Host: `127.0.0.1:${port}`,
    });
    assert.strictEqual(response.status, 401);

    response = await request(port, 'GET', '/status', {
      Origin: ALLOWED_ORIGIN,
      Host: `127.0.0.1:${port}`,
      'X-Print-Token': TOKEN,
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).app, 'restaurant-pos-print-helper');

    response = await request(port, 'GET', '/status', {
      Origin: 'https://evil.example',
      Host: `127.0.0.1:${port}`,
      'X-Print-Token': TOKEN,
    });
    assert.strictEqual(response.status, 403);

    response = await request(port, 'GET', '/status', {
      Origin: ALLOWED_ORIGIN,
      Host: `evil.example:${port}`,
      'X-Print-Token': TOKEN,
    });
    assert.strictEqual(response.status, 403);

    response = await request(
      port,
      'POST',
      '/print',
      {
        Origin: ALLOWED_ORIGIN,
        Host: `127.0.0.1:${port}`,
        'X-Print-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ receipt, mode: 'BOTH' })
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).mode, 'BOTH');

    response = await request(
      port,
      'POST',
      '/test-print',
      {
        Origin: ALLOWED_ORIGIN,
        Host: `127.0.0.1:${port}`,
        'X-Print-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      '{}'
    );
    assert.strictEqual(response.status, 200);
  } finally {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Print helper self-test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
