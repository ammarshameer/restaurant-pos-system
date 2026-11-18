import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTenantCsv, collectTenantExportData } from '../src/services/platform.service';

function fakeTenantDb(rowsByDelegate: Record<string, any[]> = {}) {
  const calls: Array<{ delegate: string; where: any }> = [];
  const db: any = new Proxy(
    {},
    {
      get: (_target, delegate: string) => ({
        findMany: async ({ where }: any) => {
          calls.push({ delegate, where });
          return rowsByDelegate[delegate] || [];
        },
      }),
    }
  );
  return { db, calls };
}

test('tenant CSV includes business fields but never credential fields', () => {
  const csv = buildTenantCsv('Employee', [
    {
      id: 'emp1',
      firstName: 'Ayesha',
      lastName: 'Khan',
      pin: '1234',
      passwordHash: 'dangerous-hash',
      restaurantId: 'rest1',
    },
  ]);

  assert.match(csv, /firstName/);
  assert.match(csv, /Ayesha/);
  assert.doesNotMatch(csv, /1234/);
  assert.doesNotMatch(csv, /dangerous-hash/);
  assert.doesNotMatch(csv, /"pin"|pin,/);
  assert.doesNotMatch(csv, /passwordHash/);
});

test('tenant export is scoped, excludes platform tables, and records counts only', async () => {
  const { db, calls } = fakeTenantDb({
    restaurant: [
      {
        id: 'rest1',
        name: '=HYPERLINK("http://evil.example","click")',
        slug: 'shop',
      },
    ],
    employee: [
      {
        id: 'emp1',
        firstName: 'Ayesha',
        pin: '1234',
        passwordHash: 'dangerous-hash',
        restaurantId: 'rest1',
      },
    ],
  });

  const { files, counts, totalRows } = await collectTenantExportData('rest1', db);

  assert.ok(calls.length >= 30, `expected all tenant tables to be queried, got ${calls.length}`);
  for (const call of calls) {
    assert.match(
      JSON.stringify(call.where),
      /rest1/,
      `${call.delegate} query must be scoped to the requested restaurant`
    );
  }
  const delegates = calls.map((call) => call.delegate);
  assert.ok(!delegates.includes('platformUser'));
  assert.ok(!delegates.includes('platformRefreshToken'));
  assert.ok(!delegates.includes('platformAuditLog'));
  assert.ok(!delegates.includes('refreshToken'));
  for (const nested of [
    'table',
    'employeePermission',
    'modifier',
    'orderItemModifier',
    'webOrderItem',
    'rolePermission',
    'payrollLine',
  ]) {
    assert.ok(delegates.includes(nested), `nested table ${nested} must be exported`);
  }

  assert.equal(files[0].name, 'README.txt');
  const readme = files[0].content;
  assert.match(readme, /PlatformUser/);
  assert.match(readme, /RefreshToken/);
  assert.match(readme, /Excluded fields/);
  assert.equal(counts.restaurants, 1);
  assert.equal(totalRows, 2);

  const allCsv = files
    .filter((file) => file.name.endsWith('.csv'))
    .map((file) => file.content)
    .join('\n');
  assert.doesNotMatch(allCsv, /dangerous-hash/);
  assert.doesNotMatch(allCsv, /"pin"|pin,/);
  assert.doesNotMatch(allCsv, /1234/);
  // Formula-looking text is neutralised before it reaches a spreadsheet.
  assert.match(allCsv, /'=HYPERLINK/);
});
