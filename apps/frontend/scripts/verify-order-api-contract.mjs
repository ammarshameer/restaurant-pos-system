import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (relativePath) =>
  readFileSync(resolve(root, relativePath), 'utf8');

const orderApi = read('src/api/order.api.ts');
const invoices = read('src/pages/SaleInvoicesPage.tsx');

const checks = [
  [
    'mapOrderRecord restores discount fields from the backend',
    /mapOrderRecord[\s\S]*?discountPercent[\s\S]*?discountAmount/.test(orderApi),
  ],
  [
    'buildOrderPayload sends discountPercent to the backend',
    /buildOrderPayload[\s\S]*?discountPercent/.test(orderApi),
  ],
  [
    'buildOrderPayload sends discountAmount to the backend',
    /buildOrderPayload[\s\S]*?discountAmount/.test(orderApi),
  ],
  [
    'updateOrder payload preserves discount fields',
    /updateOrder:[\s\S]*?discountPercent[\s\S]*?discountAmount/.test(orderApi),
  ],
  [
    'invoice receipt includes discount fields',
    /const receipt: ReceiptData[\s\S]*?discountPercent[\s\S]*?discountAmount/.test(invoices),
  ],
  [
    'invoice edit total stays net of the preserved discount',
    /editSubtotal[\s\S]*?-\s*editDiscountAmount/.test(invoices),
  ],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
  if (!passed) failed += 1;
}

if (failed > 0) {
  console.error(`Order API contract check failed (${failed}/${checks.length}).`);
  process.exit(1);
}
console.log(`Order API contract check passed (${checks.length}/${checks.length}).`);
