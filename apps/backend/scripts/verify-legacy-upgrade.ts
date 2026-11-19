import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, filterPermissionsByFeatures } from '../src/permissions';

/**
 * Opt-in acceptance test for the live-schema delta and mandatory backfills.
 *
 * It rebuilds a database in the OLD 20-model shape, inserts legacy data, applies
 * the reviewed delta, runs the full backfill, and then exercises owner login,
 * orders and payments through the real HTTP API. It must never be pointed at a
 * live or default database.
 */

const SCRIPT_DIR = __dirname;
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..');
const LEGACY_SQL = path.join(BACKEND_DIR, 'prisma/live-baseline/legacy-schema.sql');
const DELTA_SQL = path.join(
  BACKEND_DIR,
  'prisma/live-baseline/20261118000000_live_schema_delta/migration.sql'
);

const RESTAURANT_ID = 'legacy-biz-1';
const OWNER_ID = 'legacy-owner-1';
const ORDER_ID = 'legacy-order-1';
const PAYMENT_CLIENT_ID = 'legacy-payment-1';
const OWNER_EMAIL = 'owner@legacy-upgrade.test';
const OWNER_PASSWORD = 'LegacyOwnerPass123!';
const OWNER_SLUG = 'legacy-cafe';
const API_PORT = process.env.LEGACY_UPGRADE_API_PORT || '3102';
const BASE_URL = `http://127.0.0.1:${API_PORT}/api`;

interface ApiResponse<T = any> {
  status: number;
  data: T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Point it at a disposable scratch database.`);
  }
  return value;
}

function psqlUrl(url: string): string {
  return url.split('?')[0];
}

async function runSql(databaseUrl: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: psqlUrl(databaseUrl) });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function runSqlFile(databaseUrl: string, filePath: string): Promise<void> {
  await runSql(databaseUrl, fs.readFileSync(filePath, 'utf8'));
}

async function request<T = any>(
  apiPath: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: T = text as unknown as T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    // Non-JSON errors are still useful in assertion messages.
  }
  return { status: response.status, data };
}

async function seedLegacyData(databaseUrl: string, passwordHash: string): Promise<void> {
  const sql = `
    INSERT INTO "Restaurant" ("id", "name", "address", "phone", "email", "timezone", "updatedAt")
    VALUES ('${RESTAURANT_ID}', 'Legacy Cafe', '1 Old Road', '+920000000000', 'cafe@legacy.test', 'Asia/Karachi', NOW());

    INSERT INTO "Employee" ("id", "firstName", "lastName", "email", "role", "pin", "passwordHash", "restaurantId", "isActive", "updatedAt")
    VALUES ('${OWNER_ID}', 'Legacy', 'Owner', '${OWNER_EMAIL}', 'ADMIN', '2468', '${passwordHash}', '${RESTAURANT_ID}', true, NOW());

