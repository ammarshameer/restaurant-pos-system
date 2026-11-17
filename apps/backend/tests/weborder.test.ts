/**
 * Unit tests for the Website & WhatsApp Orders module.
 * Run with: npm run test:unit  (from apps/backend)
 *
 * Pure logic is tested directly; database-dependent flows use an in-memory
 * fake Prisma injected through setPrismaForTests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateWebsiteSlug,
  isOpenAt,
  quoteItems,
  sanitizeText,
  sanitizeImageField,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  buildWhatsAppUrlForMessage,
  buildShortWhatsAppMessage,
  MAX_WHATSAPP_URL_LENGTH,
  RATE_LIMITS,
  setPrismaForTests,
  setPosOrderCreatorForTests,
  createPublicOrder,
  checkPhoneSpam,
  getWebOrderForTenant,
  acceptWebOrder,
  rejectWebOrder,
  expireStaleWebOrders,
  purgeOldWebOrders,
  updateWebsiteSettings,
} from '../src/services/weborder.service';
import { normalizePhone, PHONE_FORMAT_ERROR } from '../src/utils/phone';
import { MODULE_TO_FEATURE, FEATURES, PERMISSIONS } from '../src/permissions';

// ============================================
// HELPERS
// ============================================

function makeMenuItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    price: 500,
    isAvailable: true,
    is86d: false,
    modifiers: [],
    ...overrides,
  };
}

function matchesWhere(order: any, where: any): boolean {
  if (!where) return true;
  if (where.restaurantId && order.restaurantId !== where.restaurantId) return false;
  if (where.id && order.id !== where.id) return false;
  if (where.reference && order.reference !== where.reference) return false;
  if (where.clientRef && order.clientRef !== where.clientRef) return false;
  if (where.customerPhone && order.customerPhone !== where.customerPhone) return false;
  if (where.status) {
    const statuses = Array.isArray(where.status.in) ? where.status.in : [where.status];
    if (!statuses.includes(order.status)) return false;
  }
  if (where.createdAt?.gte && new Date(order.createdAt) < new Date(where.createdAt.gte)) return false;
  if (where.createdAt?.lt && new Date(order.createdAt) >= new Date(where.createdAt.lt)) return false;
  if (where.expiresAt?.lt && (!order.expiresAt || new Date(order.expiresAt) >= new Date(where.expiresAt.lt))) return false;
  return true;
}

function fakeDb(overrides: Record<string, any> = {}) {
  const restaurants = new Map<string, any>();
  const webOrders: any[] = [];
  const store: any = {
    restaurants,
    webOrders,
    $transaction: async (fn: any) => fn(store),
    restaurant: {
      findUnique: async ({ where }: any) => {
        if (where.websiteSlug) {
          for (const r of restaurants.values()) {
            if (r.websiteSlug === where.websiteSlug) return r;
          }
          return null;
        }
        return restaurants.get(where.id) || null;
      },
      update: async ({ where, data }: any) => {
        const r = restaurants.get(where.id);
        Object.assign(r, data);
        return r;
      },
    },
    webOrder: {
      create: async ({ data }: any) => {
        const created = {
          id: `wo-${webOrders.length + 1}`,
          status: 'NEW',
          createdAt: new Date(),
          ...data,
          items: data.items?.create || [],
        };
        webOrders.push(created);
        return { ...created, items: data.items?.create || [] };
      },
      findFirst: async ({ where }: any) => webOrders.find((o) => matchesWhere(o, where)) || null,
      count: async ({ where }: any) => webOrders.filter((o) => matchesWhere(o, where)).length,
      update: async ({ where, data }: any) => {
        const o = webOrders.find((x) => x.id === where.id);
        Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const o of webOrders) {
          if (matchesWhere(o, where)) {
            Object.assign(o, data);
            count += 1;
          }
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        const before = webOrders.length;
        for (let i = webOrders.length - 1; i >= 0; i--) {
          if (matchesWhere(webOrders[i], where)) webOrders.splice(i, 1);
        }
        return { count: before - webOrders.length };
      },
      findMany: async () => webOrders,
    },
    tenantFeature: {
      findFirst: async ({ where }: any) => {
        const rows = overrides.features?.[where.restaurantId] || [];
        const row = rows.find((f: any) => f.featureKey === where.featureKey && f.enabled);
        return row ? { ...row } : null;
      },
    },
    menuItem: {
      findMany: async ({ where }: any) => (overrides.menuItems || []).filter((i: any) => where.id?.in?.includes(i.id)),
    },
    deal: { findMany: async ({ where }: any) => (overrides.deals || []).filter((d: any) => where.id?.in?.includes(d.id)) },
    ...overrides.extra,
  };
  return store;
}

// ============================================
// PHONE NORMALIZATION
// ============================================

test('Pakistani local numbers convert to 92 international format', () => {
  assert.equal(normalizePhone('03001234567'), '923001234567');
  assert.equal(normalizePhone('0300 1234567'), '923001234567');
  assert.equal(normalizePhone('3001234567'), '923001234567');
  assert.equal(normalizePhone('+92 300 1234567'), '923001234567');
  assert.equal(normalizePhone('00923001234567'), '923001234567');
  assert.equal(normalizePhone('923001234567'), '923001234567');
  assert.equal(normalizePhone('not-a-phone'), null);
  assert.equal(normalizePhone(''), null);
});

test('extra 0 after the country code is removed', () => {
  assert.equal(normalizePhone('+92 0300 1234567'), '923001234567');
  assert.equal(normalizePhone('92 0300 1234567'), '923001234567');
  assert.equal(normalizePhone('9203001234567'), '923001234567');
  assert.equal(normalizePhone('0092 0300 1234567'), '923001234567');
});

test('local numbers must be Pakistani mobiles: landlines and <=8 digits are rejected', () => {
  // 03xx + 9 digits is the only accepted local form.
  assert.equal(normalizePhone('03123456789'), '923123456789');
  // Landlines / short local numbers.
  assert.equal(normalizePhone('04212345678'), null);
  assert.equal(normalizePhone('02134567890'), null);
  assert.equal(normalizePhone('+92 42 12345678'), null); // landline with country code
  assert.equal(normalizePhone('0092 042 12345678'), null);
  assert.equal(normalizePhone('0300123456'), null);
  assert.equal(normalizePhone('12345678'), null);
  assert.equal(normalizePhone('123'), null);
  // A 92-prefixed number must still have a full 10-digit local part.
  assert.equal(normalizePhone('92 30012345'), null);
  assert.equal(normalizePhone('920300123456'), null);
  assert.match(PHONE_FORMAT_ERROR, /Enter a mobile number like 0300 1234567/);
});

test('international numbers require a country code and 10 to 15 digits', () => {
  assert.equal(normalizePhone('+1 202 555 0143'), '12025550143'); // 11 digits
  assert.equal(normalizePhone('442079460958'), '442079460958'); // 12 digits
  assert.equal(normalizePhone('+1 234 567 8901'), '12345678901'); // 11 digits
  assert.equal(normalizePhone('123456789'), null); // 9 digits
  assert.equal(normalizePhone('1234567890123456'), null); // 16 digits
  assert.equal(normalizePhone('03001234567'.slice(1)), '923001234567'); // local form still supported
});

// ============================================
// SLUGS
// ============================================

test('website slug validation: allowed chars, reserved words, uniqueness-ready', () => {
  assert.equal(validateWebsiteSlug('dimlight-cafe').valid, true);
  assert.equal(validateWebsiteSlug('Cafe 42').valid, false);
  assert.equal(validateWebsiteSlug('cafe--x').valid, false);
  assert.equal(validateWebsiteSlug('-cafe').valid, false);
  assert.equal(validateWebsiteSlug('admin').valid, false);
  assert.equal(validateWebsiteSlug('api').valid, false);
  assert.equal(validateWebsiteSlug('m').valid, false);
  assert.equal(validateWebsiteSlug('ab').valid, false);
});

test('website feature is registered and mapped to weborders permissions', () => {
  assert.ok(FEATURES.includes('website'));
  assert.equal(MODULE_TO_FEATURE['weborders'], 'website');
  assert.equal(MODULE_TO_FEATURE['website'], 'website');
  assert.ok(PERMISSIONS.includes('weborders.view'));
  assert.ok(PERMISSIONS.includes('weborders.manage'));
  assert.ok(PERMISSIONS.includes('website.settings'));
});

// ============================================
// OPENING HOURS
// ============================================

test('closed outside opening hours', () => {
  const hours = JSON.stringify({ mon: { open: '11:00', close: '23:00' } });
  const monday1100 = new Date(2024, 0, 1, 10, 59); // Monday 10:59 (closed)
  const monday1200 = new Date(2024, 0, 1, 12, 0); // Monday 12:00 (open)
  assert.equal(isOpenAt(hours, monday1100), false);
  assert.equal(isOpenAt(hours, monday1200), true);
});

test('closed day flag and overnight windows', () => {
  const hours = JSON.stringify({
    sun: { closed: true },
    fri: { open: '18:00', close: '02:00' },
  });
  assert.equal(isOpenAt(hours, new Date(2024, 0, 7, 12, 0)), false); // Sunday
  assert.equal(isOpenAt(hours, new Date(2024, 0, 5, 20, 0)), true); // Friday 20:00
  assert.equal(isOpenAt(hours, new Date(2024, 0, 5, 1, 0)), true); // Saturday 01:00 (past-midnight side of Friday window)
  assert.equal(isOpenAt(hours, new Date(2024, 0, 5, 12, 0)), false); // Saturday noon
});

// ============================================
// PRICE TAMPERING
// ============================================

test('client-supplied prices are ignored (price tampering)', () => {
  const dbItem = makeMenuItem('i1', { price: 600 });
  const quote = quoteItems(
    [{ id: 'i1', qty: 2, notes: null }],
    [dbItem],
    []
  ) as any;
  // The attacker tried to send unitPrice 1 via the client; quoteItems never
  // reads client prices at all, so the line is 2 x 600.
  assert.equal(quote.items[0].unitPrice, 600);
  assert.equal(quote.subtotal, 1200);
  assert.equal(quote.total, 1200);
});

test('sold-out items are rejected at quote time', () => {
  const result = quoteItems([{ id: 'i1', qty: 1 }], [makeMenuItem('i1', { isAvailable: false })], []) as any;
  assert.ok(result.error);
});

test('unknown or mismatched modifiers are rejected', () => {
  const item = makeMenuItem('i1', {
    modifiers: [{ id: 'g1', name: 'Size', modifiers: [{ id: 'mod1', name: 'Large', price: 100 }] }],
  });
  const good = quoteItems([{ id: 'i1', qty: 1, modifiers: [{ id: 'mod1' }] }], [item], []) as any;
  assert.equal(good.subtotal, 600);
  const bad = quoteItems([{ id: 'i1', qty: 1, modifiers: [{ id: 'modX' }] }], [item], []) as any;
  assert.ok(bad.error);
});

// ============================================
// TEXT SANITIZATION
// ============================================

test('customer text is length-limited and control chars stripped', () => {
  assert.equal(sanitizeText('hello\u0007world', 20), 'helloworld');
  assert.equal(sanitizeText('x'.repeat(500), 300)!.length, 300);
  assert.equal(sanitizeText('   ', 50), null);
});

test('names and addresses collapse line breaks into spaces', () => {
  assert.equal(sanitizeText('Ali\nHouse 5', 60, { maxLineBreaks: 0 }), 'Ali House 5');
  assert.equal(sanitizeText('House 5\r\nStreet 2\rTown', 250, { maxLineBreaks: 0 }), 'House 5 Street 2 Town');
  assert.equal(sanitizeText('  Ali  \n\n  Khan ', 60, { maxLineBreaks: 0 }), 'Ali Khan');
});

test('notes keep up to three line breaks', () => {
  assert.equal(sanitizeText('line1\nline2\nline3\nline4', 300), 'line1\nline2\nline3\nline4');
  assert.equal(sanitizeText('line1\nline2\nline3\nline4\nline5', 300), 'line1\nline2\nline3\nline4');
  assert.equal(sanitizeText('a\r\nb\rc', 300), 'a\nb\nc');
  assert.equal(sanitizeText('a\nb\nc', 300, { maxLineBreaks: 0 }), 'a b c');
});

test('website images are kept intact and unsafe image values are rejected', () => {
  const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
  assert.equal(sanitizeImageField(dataUrl, 'Logo').value, dataUrl);
  assert.ok(sanitizeImageField('javascript:alert(1)', 'Logo').error);
  assert.ok(sanitizeImageField('data:image/jpeg;base64,' + 'A'.repeat(477), 'Logo').error);
  assert.equal(sanitizeImageField('', 'Logo').value, null);
  assert.equal(sanitizeImageField(null, 'Logo').value, null);
});

// ============================================
// WHATSAPP MESSAGE
// ============================================

test('WhatsApp message and URL format', () => {
  const message = buildWhatsAppMessage({
    reference: 'W-4821',
    businessName: 'Dim Light Cafe',
    items: [{ qty: 2, name: 'Chicken Burger', lineTotal: 1200, unitPrice: 600, modifiers: [], menuItemId: 'i1', notes: null }],
    subtotal: 1200,
    deliveryFee: 100,
    total: 1300,
    orderType: 'DELIVERY',
    customerName: 'Ali',
    customerPhone: '923001234567',
    address: 'House 5, Street 2',
    paymentNote: 'Cash on delivery',
  });
  assert.ok(message.startsWith('New order W-4821 - Dim Light Cafe'));
  assert.ok(message.includes('2 x Chicken Burger - Rs 1200'));
  assert.ok(message.includes('Total: Rs 1300'));
  assert.ok(message.includes('Phone: +923001234567'));
  const url = buildWhatsAppUrl('923001234567', message);
  assert.ok(url.startsWith('https://wa.me/923001234567?text='));
  assert.ok(decodeURIComponent(url).includes('W-4821'));
});

test('over-long wa.me links fall back to the short order message', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    qty: 2, name: 'Item', lineTotal: 100, unitPrice: 50, modifiers: [], menuItemId: `i${i}`, notes: 'x'.repeat(200),
  }));
  const opts = {
    reference: 'W-9001',
    businessName: 'Test Cafe',
    items,
    subtotal: 1200,
    deliveryFee: 0,
    total: 1200,
    orderType: 'PICKUP',
    customerName: 'Ali',
    customerPhone: '923001234567',
    notes: 'x'.repeat(2000),
  };
  const fullMessage = buildWhatsAppMessage(opts);
  assert.ok(buildWhatsAppUrl(opts.customerPhone, fullMessage).length > MAX_WHATSAPP_URL_LENGTH);

  const shortMessage = buildShortWhatsAppMessage(opts);
  assert.match(shortMessage, /New order W-9001 - Test Cafe/);
  assert.match(shortMessage, /Total: Rs 1200/);
  assert.match(shortMessage, /Items: 24/);
  assert.match(shortMessage, /Name: Ali/);
  assert.match(shortMessage, /Phone: \+923001234567/);
  assert.match(shortMessage, /Full details are in the order system under W-9001/);

  const shortUrl = buildWhatsAppUrlForMessage(opts.customerPhone, fullMessage, opts);
  assert.ok(shortUrl.length <= MAX_WHATSAPP_URL_LENGTH);
  assert.match(decodeURIComponent(shortUrl), /Full details are in the order system under W-9001/);
  assert.doesNotMatch(decodeURIComponent(shortUrl), /x{200}/);

  // Normal-length orders keep the full itemised message.
  const smallOpts = { ...opts, items: [items[0]], notes: null };
  const smallMessage = buildWhatsAppMessage(smallOpts);
  assert.equal(
    buildWhatsAppUrlForMessage(opts.customerPhone, smallMessage, smallOpts),
    buildWhatsAppUrl(opts.customerPhone, smallMessage)
  );
});

// ============================================
// PUBLIC ORDER API (with fake DB)
// ============================================

const ACTIVE_FEATURES = { rest1: [{ featureKey: 'website', enabled: true }] };

function baseRestaurant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rest1',
    name: 'Test Cafe',
    isActive: true,
    websiteSlug: 'test-cafe',
    onlineOrderingEnabled: true,
    whatsappNumber: '923001234567',
    websiteOpeningHours: '{}',
    websiteOrderTypes: 'DELIVERY,PICKUP',
    websiteDeliveryFee: 100,
    websiteFreeDeliveryAbove: 2000,
    websiteMinOrder: 300,
    websitePaymentNote: 'Cash on delivery',
    logoUrl: null,
    websiteCoverUrl: null,
    websiteAbout: null,
    ...overrides,
  };
}

test('disabled or expired module returns 404 on public routes', async () => {
  const db = fakeDb({ features: { rest1: [{ featureKey: 'website', enabled: false }] } });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const result = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.equal(result.status, 404);
});

test('suspended business returns 404', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES });
  db.restaurants.set('rest1', baseRestaurant({ isActive: false }));
  setPrismaForTests(db);
  const result = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.equal(result.status, 404);
});

test('unknown slug returns 404', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const result = await createPublicOrder({
    slug: 'who-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.equal(result.status, 404);
});

test('ordering disabled: browse allowed, orders blocked', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES });
  db.restaurants.set('rest1', baseRestaurant({ onlineOrderingEnabled: false }));
  setPrismaForTests(db);
  const result = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.equal(result.status, 403);
});

test('closed hours: orders blocked', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES });
  // Build hours that close all day today
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
  db.restaurants.set('rest1', baseRestaurant({ websiteOpeningHours: JSON.stringify({ [day]: { closed: true } }) }));
  setPrismaForTests(db);
  const result = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.equal(result.status, 400);
});

test('rate limit per phone: 429 after the allowed number of orders', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: [makeMenuItem('i1')] });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  for (let i = 0; i < RATE_LIMITS.MAX_ORDERS_PER_PHONE_PER_HOUR; i++) {
    const result: any = await createPublicOrder({
      slug: 'test-cafe',
      items: [{ id: 'i1', qty: 1 }],
      name: 'Ali',
      phone: '03001234567',
      orderType: 'PICKUP',
    });
    assert.ok(!result.error, `order ${i} should succeed: ${result.error}`);
  }
  const blocked = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.equal(blocked.status, 429);
  // A different phone is not affected
  const other: any = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Sara',
    phone: '03111234567',
    orderType: 'PICKUP',
  });
  assert.ok(!other.error);
});

test('happy path: server prices, delivery fee rules, reference and whatsapp link', async () => {
  const item = makeMenuItem('i1', { price: 500 });
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: [item] });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const result: any = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 4 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'DELIVERY',
    address: 'House 5',
  });
  assert.ok(!result.error);
  assert.match(result.reference, /^W-\d{4}$/);
  // 4 x 500 = 2000 >= freeDeliveryAbove(2000) -> fee waived
  assert.equal(result.total, 2000);
  assert.ok(result.webOrder.subtotal === 2000);
  assert.ok(result.whatsappUrl.startsWith('https://wa.me/923001234567?text='));

  // Below free-delivery threshold -> fee applies; still above minimum order
  const small: any = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03221234567',
    orderType: 'DELIVERY',
    address: 'House 5',
  });
  assert.ok(!small.error, small.error);
  assert.equal(small.total, 600); // 500 + 100 delivery fee
});

test('long orders placed through the public API get the short WhatsApp link', async () => {
  const longItems = Array.from({ length: 12 }, (_, i) =>
    makeMenuItem(`i${i}`, { name: `Different item ${i} `.repeat(12), price: 100 })
  );
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: longItems });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const result: any = await createPublicOrder({
    slug: 'test-cafe',
    items: longItems.map((i) => ({ id: i.id, qty: 1 })),
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP',
  });
  assert.ok(!result.error);
  assert.ok(result.whatsappUrl.length <= MAX_WHATSAPP_URL_LENGTH);
  assert.match(decodeURIComponent(result.whatsappUrl), /Full details are in the order system under/);
  assert.match(decodeURIComponent(result.whatsappUrl), /Items: 12/);
});

test('saved name/address are single-line while notes keep their line breaks', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: [makeMenuItem('i1')] });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const result: any = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali\nKhan',
    phone: '03001234567',
    orderType: 'DELIVERY',
    address: 'House 5\nStreet 2',
    notes: 'line1\nline2\nline3\nline4\nline5',
  });
  assert.ok(!result.error);
  assert.equal(result.webOrder.customerName, 'Ali Khan');
  assert.equal(result.webOrder.address, 'House 5 Street 2');
  assert.equal(result.webOrder.notes, 'line1\nline2\nline3\nline4');
});

test('duplicate submit with the same clientRef returns the existing order', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: [makeMenuItem('i1')] });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const input = {
    slug: 'test-cafe',
    items: [{ id: 'i1', qty: 1 }],
    name: 'Ali',
    phone: '03001234567',
    orderType: 'PICKUP' as const,
    clientRef: '9f1c2b7a-1c34-4a56-8e7f-0a1b2c3d4e5f',
  };
  const first: any = await createPublicOrder(input);
  const second: any = await createPublicOrder({ ...input, name: 'Someone else' });

  assert.ok(!first.error);
  assert.equal(second.duplicate, true);
  assert.equal(second.reference, first.reference);
  assert.equal(second.total, first.total);
  assert.equal(second.webOrder.id, first.webOrder.id);
  assert.equal(second.webOrder.clientRef, input.clientRef);
  assert.ok(second.whatsappUrl.startsWith('https://wa.me/923001234567?text='));
  assert.match(decodeURIComponent(second.whatsappUrl), new RegExp(first.reference));
  // Only one order was saved, even though the request arrived twice.
  assert.equal(db.webOrders.length, 1);
});

test('clientRef idempotency is scoped per business', async () => {
  const db = fakeDb({
    features: { rest1: [{ featureKey: 'website', enabled: true }], rest2: [{ featureKey: 'website', enabled: true }] },
    menuItems: [makeMenuItem('i1')],
  });
  db.restaurants.set('rest1', baseRestaurant());
  db.restaurants.set('rest2', baseRestaurant({ id: 'rest2', name: 'Other Cafe', websiteSlug: 'other-cafe' }));
  setPrismaForTests(db);
  const clientRef = 'same-uuid-for-both-businesses';
  const first: any = await createPublicOrder({ slug: 'test-cafe', items: [{ id: 'i1', qty: 1 }], name: 'Ali', phone: '03001234567', orderType: 'PICKUP', clientRef });
  const second: any = await createPublicOrder({ slug: 'other-cafe', items: [{ id: 'i1', qty: 1 }], name: 'Ali', phone: '03001234567', orderType: 'PICKUP', clientRef });
  assert.ok(!first.error && !second.error);
  assert.notEqual(second.webOrder.id, first.webOrder.id);
  assert.equal(db.webOrders.length, 2);
});

test('business WhatsApp number follows the same mobile rules', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);

  for (const bad of ['04212345678', '12345678', '+1 202 555 01']) {
    const result = await updateWebsiteSettings('rest1', { whatsappNumber: bad });
    assert.equal(result.status, 400, `${bad} should be rejected`);
    assert.match(result.error || '', /Enter a mobile number like 0300 1234567/);
  }
  const good = await updateWebsiteSettings('rest1', { whatsappNumber: '+92 0300 1234567' });
  assert.ok(!good.error);
  assert.equal(good.restaurant.whatsappNumber, '923001234567');
});

test('below minimum order is rejected', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: [makeMenuItem('i2', { price: 100 })] });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const result = await createPublicOrder({
    slug: 'test-cafe',
    items: [{ id: 'i2', qty: 1 }],
    name: 'Ali',
    phone: '03331234567',
    orderType: 'PICKUP',
  });
  assert.equal((result as any).status, 400);
  assert.match((result as any).error, /Minimum order/);
});

test('tenant isolation: web orders of other businesses are invisible', async () => {
  const db = fakeDb({});
  db.webOrders.push({ id: 'wo1', restaurantId: 'other-tenant', reference: 'W-1111', status: 'NEW', items: [] });
  setPrismaForTests(db);
  const mine = await getWebOrderForTenant('other-tenant', 'wo1');
  assert.ok(mine);
  const notMine = await getWebOrderForTenant('rest1', 'wo1');
  assert.equal(notMine, null);
});

test('accept creates a normal POS order with source WEBSITE', async () => {
  const db = fakeDb({});
  db.webOrders.push({
    id: 'wo1',
    restaurantId: 'rest1',
    reference: 'W-4821',
    status: 'NEW',
    customerName: 'Ali',
    customerPhone: '923001234567',
    orderType: 'DELIVERY',
    address: 'House 5',
    subtotal: 1000,
    deliveryFee: 100,
    total: 1100,
    notes: null,
    items: [{ name: 'Burger', qty: 2, unitPrice: 500, menuItemId: 'i1', dealId: null, modifiers: '[]', notes: null }],
  });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);

  let captured: any = null;
  setPosOrderCreatorForTests(async (args) => {
    captured = args;
    return { id: 'pos-order-1' };
  });

  const result = await acceptWebOrder('rest1', 'wo1', 'emp-1');
  assert.ok(!result.error);
  assert.equal(result.webOrder.status, 'ACCEPTED');
  assert.equal(result.webOrder.posOrderId, 'pos-order-1');
  assert.equal(captured.restaurantId, 'rest1');
  assert.equal(captured.source, 'WEBSITE');
  assert.equal(captured.orderType, 'DELIVERY');
  assert.equal(captured.items.length, 1);
  assert.equal(captured.items[0].quantity, 2);
  assert.equal(captured.serverId, 'emp-1');

  // Double-accept is blocked
  const again = await acceptWebOrder('rest1', 'wo1', 'emp-1');
  assert.equal(again.status, 400);
});

test('manager can set the delivery charge when accepting an order', async () => {
  const db = fakeDb({});
  db.webOrders.push({
    id: 'wo2',
    restaurantId: 'rest1',
    reference: 'W-4822',
    status: 'NEW',
    customerName: 'Sara',
    customerPhone: '923001234567',
    orderType: 'DELIVERY',
    address: 'House 7',
    subtotal: 1000,
    deliveryFee: 0,
    total: 1000,
    notes: null,
    items: [{ name: 'Pizza', qty: 1, unitPrice: 1000, menuItemId: 'i1', dealId: null, modifiers: '[]', notes: null }],
  });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);

  let captured: any = null;
  setPosOrderCreatorForTests(async (args) => {
    captured = args;
    return { id: 'pos-order-2' };
  });

  const result = await acceptWebOrder('rest1', 'wo2', 'emp-1', 250);
  assert.ok(!result.error);
  assert.equal(captured.deliveryCharge, 250);
  assert.equal(captured.total, 1250);
  assert.equal(result.webOrder.deliveryFee, 250);
  assert.equal(result.webOrder.total, 1250);
});

test('invalid delivery charge is rejected when accepting an order', async () => {
  const db = fakeDb({});
  db.webOrders.push({
    id: 'wo3',
    restaurantId: 'rest1',
    reference: 'W-4823',
    status: 'NEW',
    customerName: 'Sara',
    customerPhone: '923001234567',
    orderType: 'DELIVERY',
    address: 'House 7',
    subtotal: 1000,
    deliveryFee: 0,
    total: 1000,
    notes: null,
    items: [{ name: 'Pizza', qty: 1, unitPrice: 1000, menuItemId: 'i1', dealId: null, modifiers: '[]', notes: null }],
  });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);

  const result = await acceptWebOrder('rest1', 'wo3', 'emp-1', -50);
  assert.equal(result.status, 400);
});

test('phone spam check counts per hour', async () => {
  const db = fakeDb({});
  for (let i = 0; i < RATE_LIMITS.MAX_ORDERS_PER_PHONE_PER_HOUR; i++) {
    db.webOrders.push({ restaurantId: 'r1', customerPhone: '923001234567', createdAt: new Date(Date.now() - 10 * 60 * 1000) });
  }
  setPrismaForTests(db);
  assert.equal(await checkPhoneSpam('r1', '923001234567'), false);
  assert.equal(await checkPhoneSpam('r1', '923007777777'), true);
  assert.equal(await checkPhoneSpam('r2', '923001234567'), true);
});

// ============================================
// LIFECYCLE / CONCURRENCY (A1, A2, A12)
// ============================================

function newWebOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: `wo-${Math.random().toString(36).slice(2, 8)}`,
    restaurantId: 'rest1',
    reference: 'W-5000',
    status: 'NEW',
    customerName: 'Ali',
    customerPhone: '923001234567',
    orderType: 'PICKUP',
    subtotal: 500,
    deliveryFee: 0,
    total: 500,
    notes: null,
    items: [{ name: 'Burger', qty: 1, unitPrice: 500, menuItemId: 'i1', dealId: null, modifiers: '[]', notes: null }],
    ...overrides,
  };
}

test('two simultaneous accepts create exactly one POS order', async () => {
  const db = fakeDb({});
  const order = newWebOrder();
  db.webOrders.push(order);
  setPrismaForTests(db);

  let posCalls = 0;
  setPosOrderCreatorForTests(async () => {
    posCalls += 1;
    await Promise.resolve(); // simulate the real async POS-order creation
    return { id: `pos-${posCalls}` };
  });

  const results = await Promise.all([
    acceptWebOrder('rest1', order.id),
    acceptWebOrder('rest1', order.id),
  ]);
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, 400);
  assert.equal(posCalls, 1);
  assert.equal(ok[0].webOrder.posOrderId, 'pos-1');
  assert.equal(db.webOrders.filter((o: any) => o.id === order.id && o.status === 'ACCEPTED').length, 1);
});

test('failed POS order creation rolls the claim back to NEW', async () => {
  const db = fakeDb({});
  const order = newWebOrder();
  db.webOrders.push(order);
  setPrismaForTests(db);
  setPosOrderCreatorForTests(async () => { throw new Error('printer offline'); });

  const result = await acceptWebOrder('rest1', order.id);
  assert.equal(result.status, 500);
  assert.match(result.error || '', /Could not create the POS order/);
  assert.equal(order.status, 'NEW');
  assert.equal(order.posOrderId, null);
});

test('reject stores the reason and blocks a second decision', async () => {
  const db = fakeDb({});
  const order = newWebOrder();
  db.webOrders.push(order);
  setPrismaForTests(db);

  const first = await rejectWebOrder('rest1', order.id, 'Sold out\nPlease try later');
  assert.ok(!first.error);
  assert.equal(first.webOrder.status, 'REJECTED');
  assert.equal(first.webOrder.rejectionReason, 'Sold out Please try later');
  const again = await rejectWebOrder('rest1', order.id, 'Another reason');
  assert.equal(again.status, 400);
});

test('expiry sweep only expires stale NEW orders', async () => {
  const db = fakeDb({});
  db.webOrders.push(newWebOrder({ id: 'stale', status: 'NEW', expiresAt: new Date(Date.now() - 60_000) }));
  db.webOrders.push(newWebOrder({ id: 'fresh', status: 'NEW', expiresAt: new Date(Date.now() + 60_000) }));
  db.webOrders.push(newWebOrder({ id: 'accepted', status: 'ACCEPTED', expiresAt: new Date(Date.now() - 60_000) }));
  setPrismaForTests(db);

  assert.equal(await expireStaleWebOrders(), 1);
  assert.equal(db.webOrders.find((o: any) => o.id === 'stale').status, 'EXPIRED');
  assert.equal(db.webOrders.find((o: any) => o.id === 'fresh').status, 'NEW');
  assert.equal(db.webOrders.find((o: any) => o.id === 'accepted').status, 'ACCEPTED');
});

test('purge removes only old expired/rejected orders', async () => {
  const db = fakeDb({});
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  db.webOrders.push(newWebOrder({ id: 'old-rejected', status: 'REJECTED', createdAt: old }));
  db.webOrders.push(newWebOrder({ id: 'old-expired', status: 'EXPIRED', createdAt: old }));
  db.webOrders.push(newWebOrder({ id: 'new-rejected', status: 'REJECTED', createdAt: recent }));
  db.webOrders.push(newWebOrder({ id: 'old-delivered', status: 'DELIVERED', createdAt: old }));
  db.webOrders.push(newWebOrder({ id: 'old-new', status: 'NEW', createdAt: old }));
  setPrismaForTests(db);

  assert.equal(await purgeOldWebOrders(), 2);
  assert.deepEqual(db.webOrders.map((o: any) => o.id), ['new-rejected', 'old-delivered', 'old-new']);
});

test('production refuses public orders when Turnstile secret is missing', async () => {
  const db = fakeDb({ features: ACTIVE_FEATURES, menuItems: [makeMenuItem('i1')] });
  db.restaurants.set('rest1', baseRestaurant());
  setPrismaForTests(db);
  const previousEnv = process.env.NODE_ENV;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    const result = await createPublicOrder({
      slug: 'test-cafe', items: [{ id: 'i1', qty: 1 }], name: 'Ali', phone: '03001234567', orderType: 'PICKUP',
    });
    assert.equal(result.status, 400);
    assert.match(result.error || '', /temporarily unavailable|verification/i);
    assert.equal(db.webOrders.length, 0);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previousSecret;
  }
});

test('website module depends on the menu module', async () => {
  const { MODULE_DEPENDENCIES } = await import('../src/services/feature.service');
  assert.deepEqual(MODULE_DEPENDENCIES.website, ['menu']);
});
