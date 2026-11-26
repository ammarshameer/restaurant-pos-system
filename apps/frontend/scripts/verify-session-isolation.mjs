import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = readFileSync(resolve(root, 'src/lib/session.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    _data: data,
  };
}

function loadSessionModule(localStorage, sessionStorage) {
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    localStorage,
    sessionStorage,
    console,
  });
  vm.runInContext(compiled, context);
  return module.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

// A normal owner session stays in localStorage across the whole flow.
const local = makeStorage();
const session = makeStorage();
const s = loadSessionModule(local, session);

s.storeSession({
  accessToken: 'owner-token',
  refreshToken: 'owner-refresh',
  user: { role: 'OWNER', isOwnerRole: true, restaurantId: 'restaurant-1' },
});
assert(s.getAccessToken() === 'owner-token', 'owner token reads from localStorage');
assert(s.getRefreshToken() === 'owner-refresh', 'owner refresh token is available');

s.enterSupportMode({
  accessToken: 'support-token',
  user: {
    role: 'OWNER',
    isOwnerRole: true,
    supportMode: true,
    restaurantId: 'restaurant-1',
  },
});
assert(
  local.getItem(s.ACCESS_TOKEN_KEY) === 'owner-token',
  'entering support mode does not overwrite the owner token'
);
assert(
  local.getItem(s.USER_KEY).includes('"role":"OWNER"'),
  'entering support mode does not overwrite the owner user'
);
assert(s.getAccessToken() === 'support-token', 'the support tab uses the support token');
assert(s.getStoredUser()?.supportMode === true, 'the support tab sees the support user');
assert(s.getRefreshToken() === null, 'support mode cannot refresh the owner session');

s.clearSession();
assert(
  local.getItem(s.ACCESS_TOKEN_KEY) === 'owner-token',
  'a support 401 does not clear the owner token'
);
assert(
  local.getItem(s.REFRESH_TOKEN_KEY) === 'owner-refresh',
  'a support 401 does not clear the owner refresh token'
);
assert(
  session.getItem(s.SUPPORT_ACCESS_TOKEN_KEY) === null,
  'a support 401 clears the tab-scoped support token'
);

// Legacy support sessions stored in tenant keys must not be treated as owners.
const legacyLocal = makeStorage({
  [s.ACCESS_TOKEN_KEY]: 'legacy-support-token',
  [s.USER_KEY]: JSON.stringify({ role: 'OWNER', supportMode: true }),
  [s.SUPPORT_MODE_KEY]: 'true',
});
loadSessionModule(legacyLocal, makeStorage());
assert(
  legacyLocal.getItem(s.ACCESS_TOKEN_KEY) === null &&
    legacyLocal.getItem(s.USER_KEY) === null,
  'legacy support sessions are purged on startup'
);
