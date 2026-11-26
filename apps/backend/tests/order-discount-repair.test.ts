import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planRepair,
  type CandidateOrder,
} from '../prisma/repair-order-discount-payment';

const baseOrder: CandidateOrder = {
  id: 'order-1',
  orderNumber: 102,
  restaurantId: 'restaurant-1',
  subtotal: 400,
  tax: 0,
  serviceCharge: 0,
  deliveryCharge: 0,
  total: 400,
  totalPaid: 380,
  amountDue: 20,
};

test('detects a POS discount that was stored as a remaining balance', () => {
  const repair = planRepair(baseOrder);
  assert.ok(repair);
  assert.equal(repair.discountPercent, 5);
  assert.equal(repair.discountAmount, 20);
  assert.equal(repair.netTotal, 380);
});

test('detects a quick discount on an order that also has tax', () => {
  const repair = planRepair({
    ...baseOrder,
    subtotal: 1000,
    tax: 100,
    total: 1100,
    totalPaid: 950,
    amountDue: 150,
  });
  assert.ok(repair);
  assert.equal(repair.discountPercent, 15);
  assert.equal(repair.discountAmount, 150);
  assert.equal(repair.netTotal, 950);
});

test('leaves genuine partial payments untouched', () => {
  assert.equal(
    planRepair({
      ...baseOrder,
      subtotal: 310,
      tax: 1550,
      total: 1860,
      totalPaid: 325.5,
      amountDue: 1534.5,
    }),
    null
  );
});

test('leaves unexplained balances untouched', () => {
  assert.equal(planRepair({ ...baseOrder, amountDue: 37, totalPaid: 363 }), null);
  assert.equal(planRepair({ ...baseOrder, totalPaid: 0, amountDue: 400 }), null);
});