    INSERT INTO "Order" ("id", "orderNumber", "restaurantId", "serverId", "total", "totalPaid", "paymentStatus", "updatedAt")
    VALUES ('${ORDER_ID}', 1, '${RESTAURANT_ID}', '${OWNER_ID}', 100, 25, 'PARTIALLY_PAID', NOW());
  `;
  await runSql(databaseUrl, sql);
}

async function main(): Promise<void> {
  const scratchUrl = requireEnv('LEGACY_UPGRADE_DATABASE_URL');
  const liveUrl = process.env.DATABASE_URL?.trim();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the legacy upgrade test with NODE_ENV=production.');
  }
  if (process.env.LEGACY_UPGRADE_CONFIRMED !== 'yes') {
    throw new Error('Set LEGACY_UPGRADE_CONFIRMED=yes after confirming this is a disposable scratch database.');
  }
  if (liveUrl && psqlUrl(liveUrl) === psqlUrl(scratchUrl)) {
    throw new Error('LEGACY_UPGRADE_DATABASE_URL must be different from DATABASE_URL.');
  }

  console.log('[legacy-upgrade] Rebuilding OLD database shape (scratch database only)');
  await runSql(scratchUrl, 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runSqlFile(scratchUrl, LEGACY_SQL);

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  await seedLegacyData(scratchUrl, passwordHash);

  // The generated clients read DATABASE_URL when their modules are imported.
  process.env.DATABASE_URL = scratchUrl;
  process.env.PORT = API_PORT;
  process.env.BASE_URL = BASE_URL;
  process.env.NODE_ENV = 'test';

  console.log('[legacy-upgrade] Applying reviewed live-schema delta');
  await runSqlFile(scratchUrl, DELTA_SQL);

  console.log('[legacy-upgrade] Running mandatory full backfill');
  const { runFullBackfill, disconnectFullBackfillClients } = await import('../prisma/backfill-all');
  await runFullBackfill();

  const { PrismaClient } = await import('@prisma/client');
  const verificationDb = new PrismaClient();

  try {
    const restaurant = await verificationDb.restaurant.findUnique({
      where: { id: RESTAURANT_ID },
    });
    assert(restaurant, 'legacy restaurant survived the upgrade');
    assert(restaurant.slug, 'backfill assigned a tenant slug');
    assert(restaurant.isActive, 'legacy business remains active');

    const legacyOrder = await verificationDb.order.findUnique({ where: { id: ORDER_ID } });
    assert(legacyOrder, 'legacy order survived the upgrade');
    assert(
      Math.abs(Number(legacyOrder.amountDue) - 75) < 0.001,
      `backfill set amountDue to 75 (got ${legacyOrder.amountDue})`
    );

    const features = await verificationDb.tenantFeature.findMany({
      where: { restaurantId: RESTAURANT_ID, enabled: true },
      select: { featureKey: true },
    });
    assert(features.length > 0, 'legacy modules were restored');
    const featureKeys = new Set(features.map((row) => row.featureKey));
    for (const key of ['pos', 'orders', 'payments', 'menu', 'inventory', 'settings']) {
      assert(featureKeys.has(key as any), `${key} module is enabled`);
    }
    assert(!featureKeys.has('expenses'), 'expenses was not silently enabled');
    assert(!featureKeys.has('payroll'), 'payroll was not silently enabled');
    assert(!featureKeys.has('website'), 'website was not silently enabled');

    const ownerRole = await verificationDb.role.findFirst({
      where: { restaurantId: RESTAURANT_ID, key: 'OWNER' },
      include: { permissions: true },
    });
    assert(ownerRole, 'OWNER role was created');
    const rolePermissions = ownerRole.permissions.map((row) => row.permission).sort();
    assert(
      JSON.stringify(rolePermissions) === JSON.stringify([...ALL_PERMISSIONS].sort()),
      'OWNER role has every permission'
    );

    const ownerEmployee = await verificationDb.employee.findUnique({ where: { id: OWNER_ID } });
    assert(ownerEmployee, 'owner employee survived the upgrade');
    assert(ownerEmployee.roleId === ownerRole.id, 'owner employee is linked to the OWNER role');

    console.log('[legacy-upgrade] Starting backend against the rebuilt database');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'legacy-upgrade-test-jwt-secret';
    process.env.JWT_PLATFORM_SECRET =
      process.env.JWT_PLATFORM_SECRET || 'legacy-upgrade-test-platform-jwt-secret';
    await import('../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const login = await request('/auth/login', {
      method: 'POST',
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, tenantSlug: OWNER_SLUG },
    });
    assert(login.status === 200, `owner login returned ${login.status}: ${JSON.stringify(login.data)}`);
    assert(login.data.accessToken, 'owner login returned an access token');
    assert(login.data.user.role === 'OWNER', 'owner login reports the OWNER role');
    assert(login.data.user.restaurantId === RESTAURANT_ID, 'owner login is scoped to the legacy business');

    const enabledKeys = Array.from(featureKeys);
    const expectedPermissions = filterPermissionsByFeatures([...ALL_PERMISSIONS], enabledKeys as any).sort();
    const actualPermissions = Array.isArray(login.data.user.permissions)
      ? [...login.data.user.permissions].sort()
      : [];
    assert(
      JSON.stringify(actualPermissions) === JSON.stringify(expectedPermissions),
      `owner session permissions match the OWNER role and enabled modules (${actualPermissions.length} vs ${expectedPermissions.length})`
    );

    const ordersRes = await request('/orders', { token: login.data.accessToken });
    assert(ordersRes.status === 200, `GET /orders returned ${ordersRes.status}: ${JSON.stringify(ordersRes.data)}`);
    const ordersList = Array.isArray(ordersRes.data) ? ordersRes.data : ordersRes.data?.data;
    assert(Array.isArray(ordersList), 'orders endpoint returned a list');
    assert(
      ordersList.some((order: any) => order.id === ORDER_ID),
      'legacy order is visible through the Orders API'
    );

    const paymentsBefore = await request('/payments', { token: login.data.accessToken });
    assert(
      paymentsBefore.status === 200,
      `GET /payments returned ${paymentsBefore.status}: ${JSON.stringify(paymentsBefore.data)}`
    );

    const paymentRes = await request('/payments', {
      method: 'POST',
      token: login.data.accessToken,
      body: {
        clientId: PAYMENT_CLIENT_ID,
        orderId: ORDER_ID,
        amount: 25,
        method: 'CASH',
      },
    });
    assert(
      paymentRes.status === 201,
      `POST /payments returned ${paymentRes.status}: ${JSON.stringify(paymentRes.data)}`
    );

    const paymentsAfter = await request('/payments', { token: login.data.accessToken });
    assert(paymentsAfter.status === 200, 'GET /payments still works after a payment');
    const paymentsList = Array.isArray(paymentsAfter.data) ? paymentsAfter.data : paymentsAfter.data?.data;
    assert(Array.isArray(paymentsList), 'payments endpoint returned a list');
    assert(
      paymentsList.some((payment: any) => payment.clientId === PAYMENT_CLIENT_ID),
      'new payment is visible through the Payments API'
    );

    console.log('\n=========================================================');
    console.log('LEGACY UPGRADE ACCEPTANCE: PASSED');
    console.log('  - old shape rebuilt and delta applied');
    console.log('  - full backfill completed');
    console.log('  - owner login works');
    console.log('  - Orders and Payments APIs work');
    console.log('  - owner permissions match the OWNER role');
    console.log('=========================================================\n');
  } finally {
    await verificationDb.$disconnect();
    await disconnectFullBackfillClients();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nLEGACY UPGRADE ACCEPTANCE: FAILED');
    console.error(error);
    process.exit(1);
  });
