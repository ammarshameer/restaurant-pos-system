import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (relativePath) =>
  readFileSync(resolve(root, relativePath), 'utf8');

const orderApi = read('src/api/order.api.ts');
const invoices = read('src/pages/SaleInvoicesPage.tsx');
const session = read('src/lib/session.ts');
const app = read('src/App.tsx');
const apiClient = read('src/lib/api.ts');
const enterSupportBody = session.match(
  /export function enterSupportMode[\s\S]*?\n}/
)?.[0] || '';
const clearSessionBody = session.match(
  /export function clearSession[\s\S]*?\n}/
)?.[0] || '';

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
  [
    'support impersonation is stored per tab, not in the tenant session',
    enterSupportBody.includes('sessionStorage.setItem(SUPPORT_ACCESS_TOKEN_KEY') &&
      !enterSupportBody.includes('localStorage.setItem(ACCESS_TOKEN_KEY'),
  ],
  [
    'active token lookup prefers the support session',
    /export function getAccessToken[\s\S]*?isSupportMode\(\)/.test(session),
  ],
  [
    'API client and App use the active token helper',
    apiClient.includes('getAccessToken()') && app.includes('getAccessToken()'),
  ],
  [
    'support session cleanup never deletes the owner session',
    clearSessionBody.includes('if (isSupportMode())') &&
      !clearSessionBody.includes('localStorage.removeItem(ACCESS_TOKEN_KEY'),
  ],
  [
    'expired support tokens return to the platform, not an owner session',
    /const wasSupportSession = isSupportMode\(\)[\s\S]*?const destination = wasSupportSession \? '\/platform' : '\/login'/.test(apiClient),
  ],
  [
    'support logout returns to the platform',
    /const handleLogout = \(\) => \{[\s\S]*?const wasSupportSession = isSupportMode\(\)[\s\S]*?navigate\(wasSupportSession \? '\/platform' : '\/login'/.test(app),
  ],
  [
    'owner profile action is hidden in support mode',
    /const ownerProfileAllowed[\s\S]*?!user\?\.supportMode[\s\S]*?isSupportMode\(\)/.test(app),
  ],
  [
    'no raw tenant auth key reads remain in the app shell',
    !/localStorage\.(getItem|setItem)\('auth_token'/.test(app),
  ],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
  if (!passed) failed += 1;
}

if (failed > 0) {
  console.error(`Frontend contract check failed (${failed}/${checks.length}).`);
  process.exit(1);
}
console.log(`Frontend contract check passed (${checks.length}/${checks.length}).`);
