'use strict';

const assert = require('assert');
const { buildJob } = require('./escpos');

const receipt = {
  orderNumber: 12,
  restaurant: { name: 'Test Cafe', address: 'Main Blvd', phone: '123' },
  items: [{ name: 'Burger \u21b3 Deluxe', quantity: 2, unitPrice: 500, total: 1000, notes: 'no onion' }],
  subtotal: 1000,
  total: 1000,
};

const count = (buf, seq) => {
  let n = 0;
  for (let i = 0; i <= buf.length - seq.length; i++) if (seq.every((b, j) => buf[i + j] === b)) n++;
  return n;
};

const PARTIAL_CUT = [0x1d, 0x56, 66, 3];
assert.strictEqual(count(buildJob(receipt, 'BOTH'), PARTIAL_CUT), 2);
assert.strictEqual(count(buildJob(receipt, 'CUSTOMER'), PARTIAL_CUT), 1);
assert.strictEqual(count(buildJob(receipt, 'KITCHEN'), PARTIAL_CUT), 1);
assert.strictEqual(count(buildJob(receipt, 'BOTH', { cutMode: 'full' }), [0x1d, 0x56, 65, 3]), 2);
assert.strictEqual(count(buildJob(receipt, 'BOTH', { cutMode: 'none' }), [0x1d, 0x56]), 0);
console.log('print-agent tests passed');
