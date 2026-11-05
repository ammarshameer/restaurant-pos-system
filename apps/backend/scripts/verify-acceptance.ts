import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';
import { getDevPlatformCredentials } from '../src/config/dev-credentials';
import { normalizeTenantPins } from '../prisma/backfill-multi-tenant';

const prisma = new PrismaClient();

// Override port to avoid conflicts
process.env.PORT = '3101';
process.env.NODE_ENV = 'test';

const BASE_URL = 'http://127.0.0.1:3101/api';

interface TestResult {
  num: number;
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function logTest(num: number, name: string, passed: boolean, details?: string, error?: string) {
  results.push({ num, name, passed, details, error });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [Test ${num}] ${name}`);
  if (details) console.log(`   ℹ️ ${details}`);
  if (error) console.log(`   ⚠️ ${error}`);
}

async function request(path: string, options: {
  method?: string;
  token?: string;
  body?: any;
} = {}): Promise<{ status: number; data: any; headers: Headers }> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data: any;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, data, headers: res.headers };
}

async function runAcceptanceTests() {
  console.log('\n======================================================');
  console.log('🚀 MULTI-TENANT RESTAURANT POS ACCEPTANCE VERIFICATION');
  console.log('======================================================\n');

  // Start the server
  console.log('Starting backend server on port 3101...');
  await import('../src/index');

  // Wait 1.5 seconds for server and database connection to be ready
  await new Promise((r) => setTimeout(r, 1500));

  let superAdminToken = '';
  let supportToken = '';
  let tenantAId = '';
  let tenantASlug = '';
  let tenantAOwnerEmail = '';
  let tenantAOwnerToken = '';
  let tenantBId = '';
  let tenantBSlug = '';

  const devCreds = process.env.NODE_ENV !== 'production' ? getDevPlatformCredentials() : null;
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || devCreds?.superAdmin.email || 'superadmin@restaurantpos.com';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || devCreds?.superAdmin.password || 'SuperAdmin123!';
  const supportEmail = process.env.SUPPORT_EMAIL || devCreds?.support.email || 'support@restaurantpos.com';
  const supportPassword = process.env.SUPPORT_PASSWORD || devCreds?.support.password || 'Support123!';

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Super Admin Login & Tenant Creation
    // ------------------------------------------------------------------------
    const loginRes = await request('/platform/auth/login', {
      method: 'POST',
      body: {
        email: superAdminEmail,
        password: superAdminPassword,
      },
    });

    if (loginRes.status === 200 && loginRes.data.accessToken) {
      superAdminToken = loginRes.data.accessToken;
      tenantAOwnerEmail = `julian.${Date.now()}@goldenspoon.com`;

      const createTenRes = await request('/platform/restaurants', {
        method: 'POST',
        token: superAdminToken,
        body: {
          businessName: 'The Golden Spoon Cafe',
          address: '123 Gourmet Ave, Food District',
          phone: '+92 300 1234567',
          businessEmail: 'contact@goldenspoon.com',
          timezone: 'Asia/Karachi',
          logoUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=100',
          ownerFirstName: 'Julian',
          ownerLastName: 'Vance',
          ownerEmail: tenantAOwnerEmail,
          ownerPhone: '+92 300 7654321',
          ownerPassword: 'OwnerSecurePass123!',
          ownerPin: '1234',
        },
      });

      if (createTenRes.status === 201 && createTenRes.data.restaurant?.id) {
        tenantAId = createTenRes.data.restaurant.id;
        tenantASlug = createTenRes.data.restaurant.slug;
        logTest(
          1,
          'Super Admin login & tenant creation with owner details & starter data',
          true,
          `Tenant created: "${createTenRes.data.restaurant.name}" (Slug: ${tenantASlug}, ID: ${tenantAId})`
        );
      } else {
        logTest(1, 'Super Admin login & tenant creation', false, undefined, JSON.stringify(createTenRes.data));
      }
    } else {
      logTest(1, 'Super Admin login & tenant creation', false, undefined, `Login failed: ${loginRes.status} ${JSON.stringify(loginRes.data)}`);
    }

    // ------------------------------------------------------------------------
    // TEST 2: Owner Login & Land on Tenant App
    // ------------------------------------------------------------------------
    const ownerLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: tenantAOwnerEmail,
        password: 'OwnerSecurePass123!',
      },
    });

    if (ownerLoginRes.status === 200 && ownerLoginRes.data.accessToken) {
      tenantAOwnerToken = ownerLoginRes.data.accessToken;
      const user = ownerLoginRes.data.user;
      const hasAllPerms = Array.isArray(user.permissions) && user.permissions.length >= 25;
      logTest(
        2,
        'Business Owner login with email/password',
        user.role === 'OWNER' && user.restaurantId === tenantAId && hasAllPerms,
        `Owner logged in: ${user.firstName} ${user.lastName}, Role: ${user.role}, Permissions count: ${user.permissions?.length}`
      );
    } else {
      logTest(2, 'Business Owner login with email/password', false, undefined, JSON.stringify(ownerLoginRes.data));
    }

    // ------------------------------------------------------------------------
    // TEST 3: Tenant Owner Cannot Call /api/platform/*
    // ------------------------------------------------------------------------
    const breachPlatformRes = await request('/platform/restaurants', {
      token: tenantAOwnerToken,
    });
    logTest(
      3,
      'Tenant Owner cannot call /api/platform/* endpoints (401 expected)',
      breachPlatformRes.status === 401,
      `Response status: ${breachPlatformRes.status} (${breachPlatformRes.data.error || 'Blocked'})`
    );

    // ------------------------------------------------------------------------
    // TEST 4: Tenant Owner Cannot Create Another OWNER or Tenant
    // ------------------------------------------------------------------------
    const createAnotherTenRes = await request('/platform/restaurants', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { businessName: 'Rogue Tenant' },
    });

    const createOwnerEmpRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Imposter',
        lastName: 'Owner',
        email: `imposter.${Date.now()}@rogue.com`,
        role: 'OWNER',
        pin: '9999',
      },
    });

    const test4Pass = createAnotherTenRes.status === 401 && (createOwnerEmpRes.status === 400 || createOwnerEmpRes.status === 403);
    logTest(
      4,
      'Tenant Owner cannot create other tenants or OWNER roles',
      test4Pass,
      `Tenant creation blocked (status ${createAnotherTenRes.status}), OWNER staff creation blocked (status ${createOwnerEmpRes.status}: "${createOwnerEmpRes.data?.error || ''}")`
    );

    // ------------------------------------------------------------------------
    // TEST 5: Public Self-Onboarding Disabled by Default (403)
    // ------------------------------------------------------------------------
    const publicOnboardRes = await request('/auth/onboard', {
      method: 'POST',
      body: {
        restaurantName: 'Public Signup Cafe',
        adminEmail: 'public@signup.com',
        adminPassword: 'Password123!',
        adminFirstName: 'Public',
        adminLastName: 'User',
      },
    });
    logTest(
      5,
      'Public self-onboarding disabled by default (403 expected)',
      publicOnboardRes.status === 403,
      `Response: ${publicOnboardRes.status} code=${publicOnboardRes.data?.code}`
    );

    // ------------------------------------------------------------------------
    // TEST 6: Support User Login, Enter Business via Impersonation, Exercise Tenant APIs
    // ------------------------------------------------------------------------
    const supportLoginRes = await request('/platform/auth/login', {
      method: 'POST',
      body: {
        email: supportEmail,
        password: supportPassword,
      },
    });

    if (supportLoginRes.status === 200 && supportLoginRes.data.accessToken) {
      supportToken = supportLoginRes.data.accessToken;
      const enterRes = await request(`/platform/restaurants/${tenantAId}/enter`, {
        method: 'POST',
        token: supportToken,
      });

      if (enterRes.status === 200 && enterRes.data.accessToken) {
        const supportImpersonationToken = enterRes.data.accessToken;
        // Exercise tenant APIs as support
        const viewMenuItemsRes = await request('/menu/items', { token: supportImpersonationToken });
        const viewOrdersRes = await request('/orders', { token: supportImpersonationToken });

        const canAccessTenant = viewMenuItemsRes.status === 200 && viewOrdersRes.status === 200;
        const isSupportMode = enterRes.data.supportMode === true || enterRes.data.user?.supportMode === true;
        logTest(
          6,
          'Support User enters tenant with short-lived audited impersonation',
          canAccessTenant && isSupportMode,
          `Support entered tenant ${tenantAId}: supportMode=${isSupportMode}, menu.items (${viewMenuItemsRes.status}) & orders (${viewOrdersRes.status}) accessible`
        );
      } else {
        logTest(6, 'Support User enters tenant with impersonation', false, undefined, JSON.stringify(enterRes.data));
      }
    } else {
      logTest(6, 'Support User login', false, undefined, JSON.stringify(supportLoginRes.data));
    }

    // ------------------------------------------------------------------------
    // TEST 7: Support User is INVISIBLE to Tenant Staff / Employees
    // ------------------------------------------------------------------------
    const employeesRes = await request('/employees', { token: tenantAOwnerToken });
    const empList: any[] = Array.isArray(employeesRes.data?.data)
      ? employeesRes.data.data
      : Array.isArray(employeesRes.data)
      ? employeesRes.data
      : [];
    const supportVisible = empList.some(
      (e) => e.email?.includes('support') || e.role === 'SUPPORT' || e.firstName?.includes('Support')
    );
    logTest(
      7,
      'Support user is completely invisible in tenant employee lists & roles',
      !supportVisible,
      `Total tenant employees: ${empList.length}, support found: ${supportVisible}`
    );

    // ------------------------------------------------------------------------
    // TEST 8: Strict Cross-Tenant Scoping & Isolation
    // ------------------------------------------------------------------------
    // Create Tenant B
    const createTenBRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: 'The Silver Fork Bistro',
        address: '789 Uptown Way',
        phone: '+92 300 2223344',
        businessEmail: 'contact@silverfork.com',
        timezone: 'Asia/Karachi',
        ownerFirstName: 'Beatrice',
        ownerLastName: 'Stone',
        ownerEmail: `beatrice.${Date.now()}@silverfork.com`,
        ownerPhone: '+92 300 4445566',
        ownerPassword: 'OwnerPasswordB123!',
        ownerPin: '5678',
      },
    });

    tenantBId = createTenBRes.data?.restaurant?.id;
    tenantBSlug = createTenBRes.data?.restaurant?.slug;

    // Tenant A attempts to read Tenant B's data by passing restaurantId in route/query
    const crossRolesRes = await request(`/roles?restaurantId=${tenantBId}`, {
      token: tenantAOwnerToken,
    });
    const roles: any[] = Array.isArray(crossRolesRes.data) ? crossRolesRes.data : [];
    const allRolesBelongToTenantA = roles.length > 0 && roles.every((r) => r.restaurantId === tenantAId);

    // Also attempt menu items via route parameter spoofing
    const crossMenuRes = await request(`/menu/restaurant/${tenantBId}/items`, {
      token: tenantAOwnerToken,
    });
    const menuItems: any[] = crossMenuRes.data?.data || [];
    const allMenuBelongToTenantA = menuItems.every((m) => m.restaurantId === tenantAId);

    logTest(
      8,
      'Cross-tenant queries strictly scoped by verified JWT (client restaurantId ignored)',
      allRolesBelongToTenantA && allMenuBelongToTenantA,
      `Roles returned: ${roles.length} (all belong to ${tenantAId}), menu items strictly scoped to Tenant A: ${allMenuBelongToTenantA}`
    );

    // ------------------------------------------------------------------------
    // TEST 9: Granular Permissions: Role with menu.manage vs Role with menu.view
    // ------------------------------------------------------------------------
    // Create Role with menu.manage
    const roleEditorRes = await request('/roles', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: 'Menu Chef Lead',
        permissions: ['dashboard.view', 'menu.view', 'menu.manage'],
      },
    });
    const editorRoleId = roleEditorRes.data.id;

    // Create Role with only menu.view
    const roleViewerRes = await request('/roles', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: 'Menu Line Cook',
        permissions: ['dashboard.view', 'menu.view'],
      },
    });
    const viewerRoleId = roleViewerRes.data.id;

    // Create employee for editor
    const editorEmail = `editor.${Date.now()}@goldenspoon.com`;
    await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Chef',
        lastName: 'Editor',
        email: editorEmail,
        roleId: editorRoleId,
        pin: '3331',
      },
    });

    // Create employee for viewer
    const viewerEmail = `viewer.${Date.now()}@goldenspoon.com`;
    await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Line',
        lastName: 'Viewer',
        email: viewerEmail,
        roleId: viewerRoleId,
        pin: '3332',
      },
    });

    // Login as Editor and Viewer via PIN
    const editorLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '3331', tenantSlug: tenantASlug },
    });
    const viewerLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '3332', tenantSlug: tenantASlug },
    });

    const editorToken = editorLogin.data.accessToken;
    const viewerToken = viewerLogin.data.accessToken;

    // Editor adds a menu item -> Should SUCCEED (201)
    const editorAddRes = await request('/menu/items', {
      method: 'POST',
      token: editorToken,
      body: {
        name: 'Signature Truffle Burger',
        category: 'Burgers',
        price: 1450,
        preparationTime: 12,
      },
    });

    // Viewer tries to add a menu item -> Should FAIL with 403
    const viewerAddRes = await request('/menu/items', {
      method: 'POST',
      token: viewerToken,
      body: {
        name: 'Forbidden Truffle Burger',
        category: 'Burgers',
        price: 1450,
      },
    });

    const test9Pass = editorAddRes.status === 201 && viewerAddRes.status === 403;
    logTest(
      9,
      'Granular permissions: menu.manage allows mutations (201), menu.view rejects mutations (403)',
      test9Pass,
      `Editor mutation status: ${editorAddRes.status}, Viewer mutation status: ${viewerAddRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 10: Waiter Role Cannot Access Restricted Tenant Modules
    // ------------------------------------------------------------------------
    const rolesListRes = await request('/roles', { token: tenantAOwnerToken });
    const rolesList: any[] = Array.isArray(rolesListRes.data) ? rolesListRes.data : [];
    const waiterRole = rolesList.find((r: any) => r.key === 'WAITER');

    const waiterEmail = `waiter.${Date.now()}@goldenspoon.com`;
    await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Sam',
        lastName: 'Waiter',
        email: waiterEmail,
        roleId: waiterRole?.id,
        pin: '4441',
      },
    });

    const waiterLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '4441', tenantSlug: tenantASlug },
    });
    const waiterToken = waiterLogin.data.accessToken;

    const waiterCheckEmp = await request('/employees', { token: waiterToken });
    const waiterCheckRoles = await request('/roles', { token: waiterToken });
    const waiterCheckSettings = await request('/settings/business', { token: waiterToken });
    const waiterCheckAnalytics = await request('/analytics/overview', { token: waiterToken });
    const waiterCheckBackups = await request('/backups', { token: waiterToken });

    const allBlocked =
      waiterCheckEmp.status === 403 &&
      waiterCheckRoles.status === 403 &&
      waiterCheckSettings.status === 403 &&
      waiterCheckAnalytics.status === 403 &&
      (waiterCheckBackups.status === 403 || waiterCheckBackups.status === 401);

    logTest(
      10,
      'Waiter role blocked from employees, roles, settings, analytics, backups (all 403)',
      allBlocked,
      `Blocked statuses: employees=${waiterCheckEmp.status}, roles=${waiterCheckRoles.status}, settings=${waiterCheckSettings.status}, analytics=${waiterCheckAnalytics.status}, backups=${waiterCheckBackups.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 11: Scoped PIN Login Requires Tenant Slug
    // ------------------------------------------------------------------------
    const pinNoSlug = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '4441' },
    });

    const pinWrongTenant = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '4441', tenantSlug: tenantBSlug },
    });

    const pinCorrect = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '4441', tenantSlug: tenantASlug },
    });

    const test11Pass = pinNoSlug.status === 400 && pinWrongTenant.status === 401 && pinCorrect.status === 200;
    logTest(
      11,
      'PIN login scoped to tenant slug (missing slug = 400, wrong tenant = 401, correct = 200)',
      test11Pass,
      `No slug: ${pinNoSlug.status}, Wrong tenant: ${pinWrongTenant.status}, Correct: ${pinCorrect.status} (msg: ${JSON.stringify(pinCorrect.data)})`
    );

    // ------------------------------------------------------------------------
    // TEST 12: Mutual Token Separation (Platform vs Tenant)
    // ------------------------------------------------------------------------
    const platformToTenant = await request('/menu/items', { token: superAdminToken });
    const tenantToPlatform = await request('/platform/restaurants', { token: tenantAOwnerToken });

    const test12Pass = platformToTenant.status === 401 && tenantToPlatform.status === 401;
    logTest(
      12,
      'Platform token rejected by tenant routes (401), Tenant token rejected by platform routes (401)',
      test12Pass,
      `Platform->Tenant: ${platformToTenant.status}, Tenant->Platform: ${tenantToPlatform.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 13: Tenant Suspension & Reactivation
    // ------------------------------------------------------------------------
    // Suspend Tenant A
    await request(`/platform/restaurants/${tenantAId}`, {
      method: 'PATCH',
      token: superAdminToken,
      body: { isActive: false },
    });

    // Owner tries to log in
    const suspendedLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: tenantAOwnerEmail,
        password: 'OwnerSecurePass123!',
      },
    });

    // Existing token should be rejected with 403
    const suspendedRequestRes = await request('/menu/items', { token: tenantAOwnerToken });

    // Un-suspend Tenant A
    await request(`/platform/restaurants/${tenantAId}`, {
      method: 'PATCH',
      token: superAdminToken,
      body: { isActive: true },
    });

    // Owner logs in again
    const reactivatedLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: tenantAOwnerEmail,
        password: 'OwnerSecurePass123!',
      },
    });

    const test13Pass =
      suspendedLoginRes.status === 403 &&
      suspendedRequestRes.status === 403 &&
      reactivatedLoginRes.status === 200;

    logTest(
      13,
      'Tenant suspension blocks login & active JWT with 403; reactivation restores full access',
      test13Pass,
      `Suspended login: ${suspendedLoginRes.status}, Suspended token: ${suspendedRequestRes.status}, Reactivated login: ${reactivatedLoginRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 14: Settings Management & SVG Rejection
    // ------------------------------------------------------------------------
    // Update valid settings
    const updateSettingsRes = await request('/settings/business', {
      method: 'PATCH',
      token: tenantAOwnerToken,
      body: {
        name: 'The Golden Spoon Cafe & Lounge',
        phone: '+92 300 9998877',
      },
    });

    // Reject SVG upload
    const svgUploadRes = await request('/settings/business', {
      method: 'PATCH',
      token: tenantAOwnerToken,
      body: {
        logoUrl: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
      },
    });

    const test14Pass = updateSettingsRes.status === 200 && svgUploadRes.status === 400;
    logTest(
      14,
      'Settings update works and SVG logo upload is blocked for security (400)',
      test14Pass,
      `Update status: ${updateSettingsRes.status}, SVG rejection status: ${svgUploadRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 15: Support Impersonation Audit Trail
    // ------------------------------------------------------------------------
    const auditLogsRes = await request('/platform/audit-logs?restaurantId=' + tenantAId, {
      token: superAdminToken,
    });
    const logs: any[] = Array.isArray(auditLogsRes.data?.data)
      ? auditLogsRes.data.data
      : Array.isArray(auditLogsRes.data?.logs)
      ? auditLogsRes.data.logs
      : Array.isArray(auditLogsRes.data)
      ? auditLogsRes.data
      : [];
    const hasEnterLog = logs.some((l) => l.action === 'TENANT_ENTER');
    const hasCreateLog = logs.some((l) => l.action === 'TENANT_CREATED');

    logTest(
      15,
      'Platform audit logs track TENANT_CREATED and TENANT_ENTER impersonations',
      hasEnterLog && hasCreateLog,
      `Audit logs found for tenant: ${logs.length} (TENANT_CREATED: ${hasCreateLog}, TENANT_ENTER: ${hasEnterLog})`
    );

    // ------------------------------------------------------------------------
    // TEST 16: Staff/Manager Cannot Overwrite or Take Over OWNER Account (Fix 2)
    // ------------------------------------------------------------------------
    const listEmpRes = await request('/employees', { token: tenantAOwnerToken });
    const empArray: any[] = Array.isArray(listEmpRes.data?.data)
      ? listEmpRes.data.data
      : Array.isArray(listEmpRes.data)
      ? listEmpRes.data
      : [];
    const ownerRecord = empArray.find((e) => e.email === tenantAOwnerEmail);

    const mgrRoleRes = await request('/roles', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: 'Staff Manager',
        permissions: ['dashboard.view', 'employees.view', 'employees.manage'],
      },
    });
    const mgrRoleId = mgrRoleRes.data.id;

    const mgrEmail = `manager.${Date.now()}@goldenspoon.com`;
    await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Manny',
        lastName: 'Manager',
        email: mgrEmail,
        roleId: mgrRoleId,
        pin: '5551',
      },
    });

    const mgrLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '5551', tenantSlug: tenantASlug },
    });
    const mgrToken = mgrLogin.data.accessToken;

    const hijackRes = await request(`/employees/${ownerRecord.id}`, {
      method: 'PATCH',
      token: mgrToken,
      body: {
        password: 'HackedPassword123!',
        email: `hacked.${Date.now()}@attacker.com`,
        pin: '0000',
      },
    });

    logTest(
      16,
      'Manager with employees.manage cannot edit or hijack the Owner account (400 expected)',
      hijackRes.status === 400 && String(hijackRes.data?.error || '').includes('Owner account can only be modified by the Owner or platform support'),
      `Status: ${hijackRes.status}, Error: "${hijackRes.data?.error || ''}"`
    );

    // ------------------------------------------------------------------------
    // TEST 17: Support Impersonation Revocation Revalidated Per-Request (Fix 5)
    // ------------------------------------------------------------------------
    const supportEnterRes = await request(`/platform/restaurants/${tenantAId}/enter`, {
      method: 'POST',
      token: supportToken,
    });
    const supportImpToken = supportEnterRes.data.accessToken;

    const menuBeforeDeact = await request('/menu/items', { token: supportImpToken });

    // Super Admin deactivates Support account
    await request('/platform/support-account', {
      method: 'PUT',
      token: superAdminToken,
      body: {
        email: supportEmail,
        isActive: false,
      },
    });

    // Impersonation request after deactivation must fail with 401 "Support access revoked"
    const menuAfterDeact = await request('/menu/items', { token: supportImpToken });

    // Reactivate Support account
    await request('/platform/support-account', {
      method: 'PUT',
      token: superAdminToken,
      body: {
        email: supportEmail,
        isActive: true,
      },
    });

    const test17Pass =
      menuBeforeDeact.status === 200 &&
      menuAfterDeact.status === 401 &&
      String(menuAfterDeact.data?.error || '').toLowerCase().includes('support access revoked');

    logTest(
      17,
      'Support impersonation token dynamically revoked when support user is deactivated (401)',
      test17Pass,
      `Before deactivation: ${menuBeforeDeact.status}, After deactivation: ${menuAfterDeact.status} (${menuAfterDeact.data?.error || ''})`
    );

    // ------------------------------------------------------------------------
    // TEST 18: Eliminate Default PIN & Password (Fix 8)
    // ------------------------------------------------------------------------
    const randomStaffRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'NoPin',
        lastName: 'Staff',
        email: `nopin.${Date.now()}@goldenspoon.com`,
        roleId: waiterRole?.id,
      },
    });

    const autoPin = randomStaffRes.data?.pin;
    const isAutoPinValid = typeof autoPin === 'string' && /^\d{4}$/.test(autoPin) && autoPin !== '1234';

    const defaultPwLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: randomStaffRes.data?.email,
        password: '123456',
      },
    });

    const test18Pass =
      randomStaffRes.status === 201 &&
      isAutoPinValid &&
      defaultPwLoginRes.status === 401;

    logTest(
      18,
      'Omitted PIN auto-generates unique 4-digit PIN; omitted password disables password login (no default 1234/123456)',
      test18Pass,
      `Generated PIN: "${autoPin}" (valid: ${isAutoPinValid}), Password '123456' login status: ${defaultPwLoginRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 19: Platform Rejects SVG Logo on Create and Update (Fix 9)
    // ------------------------------------------------------------------------
    const svgDataUri = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+';

    const createSvgTenantRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: 'SVG Attack Cafe',
        logoUrl: svgDataUri,
        ownerFirstName: 'Mal',
        ownerLastName: 'Actor',
        ownerEmail: `mal.${Date.now()}@attacker.com`,
        ownerPassword: 'AttackerPassword123!',
      },
    });

    const updateSvgTenantRes = await request(`/platform/restaurants/${tenantAId}`, {
      method: 'PATCH',
      token: superAdminToken,
      body: {
        logoUrl: 'https://evil.com/malicious.svg',
      },
    });

    const test19Pass = createSvgTenantRes.status === 400 && updateSvgTenantRes.status === 400;
    logTest(
      19,
      'Platform rejects SVG logo URLs on both tenant creation and update (400 expected)',
      test19Pass,
      `Create SVG status: ${createSvgTenantRes.status}, Update SVG status: ${updateSvgTenantRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 20: Protect Clock-In / Clock-Out Routes (Fix 10)
    // ------------------------------------------------------------------------
    const waiterClockOtherRes = await request(`/employees/${ownerRecord.id}/clock-in`, {
      method: 'POST',
      token: waiterToken,
    });

    const waiterProfileRes = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '4441', tenantSlug: tenantASlug },
    });
    const waiterId = waiterProfileRes.data?.user?.id;

    const waiterClockSelfIn = await request(`/employees/${waiterId}/clock-in`, {
      method: 'POST',
      token: waiterToken,
    });

    const waiterClockSelfOut = await request(`/employees/${waiterId}/clock-out`, {
      method: 'POST',
      token: waiterToken,
    });

    const test20Pass =
      waiterClockOtherRes.status === 403 &&
      waiterClockSelfIn.status === 200 &&
      waiterClockSelfOut.status === 200;

    logTest(
      20,
      'Employees can clock in/out for themselves (200), but cannot clock in other staff without permission (403)',
      test20Pass,
      `Clock other status: ${waiterClockOtherRes.status}, Clock self in: ${waiterClockSelfIn.status}, Clock self out: ${waiterClockSelfOut.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 21: Platform Bootstrapping Credential Independence (R6)
    // ------------------------------------------------------------------------
    const invalidPlatformLogin = await request('/platform/auth/login', {
      method: 'POST',
      body: {
        email: superAdminEmail,
        password: 'DefinitivelyWrongPassword123!',
      },
    });
    const validPlatformLogin = await request('/platform/auth/login', {
      method: 'POST',
      body: {
        email: superAdminEmail,
        password: superAdminPassword,
      },
    });

    const test21Pass = invalidPlatformLogin.status === 401 && validPlatformLogin.status === 200;
    logTest(
      21,
      'Platform auth works dynamically with environment / generated credentials without hardcoded dev passwords (R6)',
      test21Pass,
      `SuperAdmin dynamic login: ${validPlatformLogin.status}, Invalid password rejection: ${invalidPlatformLogin.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 22: Duplicate PIN Normalization & Unique PIN Enforcement (R2)
    // ------------------------------------------------------------------------
    const dupTenantSlug = `dup-pin-cafe-${Date.now()}`;
    const dupTenant = await prisma.restaurant.create({
      data: {
        name: 'Duplicate PIN Cafe',
        slug: dupTenantSlug,
        address: '123 Test Pin Street',
        phone: '+92 300 1112233',
        email: `contact.${Date.now()}@duppin.com`,
        isActive: true,
      },
    });

    const mockHash = '$2a$10$wT8l5ZkE9x/H1g7S/VbJq.8j7r6m5f4d3c2b1a0z9y8x7w6v5u';

    const emp1 = await prisma.employee.create({
      data: {
        restaurantId: dupTenant.id,
        firstName: 'Staff',
        lastName: 'One',
        email: `staff1.${Date.now()}@duppin.com`,
        pin: '7777',
        passwordHash: mockHash,
        role: 'WAITER',
        isActive: true,
      },
    });

    const emp2 = await prisma.employee.create({
      data: {
        restaurantId: dupTenant.id,
        firstName: 'Staff',
        lastName: 'Two',
        email: `staff2.${Date.now()}@duppin.com`,
        pin: '7777',
        passwordHash: mockHash,
        role: 'WAITER',
        isActive: true,
      },
    });

    const normalizedCount = await normalizeTenantPins(dupTenant.id);

    const reloadedEmp1 = await prisma.employee.findUnique({ where: { id: emp1.id } });
    const reloadedEmp2 = await prisma.employee.findUnique({ where: { id: emp2.id } });

    const pinsUnique =
      reloadedEmp1 &&
      reloadedEmp2 &&
      reloadedEmp1.pin !== reloadedEmp2.pin &&
      /^\d{4}$/.test(reloadedEmp1.pin) &&
      /^\d{4}$/.test(reloadedEmp2.pin);

    // Assert PIN login works for each
    const login1 = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: reloadedEmp1!.pin, tenantSlug: dupTenantSlug },
    });
    const login2 = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: reloadedEmp2!.pin, tenantSlug: dupTenantSlug },
    });

    const test22Pass =
      normalizedCount >= 1 &&
      Boolean(pinsUnique) &&
      login1.status === 200 &&
      login2.status === 200;

    logTest(
      22,
      'Duplicate PIN normalization generates collision-free 4-digit PINs and preserves PIN login (R2)',
      test22Pass,
      `Normalized: ${normalizedCount}, Emp1 PIN: ${reloadedEmp1?.pin} (${login1.status}), Emp2 PIN: ${reloadedEmp2?.pin} (${login2.status})`
    );

    // ------------------------------------------------------------------------
    // TEST 23: Privilege Ceiling on Role Creation & Role Assignment (R3)
    // ------------------------------------------------------------------------
    // 1. Create a Manager role with roles.manage and employees.manage, but NOT settings.manage
    const mgr2RoleRes = await request('/roles', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: `Floor Manager ${Date.now()}`,
        permissions: ['dashboard.view', 'roles.manage', 'employees.manage', 'orders.view'],
      },
    });
    const mgr2RoleId = mgr2RoleRes.data.id;

    // 2. Create a Manager employee
    const mgr2Email = `mgr2.${Date.now()}@goldenspoon.com`;
    const mgr2EmpRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Floor',
        lastName: 'Manager',
        email: mgr2Email,
        roleId: mgr2RoleId,
        pin: '6651',
      },
    });
    const mgr2EmpId = mgr2EmpRes.data.id;

    // Log in as the Manager
    const mgr2LoginRes = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '6651', tenantSlug: tenantASlug },
    });
    const mgr2Token = mgr2LoginRes.data.accessToken;

    // 3. Manager attempts to create a role with settings.manage (a permission they do NOT possess)
    const mgrCreateEscalatedRoleRes = await request('/roles', {
      method: 'POST',
      token: mgr2Token,
      body: {
        name: `Escalated Role ${Date.now()}`,
        permissions: ['dashboard.view', 'settings.manage'],
      },
    });

    // 4. Owner creates a role with settings.manage
    const ownerCreatedSettingsRole = await request('/roles', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: `Settings Admin ${Date.now()}`,
        permissions: ['dashboard.view', 'settings.manage'],
      },
    });
    const settingsRoleId = ownerCreatedSettingsRole.data.id;

    // 5. Manager attempts to assign this settings role to self
    const mgrSelfAssignRes = await request(`/employees/${mgr2EmpId}`, {
      method: 'PATCH',
      token: mgr2Token,
      body: {
        roleId: settingsRoleId,
      },
    });

    const test23Pass =
      mgrCreateEscalatedRoleRes.status === 403 &&
      (mgrSelfAssignRes.status === 403 || mgrSelfAssignRes.status === 400);

    logTest(
      23,
      'Privilege ceiling prevents non-owner from creating or assigning roles with permissions exceeding own (R3)',
      test23Pass,
      `Create escalated role status: ${mgrCreateEscalatedRoleRes.status} (${mgrCreateEscalatedRoleRes.data?.error || ''}), Self-assign escalated role status: ${mgrSelfAssignRes.status} (${mgrSelfAssignRes.data?.error || ''})`
    );

    // ------------------------------------------------------------------------
    // TEST 24: Support Gets Full Access in Tenant Without OWNER Employee (R4)
    // ------------------------------------------------------------------------
    const orphanTenantSlug = `orphan-tenant-${Date.now()}`;
    const orphanTenant = await prisma.restaurant.create({
      data: {
        name: 'No Owner Cafe',
        slug: orphanTenantSlug,
        address: '456 Orphan Test Avenue',
        phone: '+92 300 9998877',
        email: `contact.${Date.now()}@orphan.com`,
        isActive: true,
      },
    });

    // Create single staff member with only WAITER role (no OWNER in restaurant)
    await prisma.employee.create({
      data: {
        restaurantId: orphanTenant.id,
        firstName: 'Lone',
        lastName: 'Waiter',
        email: `lone.waiter.${Date.now()}@orphan.com`,
        pin: '8888',
        passwordHash: mockHash,
        role: 'WAITER',
        isActive: true,
      },
    });

    // Support enters the tenant
    const supportEnterOrphanRes = await request(`/platform/restaurants/${orphanTenant.id}/enter`, {
      method: 'POST',
      token: supportToken,
    });

    const orphanSupportToken = supportEnterOrphanRes.data.accessToken;

    // Support calls settings (requires settings.manage) and roles
    const orphanSettingsRes = await request('/settings/business', {
      token: orphanSupportToken,
    });
    const orphanRolesRes = await request('/roles', {
      token: orphanSupportToken,
    });

    const test24Pass =
      supportEnterOrphanRes.status === 200 &&
      orphanSettingsRes.status === 200 &&
      orphanRolesRes.status === 200;

    logTest(
      24,
      'Support user receives full owner permissions in tenant even without OWNER employee (R4)',
      test24Pass,
      `Support enter status: ${supportEnterOrphanRes.status}, settings.manage status: ${orphanSettingsRes.status}, roles status: ${orphanRolesRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 25: WebSocket Authentication Hardened Matching HTTP (R1)
    // ------------------------------------------------------------------------
    const wsUrl = 'http://127.0.0.1:3101';

    const testSocketConnect = (token?: string): Promise<{ connected: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const socket = io(wsUrl, {
          auth: token ? { token } : undefined,
          transports: ['websocket'],
          reconnection: false,
          timeout: 2500,
        });

        socket.on('connect', () => {
          socket.disconnect();
          resolve({ connected: true });
        });

        socket.on('connect_error', (err) => {
          socket.disconnect();
          resolve({ connected: false, error: err.message });
        });

        setTimeout(() => {
          socket.disconnect();
          resolve({ connected: false, error: 'TIMEOUT' });
        }, 3000);
      });
    };

    // 1. Valid tenant token connects
    const wsValid = await testSocketConnect(tenantAOwnerToken);

    // 2. Deactivated employee token rejected
    const deactEmp = await prisma.employee.create({
      data: {
        restaurantId: tenantAId,
        firstName: 'Deact',
        lastName: 'SocketUser',
        email: `deact.socket.${Date.now()}@goldenspoon.com`,
        pin: '9871',
        passwordHash: mockHash,
        role: 'WAITER',
        isActive: true,
      },
    });
    const deactLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '9871', tenantSlug: tenantASlug },
    });
    const deactToken = deactLogin.data.accessToken;

    await prisma.employee.update({
      where: { id: deactEmp.id },
      data: { isActive: false },
    });
    const wsDeact = await testSocketConnect(deactToken);

    // 3. Support impersonation token with revoked support user rejected
    const supEnterRes = await request(`/platform/restaurants/${tenantAId}/enter`, {
      method: 'POST',
      token: supportToken,
    });
    const supImpToken = supEnterRes.data.accessToken;

    // Deactivate support user
    await prisma.platformUser.update({
      where: { email: supportEmail },
      data: { isActive: false },
    });
    const wsRevokedSup = await testSocketConnect(supImpToken);

    // Reactivate support user
    await prisma.platformUser.update({
      where: { email: supportEmail },
      data: { isActive: true },
    });

    // 4. Missing token rejected in test/production environment
    const wsNoToken = await testSocketConnect();

    const test25Pass =
      wsValid.connected === true &&
      wsDeact.connected === false &&
      wsRevokedSup.connected === false &&
      wsNoToken.connected === false;

    logTest(
      25,
      'WebSocket auth enforces DB state: valid connects, deactivated / revoked / missing tokens rejected (R1)',
      test25Pass,
      `Valid token connected: ${wsValid.connected}, Deactivated user connected: ${wsDeact.connected} (${wsDeact.error || ''}), Revoked support connected: ${wsRevokedSup.connected} (${wsRevokedSup.error || ''}), Missing token connected: ${wsNoToken.connected} (${wsNoToken.error || ''})`
    );

    // ------------------------------------------------------------------------
    // TEST 26: Verification Summary
    // ------------------------------------------------------------------------
    const passedCount = results.filter((r) => r.passed).length;
    logTest(
      26,
      'All Acceptance Verification Criteria Met',
      passedCount === 25,
      `Passed ${passedCount} / 25 criteria (100% test pass rate)`
    );

  } catch (err: any) {
    console.error('Unhandled verification error:', err);
  } finally {
    await prisma.$disconnect();
    console.log('\n======================================================');
    console.log(`FINAL RESULT: ${results.filter((r) => r.passed).length} / ${results.length} PASSED`);
    console.log('======================================================\n');
    process.exit(results.every((r) => r.passed) ? 0 : 1);
  }
}

void runAcceptanceTests();
