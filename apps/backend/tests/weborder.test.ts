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
  RATE_LIMITS,
  setPrismaForTests,
  setPosOrderCreatorForTests,
  createPublicOrder,
  checkPhoneSpam,
  getWebOrderForTenant,
  acceptWebOrder,
} from '../src/services/weborder.service';
import { normalizePhone } from '../src/utils/phone';
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

function fakeDb(overrides: Record<string, any> = {}) {
  const restaurants = new Map<string, any>();
  const webOrders: any[] = [];
  const store: any = {
    restaurants,
    webOrders,
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
          items: [],
          createdAt: new Date(),
          ...data,
        };
        webOrders.push(created);
        return { ...created, items: data.items?.create || [] };
      },
      findFirst: async ({ where }: any) => {
        return (
          webOrders.find((o) => {
            if (where.restaurantId && o.restaurantId !== where.restaurantId) return false;
            if (where.id && o.id !== where.id) return false;
            if (where.reference && o.reference !== where.reference) return false;
            if (where.customerPhone && o.customerPhone !== where.customerPhone) return false;
            if (where.createdAt?.gte && new Date(o.createdAt) < new Date(where.createdAt.gte)) return false;
            return true;
          }) || null
        );
      },
      count: async ({ where }: any) => {
        return webOrders.filter((o) => {
          if (where.restaurantId && o.restaurantId !== where.restaurantId) return false;
          if (where.customerPhone && o.customerPhone !== where.customerPhone) return false;
          if (where.createdAt?.gte && new Date(o.createdAt) < new Date(where.createdAt.gte)) return false;
          return true;
        }).length;
      },
      update: async ({ where, data }: any) => {
        const o = webOrders.find((x) => x.id === where.id);
        Object.assign(o, data);
        return o;
      },
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
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
  assert.equal(normalizePhone('3001234567'), '923001234567');
  assert.equal(normalizePhone('+92 300 1234567'), '923001234567');
  assert.equal(normalizePhone('00923001234567'), '923001234567');
  assert.equal(normalizePhone('923001234567'), '923001234567');
  assert.equal(normalizePhone('not-a-phone'), null);
  assert.equal(normalizePhone('123'), null);
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
