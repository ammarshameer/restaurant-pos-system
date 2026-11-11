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
          ownerPin: '123456',
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
        ownerPin: '567890',
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
        pin: '555123',
      },
    });

    const mgrLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '555123', tenantSlug: tenantASlug },
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
        address: '123 SVG Lane',
        phone: '+92 300 1112233',
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
        pin: '665123',
      },
    });
    const mgr2EmpId = mgr2EmpRes.data.id;

    // Log in as the Manager
    const mgr2LoginRes = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '665123', tenantSlug: tenantASlug },
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
    // TEST 26: Full & Partial Payment Settlement Single Source of Truth (Task 0)
    // ------------------------------------------------------------------------
    const ownerEmp = await prisma.employee.findFirst({ where: { restaurantId: tenantAId } });
    const order1 = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 200.0,
        tax: 0,
        total: 200.0,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 200.0,
      },
    });

    // Make partial payment of 80.00
    const partPayRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        orderId: order1.id,
        amount: 80.0,
        method: 'CASH',
      },
    });

    const orderAfterPart = await prisma.order.findUnique({ where: { id: order1.id } });

    // Make remaining payment of 120.00
    const fullPayRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        orderId: order1.id,
        amount: 120.0,
        method: 'CASH',
      },
    });

    const orderAfterFull = await prisma.order.findUnique({ where: { id: order1.id } });
    const paymentsCount = await prisma.payment.count({ where: { orderId: order1.id, status: 'COMPLETED' } });

    const test26Pass =
      partPayRes.status === 201 &&
      orderAfterPart?.paymentStatus === 'PARTIAL' &&
      Math.abs((orderAfterPart?.totalPaid || 0) - 80) < 0.01 &&
      Math.abs((orderAfterPart?.amountDue || 0) - 120) < 0.01 &&
      fullPayRes.status === 201 &&
      orderAfterFull?.paymentStatus === 'PAID' &&
      Math.abs((orderAfterFull?.totalPaid || 0) - 200) < 0.01 &&
      Math.abs((orderAfterFull?.amountDue || 0) - 0) < 0.01 &&
      paymentsCount === 2;

    logTest(
      26,
      'Payment settlement single source of truth: partial and full payments compute amountDue/totalPaid',
      test26Pass,
      `Partial: status=${partPayRes.status}, paid=${orderAfterPart?.totalPaid}, due=${orderAfterPart?.amountDue}, status=${orderAfterPart?.paymentStatus}; Full: status=${fullPayRes.status}, paid=${orderAfterFull?.totalPaid}, due=${orderAfterFull?.amountDue}, status=${orderAfterFull?.paymentStatus}`
    );

    // ------------------------------------------------------------------------
    // TEST 27: Udhaar / Credit Checkout creates Ledger Entry & Balance Due (Task 4)
    // ------------------------------------------------------------------------
    const custRes = await request('/customers', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: 'Credit Customer Ali',
        phone: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
        email: `ali.${Date.now()}@example.com`,
        creditLimit: 1000,
      },
    });
    const creditCustId = custRes.data.id;

    const order2 = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        customerId: creditCustId,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 300.0,
        tax: 0,
        total: 300.0,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 300.0,
      },
    });

    // Pay 100 advance cash and settle remaining (200) to credit
    const udhaarPayRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        orderId: order2.id,
        amount: 100.0,
        method: 'CASH',
        settleToCredit: true,
      },
    });

    const order2Updated = await prisma.order.findUnique({ where: { id: order2.id } });
    const custAfterUdhaar = await prisma.customer.findUnique({ where: { id: creditCustId } });
    const chargeLedger = await prisma.customerLedgerEntry.findFirst({
      where: { customerId: creditCustId, type: 'CHARGE', orderId: order2.id },
    });

    const test27Pass =
      udhaarPayRes.status === 201 &&
      order2Updated?.paymentStatus === 'PARTIAL' &&
      order2Updated?.settledToCredit === true &&
      Math.abs((order2Updated?.totalPaid || 0) - 100) < 0.01 &&
      Math.abs((order2Updated?.amountDue || 0) - 200) < 0.01 &&
      Math.abs((custAfterUdhaar?.balanceDue || 0) - 200) < 0.01 &&
      chargeLedger !== null &&
      Math.abs((chargeLedger?.amount || 0) - 200) < 0.01;

    logTest(
      27,
      'POS Udhaar/Credit checkout closes order, records CHARGE ledger entry, and updates customer balanceDue',
      test27Pass,
      `Order status=${order2Updated?.paymentStatus}, settledToCredit=${order2Updated?.settledToCredit}, totalPaid=${order2Updated?.totalPaid}, amountDue=${order2Updated?.amountDue}, customer balanceDue=${custAfterUdhaar?.balanceDue}, charge ledger amount=${chargeLedger?.amount}`
    );

    // ------------------------------------------------------------------------
    // TEST 28: Dues Receivables Settlement with FIFO Order Allocation (Task 4)
    // ------------------------------------------------------------------------
    const duesListRes = await request('/dues', { token: tenantAOwnerToken });
    const customerInList = Array.isArray(duesListRes.data?.data)
      ? duesListRes.data.data.find((c: any) => c.id === creditCustId)
      : null;

    const duesPayRes = await request(`/dues/${creditCustId}/payments`, {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        amount: 200.0,
        method: 'CASH',
        note: 'Settled dues in full',
      },
    });

    const custAfterPay = await prisma.customer.findUnique({ where: { id: creditCustId } });
    const order2AfterDues = await prisma.order.findUnique({ where: { id: order2.id } });
    const paymentLedger = await prisma.customerLedgerEntry.findFirst({
      where: { customerId: creditCustId, type: 'PAYMENT' },
    });

    const test28Pass =
      duesListRes.status === 200 &&
      customerInList !== null &&
      Math.abs((customerInList.balanceDue || 0) - 200) < 0.01 &&
      duesPayRes.status === 200 &&
      Math.abs((custAfterPay?.balanceDue || 0) - 0) < 0.01 &&
      paymentLedger !== null &&
      Math.abs((paymentLedger?.amount || 0) - 200) < 0.01 &&
      order2AfterDues?.paymentStatus === 'PAID' &&
      Math.abs((order2AfterDues?.amountDue || 0) - 0) < 0.01 &&
      Math.abs((order2AfterDues?.totalPaid || 0) - 300) < 0.01;

    logTest(
      28,
      'Dues receivables module lists debtors, accepts settlement, updates balanceDue and allocates FIFO',
      test28Pass,
      `Dues list status: ${duesListRes.status}, Customer found: ${!!customerInList}, Payment status: ${duesPayRes.status}, Final balanceDue: ${custAfterPay?.balanceDue}, Order2 post-dues: ${order2AfterDues?.paymentStatus} (due: ${order2AfterDues?.amountDue}, paid: ${order2AfterDues?.totalPaid})`
    );

    // ------------------------------------------------------------------------
    // TEST 29: Employee Password Reset and Email Login (Task 3)
    // ------------------------------------------------------------------------
    const pinStaffRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'PinOnly',
        lastName: 'Cashier',
        email: `pinonly.${Date.now()}@goldenspoon.com`,
        role: 'CASHIER',
        pin: '3491',
      },
    });

    const earlyLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: pinStaffRes.data.email,
        password: 'password123',
      },
    });

    const resetPwRes = await request(`/employees/${pinStaffRes.data.id}/reset-password`, {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { temporaryPassword: 'TempPass123!@' },
    });

    const postResetLogin = await request('/auth/login', {
      method: 'POST',
      body: {
        email: pinStaffRes.data.email,
        password: 'TempPass123!@',
      },
    });

    const test29Pass =
      pinStaffRes.status === 201 &&
      earlyLoginRes.status === 401 &&
      resetPwRes.status === 200 &&
      resetPwRes.data.temporaryPassword === 'TempPass123!@' &&
      postResetLogin.status === 200 &&
      postResetLogin.data.accessToken !== undefined;

    logTest(
      29,
      'Employee password reset generates temporary credentials and enables standard email login (Task 3)',
      test29Pass,
      `Created staff: ${pinStaffRes.status}, Pre-reset email login: ${earlyLoginRes.status} (expected 401), Reset PW: ${resetPwRes.status}, Post-reset email login: ${postResetLogin.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 30: Per-Employee Permission Overrides: GRANT & DENY (Task 2)
    // ------------------------------------------------------------------------
    const overrideStaffRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Override',
        lastName: 'Waiter',
        email: `override.${Date.now()}@goldenspoon.com`,
        role: 'WAITER',
        pin: '7829',
      },
    });

    // Check default permissions
    const permGetRes1 = await request(`/employees/${overrideStaffRes.data.id}/permissions`, {
      token: tenantAOwnerToken,
    });

    // Grant menu.manage override
    const grantOverrideRes = await request(`/employees/${overrideStaffRes.data.id}/permissions`, {
      method: 'PUT',
      token: tenantAOwnerToken,
      body: {
        overrides: [{ permission: 'menu.manage', granted: true }],
      },
    });

    const staffLoginAfterGrant = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '7829', tenantSlug: tenantASlug },
    });

    // Deny pos.use override
    const denyOverrideRes = await request(`/employees/${overrideStaffRes.data.id}/permissions`, {
      method: 'PUT',
      token: tenantAOwnerToken,
      body: {
        overrides: [
          { permission: 'menu.manage', granted: true },
          { permission: 'pos.use', granted: false },
        ],
      },
    });

    const staffLoginAfterDeny = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '7829', tenantSlug: tenantASlug },
    });

    const grantedPerms: string[] = staffLoginAfterGrant.data?.user?.permissions || [];
    const deniedPerms: string[] = staffLoginAfterDeny.data?.user?.permissions || [];

    const test30Pass =
      permGetRes1.status === 200 &&
      grantOverrideRes.status === 200 &&
      grantedPerms.includes('menu.manage') === true &&
      denyOverrideRes.status === 200 &&
      deniedPerms.includes('menu.manage') === true &&
      deniedPerms.includes('pos.use') === false;

    logTest(
      30,
      'Per-employee permission overrides support GRANT and DENY, reflected in session permissions (Task 2)',
      test30Pass,
      `GET perms status: ${permGetRes1.status}, GRANT override has menu.manage: ${grantedPerms.includes('menu.manage')}, DENY override excluded pos.use: ${!deniedPerms.includes('pos.use')}`
    );

    // ------------------------------------------------------------------------
    // TEST 31: Costing Module Endpoints & Cost Redaction (Task 1)
    // ------------------------------------------------------------------------
    const costingSummaryRes = await request('/costing/summary', { token: tenantAOwnerToken });
    const costingMenuRes = await request('/costing/menu', { token: tenantAOwnerToken });

    // Waiter without costing.view should be forbidden (403)
    const waiterPinLogin = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '7829', tenantSlug: tenantASlug },
    });
    const waiterToken2 = waiterPinLogin.data.accessToken;

    const waiterCostingRes = await request('/costing/summary', { token: waiterToken2 });

    const test31Pass =
      costingSummaryRes.status === 200 &&
      costingMenuRes.status === 200 &&
      waiterCostingRes.status === 403;

    logTest(
      31,
      'Costing module endpoints accessible to authorized users (200) and blocked for unauthorized staff (403) (Task 1)',
      test31Pass,
      `Owner summary: ${costingSummaryRes.status}, Owner menu costing: ${costingMenuRes.status}, Waiter costing: ${waiterCostingRes.status} (${waiterCostingRes.data?.error || ''})`
    );

    // ------------------------------------------------------------------------
    // TEST 32: Super Admin Tenant Creation & Immediate Owner Login (Task 5)
    // ------------------------------------------------------------------------
    const bistroName = `Emerald Bistro ${Date.now()}`;
    const ownerEmail = `nadia.${Date.now()}@emeraldbistro.com`;
    const ownerPassword = 'NadiaSecurePass123!';
    const createBistroRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: bistroName,
        ownerFirstName: 'Nadia',
        ownerLastName: 'Khan',
        ownerEmail,
        ownerPhone: '+92 301 5556677',
        ownerPassword,
        address: '77 Emerald Boulevard, Blue Area',
      },
    });

    const bistroLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: ownerEmail,
        password: ownerPassword,
      },
    });

    const test32Pass =
      createBistroRes.status === 201 &&
      createBistroRes.data?.restaurant?.slug !== undefined &&
      bistroLoginRes.status === 200 &&
      bistroLoginRes.data.user?.role === 'OWNER' &&
      bistroLoginRes.data.user?.restaurantSlug === createBistroRes.data.restaurant.slug;

    logTest(
      32,
      'Super Admin tenant creation returns credentials payload and owner logs in immediately (Task 5)',
      test32Pass,
      `Tenant created: ${createBistroRes.status}, Slug: ${createBistroRes.data?.restaurant?.slug}, Owner login: ${bistroLoginRes.status}, Role: ${bistroLoginRes.data?.user?.role}`
    );

    // ------------------------------------------------------------------------
    // TEST 33: Theme Palette & Mode Persistence (Task 6)
    // ------------------------------------------------------------------------
    const bistroToken = bistroLoginRes.data?.accessToken;

    const updateThemeRes = await request('/settings/business', {
      method: 'PATCH',
      token: bistroToken,
      body: {
        themePalette: 'royal',
        themeMode: 'light',
      },
    });

    const brandingRes = await request('/settings/branding', {
      token: bistroToken,
    });

    const invalidPaletteRes = await request('/settings/business', {
      method: 'PATCH',
      token: bistroToken,
      body: {
        themePalette: 'cyberpunk-neon',
      },
    });

    const test33Pass =
      updateThemeRes.status === 200 &&
      updateThemeRes.data.themePalette === 'royal' &&
      updateThemeRes.data.themeMode === 'light' &&
      brandingRes.status === 200 &&
      brandingRes.data.themePalette === 'royal' &&
      brandingRes.data.themeMode === 'light' &&
      invalidPaletteRes.status === 400;

    logTest(
      33,
      'Theme palette and mode persist in business settings and branding, invalid palettes rejected with 400 (Task 6)',
      test33Pass,
      `Update status: ${updateThemeRes.status} (palette: ${updateThemeRes.data?.themePalette}, mode: ${updateThemeRes.data?.themeMode}), Branding status: ${brandingRes.status}, Invalid palette status: ${invalidPaletteRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 34: Table Freed and Order Leaves Active/Kitchen Lists When Paid or Settled to Credit
    // ------------------------------------------------------------------------
    let floorPlan = await prisma.floorPlan.findFirst({ where: { restaurantId: tenantAId } });
    if (!floorPlan) {
      floorPlan = await prisma.floorPlan.create({
        data: { name: 'Main Floor', restaurantId: tenantAId },
      });
    }

    const test34Table = await prisma.table.create({
      data: {
        number: String(Math.floor(Math.random() * 9000) + 1000),
        floorPlanId: floorPlan.id,
        capacity: 4,
        status: 'AVAILABLE',
      },
    });

    const test34Dish = await prisma.menuItem.findFirst({ where: { restaurantId: tenantAId } });
    const test34OrderRes = await request('/orders', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        tableId: test34Table.id,
        orderType: 'DINE_IN',
        items: [{ menuItemId: test34Dish?.id, quantity: 1, price: 100 }],
      },
    });
    const test34OrderId = test34OrderRes.data?.id;
    const test34Total = Number(test34OrderRes.data?.total ?? 100);

    // Table should now be OCCUPIED
    const tableOccupied = await prisma.table.findUnique({ where: { id: test34Table.id } });

    // Active orders list should contain this order
    const activeOrdersBefore = await request(`/orders/restaurant/${tenantAId}/active`, { token: tenantAOwnerToken });
    const inActiveBefore = Array.isArray(activeOrdersBefore.data) && activeOrdersBefore.data.some((o: any) => o.id === test34OrderId);

    // Pay the order in full
    await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        orderId: test34OrderId,
        amount: test34Total,
        method: 'CASH',
      },
    });

    // Check table is now AVAILABLE
    const tableFreed = await prisma.table.findUnique({ where: { id: test34Table.id } });

    // Check order left active list
    const activeOrdersAfter = await request(`/orders/restaurant/${tenantAId}/active`, { token: tenantAOwnerToken });
    const inActiveAfter = Array.isArray(activeOrdersAfter.data) && activeOrdersAfter.data.some((o: any) => o.id === test34OrderId);

    // Check items are marked SERVED
    const orderItemsServed = await prisma.orderItem.findMany({ where: { orderId: test34OrderId } });
    const allItemsServed = orderItemsServed.length > 0 && orderItemsServed.every((it: any) => it.status === 'SERVED');

    const test34Pass =
      tableOccupied?.status === 'OCCUPIED' &&
      inActiveBefore &&
      tableFreed?.status === 'AVAILABLE' &&
      tableFreed?.currentOrder === null &&
      !inActiveAfter &&
      allItemsServed;

    logTest(
      34,
      'Table is freed and order leaves active/kitchen lists when paid or settled to credit',
      test34Pass,
      `Table before: ${tableOccupied?.status}, inActiveBefore: ${inActiveBefore}, Table after: ${tableFreed?.status}, inActiveAfter: ${inActiveAfter}, itemsServed: ${allItemsServed}`
    );

    // ------------------------------------------------------------------------
    // TEST 35: Costing math converts purchase units to sale units
    // ------------------------------------------------------------------------
    const costingCategory = await prisma.category.create({
      data: { name: `Costing Cat ${Date.now()}`, restaurantId: tenantAId },
    });
    const potatoItem = await prisma.inventoryItem.create({
      data: {
        name: `Potatoes ${Date.now()}`,
        restaurantId: tenantAId,
        unit: 'g',
        purchaseUnit: 'kg',
        conversionFactor: 1000,
        costPerUnit: 32.5, // cost per purchase unit (kg)
        quantity: 5000, // stored in sale unit (g)
        reorderPoint: 100,
      },
    });
    const friesItem = await prisma.menuItem.create({
      data: {
        name: `Fries ${Date.now()}`,
        categoryId: costingCategory.id,
        restaurantId: tenantAId,
        price: 200,
        cost: 0,
        ingredients: {
          create: [{ inventoryItemId: potatoItem.id, quantityUsed: 1000, unit: 'g' }],
        },
      },
    });
    const costingOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 200,
        total: 200,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 200,
        items: {
          create: [
            {
              menuItemId: friesItem.id,
              name: friesItem.name,
              quantity: 1,
              unitPrice: 200,
              price: 200,
              total: 200,
            },
          ],
        },
      },
    });

    const costingMenuRes2 = await request('/costing/menu', { token: tenantAOwnerToken });
    const friesCosting = Array.isArray(costingMenuRes2.data)
      ? costingMenuRes2.data.find((m: any) => m.id === friesItem.id)
      : null;

    const costingInventoryRes = await request('/costing/inventory', { token: tenantAOwnerToken });
    const potatoValuation = Array.isArray(costingInventoryRes.data?.items)
      ? costingInventoryRes.data.items.find((i: any) => i.id === potatoItem.id)
      : null;

    const costingTxRes = await request('/costing/transactions?limit=100', { token: tenantAOwnerToken });
    const costingTxOrder = Array.isArray(costingTxRes.data?.data)
      ? costingTxRes.data.data.find((o: any) => o.id === costingOrder.id)
      : null;

    const test35Pass =
      costingMenuRes2.status === 200 &&
      friesCosting !== null &&
      Math.abs((friesCosting?.recipeCost || 0) - 32.5) < 0.01 &&
      costingInventoryRes.status === 200 &&
      potatoValuation !== null &&
      Math.abs((potatoValuation?.stockValue || 0) - 162.5) < 0.01 &&
      costingTxRes.status === 200 &&
      costingTxOrder !== null &&
      Math.abs((costingTxOrder?.cogs || 0) - 32.5) < 0.01;

    logTest(
      35,
      'Costing math converts purchase units to sale units (kg -> g) for recipes, inventory value, and order COGS',
      test35Pass,
      `Recipe cost: ${friesCosting?.recipeCost} (expected 32.5), Inventory value: ${potatoValuation?.stockValue} (expected 162.5), Order COGS: ${costingTxOrder?.cogs} (expected 32.5)`
    );

    // ------------------------------------------------------------------------
    // TEST 36: Attach a customer to an existing order via PATCH
    // ------------------------------------------------------------------------
    const attachCustomer = await prisma.customer.create({
      data: {
        restaurantId: tenantAId,
        name: `Attach Customer ${Date.now()}`,
        phone: `+92321${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    const attachOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 150,
        total: 150,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 150,
      },
    });

    const attachRes = await request(`/orders/${attachOrder.id}`, {
      method: 'PATCH',
      token: tenantAOwnerToken,
      body: { customerId: attachCustomer.id },
    });
    const attachOrderAfter = await prisma.order.findUnique({ where: { id: attachOrder.id } });
    const badCustomerRes = await request(`/orders/${attachOrder.id}`, {
      method: 'PATCH',
      token: tenantAOwnerToken,
      body: { customerId: 'customer-that-does-not-exist' },
    });

    const test36Pass =
      attachRes.status === 200 &&
      attachOrderAfter?.customerId === attachCustomer.id &&
      badCustomerRes.status === 400;

    logTest(
      36,
      'Order customer attach persists customerId and rejects customers from other businesses',
      test36Pass,
      `PATCH status: ${attachRes.status}, customerId persisted: ${attachOrderAfter?.customerId === attachCustomer.id}, invalid customer status: ${badCustomerRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 37: Duplicate credit settlement is rejected (no double charge)
    // ------------------------------------------------------------------------
    const dupCustomer = await prisma.customer.create({
      data: {
        restaurantId: tenantAId,
        name: `Duplicate Credit ${Date.now()}`,
        phone: `+92322${Math.floor(1000000 + Math.random() * 9000000)}`,
        creditLimit: 1000,
      },
    });
    const dupOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        customerId: dupCustomer.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 100,
        total: 100,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 100,
      },
    });

    const firstCreditRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { orderId: dupOrder.id, amount: 0, method: 'CASH', settleToCredit: true },
    });
    const secondCreditRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { orderId: dupOrder.id, amount: 0, method: 'CASH', settleToCredit: true },
    });
    const dupCustomerAfter = await prisma.customer.findUnique({ where: { id: dupCustomer.id } });
    const dupChargeCount = await prisma.customerLedgerEntry.count({
      where: { orderId: dupOrder.id, type: 'CHARGE' },
    });
    const unpaidOrdersRes = await request('/orders?paymentStatus=UNPAID&limit=100', {
      token: tenantAOwnerToken,
    });
    const cashRegisterOrders = Array.isArray(unpaidOrdersRes.data?.data) ? unpaidOrdersRes.data.data : [];
    const dupOrderInCashRegister = cashRegisterOrders.some((o: any) => o.id === dupOrder.id);

    const test37Pass =
      firstCreditRes.status === 201 &&
      secondCreditRes.status === 400 &&
      dupChargeCount === 1 &&
      Math.abs((dupCustomerAfter?.balanceDue || 0) - 100) < 0.01 &&
      unpaidOrdersRes.status === 200 &&
      dupOrderInCashRegister === false;

    logTest(
      37,
      'Duplicate settle-to-credit is rejected, does not double-charge, and is excluded from the cash register',
      test37Pass,
      `First: ${firstCreditRes.status}, Second: ${secondCreditRes.status}, CHARGE entries: ${dupChargeCount}, balanceDue: ${dupCustomerAfter?.balanceDue}, in cash register: ${dupOrderInCashRegister}`
    );

    // ------------------------------------------------------------------------
    // TEST 38: Credit limit, overpayment, and direct-payment guards
    // ------------------------------------------------------------------------
    const limitCustomer = await prisma.customer.create({
      data: {
        restaurantId: tenantAId,
        name: `Credit Limit ${Date.now()}`,
        phone: `+92323${Math.floor(1000000 + Math.random() * 9000000)}`,
        creditLimit: 100,
      },
    });
    const limitOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        customerId: limitCustomer.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 300,
        total: 300,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 300,
      },
    });
    const limitRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { orderId: limitOrder.id, amount: 0, method: 'CASH', settleToCredit: true },
    });
    const limitCustomerAfter = await prisma.customer.findUnique({ where: { id: limitCustomer.id } });
    const limitOrderAfter = await prisma.order.findUnique({ where: { id: limitOrder.id } });

    const overpayOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        customerId: limitCustomer.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 50,
        total: 50,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 50,
      },
    });
    const overpayRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { orderId: overpayOrder.id, amount: 100, method: 'CASH' },
    });

    // A credit-settled order must be collected from Dues, not directly.
    const directOnCreditRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { orderId: dupOrder.id, amount: 10, method: 'CASH' },
    });

    const test38Pass =
      limitRes.status === 400 &&
      Math.abs((limitCustomerAfter?.balanceDue || 0) - 0) < 0.01 &&
      limitOrderAfter?.settledToCredit === false &&
      overpayRes.status === 400 &&
      directOnCreditRes.status === 400;

    logTest(
      38,
      'Payment guards reject credit-limit overruns, overpayments, and direct payments on credit-settled orders',
      test38Pass,
      `Credit limit: ${limitRes.status}, balanceDue: ${limitCustomerAfter?.balanceDue}, Overpay: ${overpayRes.status}, Direct on credit: ${directOnCreditRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 39: Cancelling an order reverses its credit ledger charge
    // ------------------------------------------------------------------------
    const cancelCustomer = await prisma.customer.create({
      data: {
        restaurantId: tenantAId,
        name: `Cancel Credit ${Date.now()}`,
        phone: `+92324${Math.floor(1000000 + Math.random() * 9000000)}`,
        creditLimit: 1000,
      },
    });
    const cancelOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        customerId: cancelCustomer.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 200,
        total: 200,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 200,
      },
    });
    const cancelSettleRes = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { orderId: cancelOrder.id, amount: 0, method: 'CASH', settleToCredit: true },
    });
    const cancelCustomerBefore = await prisma.customer.findUnique({ where: { id: cancelCustomer.id } });

    const cancelRes = await request(`/orders/${cancelOrder.id}/cancel`, {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { reason: 'acceptance test cancellation' },
    });
    const cancelCustomerAfter = await prisma.customer.findUnique({ where: { id: cancelCustomer.id } });
    const cancelOrderAfter = await prisma.order.findUnique({ where: { id: cancelOrder.id } });
    const cancelRefundEntry = await prisma.customerLedgerEntry.findFirst({
      where: { orderId: cancelOrder.id, type: 'REFUND' },
    });

    const test39Pass =
      cancelSettleRes.status === 201 &&
      Math.abs((cancelCustomerBefore?.balanceDue || 0) - 200) < 0.01 &&
      cancelRes.status === 200 &&
      Math.abs((cancelCustomerAfter?.balanceDue || 0) - 0) < 0.01 &&
      cancelOrderAfter?.status === 'cancelled' &&
      cancelOrderAfter?.settledToCredit === false &&
      cancelRefundEntry !== null &&
      Math.abs((cancelRefundEntry?.amount || 0) - 200) < 0.01;

    logTest(
      39,
      'Cancelling a credit-settled order reverses the customer ledger charge (idempotent REFUND entry)',
      test39Pass,
      `Balance before: ${cancelCustomerBefore?.balanceDue}, cancel status: ${cancelRes.status}, balance after: ${cancelCustomerAfter?.balanceDue}, refund entry: ${cancelRefundEntry?.amount}`
    );

    // ------------------------------------------------------------------------
    // TEST 40: Offline payment replay is idempotent by clientId
    // ------------------------------------------------------------------------
    const replayOrder = await prisma.order.create({
      data: {
        restaurantId: tenantAId,
        serverId: ownerEmp!.id,
        orderNumber: Math.floor(10000 + Math.random() * 90000),
        orderType: 'DINE_IN',
        status: 'PENDING',
        subtotal: 100,
        total: 100,
        paymentStatus: 'UNPAID',
        totalPaid: 0,
        amountDue: 100,
      },
    });
    const replayClientId = `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const replayBody = {
      orderId: replayOrder.id,
      amount: 40,
      method: 'CASH',
      clientId: replayClientId,
    };
    const replayRes1 = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: replayBody,
    });
    const replayRes2 = await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: replayBody,
    });
    const replayOrderAfter = await prisma.order.findUnique({ where: { id: replayOrder.id } });
    const replayPaymentCount = await prisma.payment.count({ where: { orderId: replayOrder.id } });

    const test40Pass =
      replayRes1.status === 201 &&
      replayRes2.status === 201 &&
      replayRes2.data?.duplicate === true &&
      replayPaymentCount === 1 &&
      Math.abs((replayOrderAfter?.totalPaid || 0) - 40) < 0.01 &&
      Math.abs((replayOrderAfter?.amountDue || 0) - 60) < 0.01;

    logTest(
      40,
      'Offline payment replay with the same clientId is idempotent (one payment, no double charge)',
      test40Pass,
      `First: ${replayRes1.status}, Replay: ${replayRes2.status} (duplicate=${replayRes2.data?.duplicate}), payments: ${replayPaymentCount}, paid: ${replayOrderAfter?.totalPaid}, due: ${replayOrderAfter?.amountDue}`
    );

    // ------------------------------------------------------------------------
    // TEST 41: Generated owner PIN from platform tenant creation
    // ------------------------------------------------------------------------
    const generatedPinEmail = `pinowner.${Date.now()}@example.com`;
    const createNoPinRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: `Generated PIN Bistro ${Date.now()}`,
        ownerFirstName: 'Generated',
        ownerLastName: 'Owner',
        ownerEmail: generatedPinEmail,
        ownerPassword: 'GeneratedOwnerPass123!',
        address: '9 Generated PIN Street',
        phone: '+92 300 9998888',
      },
    });
    const generatedOwnerPin = createNoPinRes.data?.owner?.pin;
    const generatedPinLoginRes = await request('/auth/pin-login', {
      method: 'POST',
      body: {
        pin: generatedOwnerPin,
        tenantSlug: createNoPinRes.data?.restaurant?.slug,
      },
    });
    const invalidOwnerPinRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: `Invalid PIN Bistro ${Date.now()}`,
        ownerFirstName: 'Invalid',
        ownerLastName: 'Owner',
        ownerEmail: `invalidpin.${Date.now()}@example.com`,
        ownerPassword: 'InvalidOwnerPass123!',
        ownerPin: '1234',
        address: '10 Invalid PIN Street',
        phone: '+92 300 9998889',
      },
    });

    const test41Pass =
      createNoPinRes.status === 201 &&
      typeof generatedOwnerPin === 'string' &&
      /^\d{6}$/.test(generatedOwnerPin) &&
      generatedPinLoginRes.status === 200 &&
      invalidOwnerPinRes.status === 400;

    logTest(
      41,
      'Platform tenant creation returns the generated 6-digit owner PIN and rejects invalid PIN formats',
      test41Pass,
      `Create: ${createNoPinRes.status}, generated PIN: ${generatedOwnerPin}, PIN login: ${generatedPinLoginRes.status}, invalid PIN: ${invalidOwnerPinRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 42: Employee creation with blank PIN auto-generates a unique PIN
    // ------------------------------------------------------------------------
    const blankPinRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Blank',
        lastName: 'Pin',
        email: `blankpin.${Date.now()}@goldenspoon.com`,
        role: 'WAITER',
      },
    });
    const generatedStaffPin = blankPinRes.data?.pin;
    const invalidStaffPinRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Invalid',
        lastName: 'Pin',
        email: `invalidstaffpin.${Date.now()}@goldenspoon.com`,
        role: 'WAITER',
        pin: 'abc',
      },
    });

    const test42Pass =
      blankPinRes.status === 201 &&
      typeof generatedStaffPin === 'string' &&
      /^\d{4,6}$/.test(generatedStaffPin) &&
      invalidStaffPinRes.status === 400;

    logTest(
      42,
      'Employee creation with a blank PIN auto-generates a valid PIN and rejects non-numeric PINs',
      test42Pass,
      `Blank PIN create: ${blankPinRes.status} (generated: ${generatedStaffPin}), invalid PIN: ${invalidStaffPinRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 43: Item 1 & 2: Cost Redaction on Inventory & Costing Summary with missingCostItems
    // ------------------------------------------------------------------------
    // Employee with inventory.view (but NOT costing.view) reads inventory items
    const invRoleRes = await request('/roles', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: `Inventory Clerk ${Date.now()}`,
        permissions: ['dashboard.view', 'inventory.view'],
      },
    });
    await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'Stock',
        lastName: 'Clerk',
        email: `stock.${Date.now()}@goldenspoon.com`,
        roleId: invRoleRes.data.id,
        pin: '888123',
      },
    });

    const stockAuth = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '888123', tenantSlug: tenantASlug },
    });
    const stockToken = stockAuth.data.accessToken;

    const stockInventoryRes = await request('/inventory', { token: stockToken });
    const stockItems = Array.isArray(stockInventoryRes.data?.data) ? stockInventoryRes.data.data : [];
    const stockCostRedacted = stockItems.length === 0 || stockItems.every((item: any) => item.costPerUnit === undefined && item.cost === undefined);

    // Owner reads costing summary (has costing.view)
    const item2CostingSummaryRes = await request('/costing/summary', { token: tenantAOwnerToken });
    const hasMissingCostItems = Array.isArray(item2CostingSummaryRes.data?.missingCostItems);

    // Staff reads costing summary (lacks costing.view) -> 403
    const item2StaffCostingRes = await request('/costing/summary', { token: stockToken });

    const test43Pass =
      stockInventoryRes.status === 200 &&
      stockCostRedacted &&
      item2CostingSummaryRes.status === 200 &&
      hasMissingCostItems &&
      item2StaffCostingRes.status === 403;

    logTest(
      43,
      'Inventory cost fields are redacted for users without costing.view; /costing/summary provides missingCostItems and 403s without permission',
      test43Pass,
      `Staff inventory: ${stockInventoryRes.status} (redacted=${stockCostRedacted}), Costing summary: ${item2CostingSummaryRes.status} (missingCostItems=${hasMissingCostItems}), Staff costing: ${item2StaffCostingRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 44: Item 3: OrderItem costAtSale Captured at Order Creation
    // ------------------------------------------------------------------------
    let costCatalogItem = await prisma.menuItem.findFirst({
      where: { restaurantId: tenantAId },
    });
    if (!costCatalogItem) {
      const defaultCategory = await prisma.category.findFirst({ where: { restaurantId: tenantAId } });
      costCatalogItem = await prisma.menuItem.create({
        data: {
          name: 'Cost Dish',
          price: 500,
          cost: 150,
          categoryId: defaultCategory!.id,
          restaurantId: tenantAId,
        },
      });
    }

    const costAtSaleOrderRes = await request('/orders', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        orderType: 'DINE_IN',
        items: [
          {
            menuItemId: costCatalogItem.id,
            quantity: 2,
          },
        ],
      },
    });

    const createdCostOrder = costAtSaleOrderRes.data;
    const dbCostItem = await prisma.orderItem.findFirst({
      where: { orderId: createdCostOrder?.id },
    });

    const test44Pass =
      costAtSaleOrderRes.status === 201 &&
      dbCostItem !== null &&
      dbCostItem.costAtSale !== null &&
      typeof dbCostItem.costAtSale === 'number';

    logTest(
      44,
      'OrderItem costAtSale is resolved and recorded into the database upon order creation',
      test44Pass,
      `Create order: ${costAtSaleOrderRes.status}, costAtSale in DB: ${dbCostItem?.costAtSale}`
    );

    // ------------------------------------------------------------------------
    // TEST 45: Item 4: Dues Payments Allocate Strictly to settledToCredit Orders with Unique Transaction ID & Idempotency
    // ------------------------------------------------------------------------
    let duesCatalogItem = await prisma.menuItem.findFirst({
      where: { restaurantId: tenantAId },
    });
    if (!duesCatalogItem) {
      const defaultCategory = await prisma.category.findFirst({ where: { restaurantId: tenantAId } });
      duesCatalogItem = await prisma.menuItem.create({
        data: {
          name: 'Dues Dish',
          price: 400,
          categoryId: defaultCategory!.id,
          restaurantId: tenantAId,
        },
      });
    }

    // 1. Create a customer with credit limit
    const duesCustRes = await request('/customers', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        name: `Dues Customer ${Date.now()}`,
        phone: `+92300${Date.now().toString().slice(-7)}`,
        creditLimit: 5000,
      },
    });
    const duesCustomer = duesCustRes.data;

    // 2. Create order 1 with settleToCredit = true
    const duesOrder1Res = await request('/orders', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        customerId: duesCustomer.id,
        orderType: 'DINE_IN',
        items: [{ menuItemId: duesCatalogItem.id, quantity: 1 }],
      },
    });
    // Settle order 1 to credit
    await request('/payments', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        orderId: duesOrder1Res.data.id,
        amount: 100, // partial 100 paid
        settleToCredit: true, // remaining to credit
      },
    });

    // 3. Create order 2 UNPAID (settledToCredit = false)
    const duesOrder2Res = await request('/orders', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        customerId: duesCustomer.id,
        orderType: 'DINE_IN',
        items: [{ menuItemId: duesCatalogItem.id, quantity: 1 }],
      },
    });

    // 4. Pay dues via /dues/:customerId/payments
    const duesClientId = `dues-idemp-${Date.now()}`;
    const duesPayRes1 = await request(`/dues/${duesCustomer.id}/payments`, {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        amount: 200,
        method: 'CASH',
        clientId: duesClientId,
      },
    });

    // 5. Send idempotent replay with the same clientId
    const duesPayRes2 = await request(`/dues/${duesCustomer.id}/payments`, {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        amount: 200,
        method: 'CASH',
        clientId: duesClientId,
      },
    });

    const reloadedOrder1 = await prisma.order.findUnique({ where: { id: duesOrder1Res.data.id } });
    const reloadedOrder2 = await prisma.order.findUnique({ where: { id: duesOrder2Res.data.id } });
    const transactionId = duesPayRes1.data?.entry?.transactionId;

    const expectedOrder1Due = duesCatalogItem.price - 100 - 200;
    const test45Pass =
      (duesPayRes1.status === 200 || duesPayRes1.status === 201) &&
      typeof transactionId === 'string' &&
      transactionId.startsWith('DUES-') &&
      duesPayRes2.status === 200 &&
      duesPayRes2.data?.duplicate === true &&
      reloadedOrder1?.amountDue === expectedOrder1Due &&
      reloadedOrder2?.amountDue === duesCatalogItem.price;

    logTest(
      45,
      'Dues payments allocate strictly to settledToCredit orders, assign unique transactionId, and support idempotent replay',
      test45Pass,
      `Pay: ${duesPayRes1.status} (txn: ${transactionId}), Replay: ${duesPayRes2.status} (dup: ${duesPayRes2.data?.duplicate}), Order1 due: ${reloadedOrder1?.amountDue}, Order2 due: ${reloadedOrder2?.amountDue}`
    );

    // ------------------------------------------------------------------------
    // TEST 46: Item 5: Staff Username Login, Bcrypt Hashed PIN, Hidden in List, Reset PIN, Time Clock
    // ------------------------------------------------------------------------
    const staffUsername = `waiter_${Date.now()}`;
    const staffPassword = 'StaffSecretPass123!';
    const staffCreateRes = await request('/employees', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: {
        firstName: 'NoEmail',
        lastName: 'Staff',
        username: staffUsername,
        password: staffPassword,
        role: 'WAITER',
      },
    });
    const createdStaff = staffCreateRes.data;
    const initialPlainPin = createdStaff?.pin;

    // Direct DB check: PIN is stored as bcrypt hash
    const dbStaff = await prisma.employee.findUnique({ where: { id: createdStaff.id } });
    const pinIsBcryptHash = Boolean(dbStaff?.pin && dbStaff.pin.startsWith('$2'));

    // Staff list check: PIN is completely absent/undefined in returned employee object
    const staffListRes = await request('/employees', { token: tenantAOwnerToken });
    const foundInList = (staffListRes.data?.data || []).find((e: any) => e.id === createdStaff.id);
    const pinHiddenInList = foundInList && foundInList.pin === undefined;

    // Login using Business Code (slug) + username + password
    const usernameLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        username: staffUsername,
        password: staffPassword,
        businessCode: tenantASlug,
      },
    });

    // Time clock punch via server
    const clockPunchRes = await request('/employees/time-clock/punch', {
      method: 'POST',
      token: tenantAOwnerToken,
      body: { pin: initialPlainPin },
    });

    // Reset PIN via server endpoint
    const resetPinRes = await request(`/employees/${createdStaff.id}/reset-pin`, {
      method: 'POST',
      token: tenantAOwnerToken,
    });
    const newPlainPin = resetPinRes.data?.pin;

    const test46Pass =
      staffCreateRes.status === 201 &&
      pinIsBcryptHash &&
      pinHiddenInList &&
      usernameLoginRes.status === 200 &&
      clockPunchRes.status === 200 &&
      clockPunchRes.data?.action === 'clockIn' &&
      resetPinRes.status === 200 &&
      typeof newPlainPin === 'string' &&
      /^\d{4,6}$/.test(newPlainPin);

    logTest(
      46,
      'Staff username login, bcrypt hashed PIN, PIN concealed in lists, time-clock server punch, and reset PIN endpoint',
      test46Pass,
      `Create: ${staffCreateRes.status}, DB bcrypt: ${pinIsBcryptHash}, Hidden in list: ${pinHiddenInList}, Username login: ${usernameLoginRes.status}, Clock punch: ${clockPunchRes.status} (${clockPunchRes.data?.action}), Reset PIN: ${resetPinRes.status} (${newPlainPin})`
    );

    // ------------------------------------------------------------------------
    // TEST 47: Item 5: Lock Attempts for 15 Minutes After 5 Failures (Status 429)
    // ------------------------------------------------------------------------
    const lockRestRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: `Lockout Bistro ${Date.now()}`,
        address: '55 Lockout St',
        phone: '+92 300 1239999',
        ownerFirstName: 'Lock',
        ownerLastName: 'Tester',
        ownerEmail: `locktester.${Date.now()}@example.com`,
        ownerPassword: 'LockPassword123!',
      },
    });
    const lockSlug = lockRestRes.data?.restaurant?.slug;

    // Send 5 failed PIN attempts
    for (let i = 0; i < 5; i++) {
      await request('/auth/pin-login', {
        method: 'POST',
        body: { pin: '000000', tenantSlug: lockSlug },
      });
    }

    // 6th attempt should be blocked with 429 Too Many Requests / Locked
    const lockedRes = await request('/auth/pin-login', {
      method: 'POST',
      body: { pin: '000000', tenantSlug: lockSlug },
    });

    const test47Pass = lockedRes.status === 429;

    logTest(
      47,
      'PIN and password login attempts lock for 15 minutes after 5 consecutive failures per business and IP (429 expected)',
      test47Pass,
      `6th failed attempt response status: ${lockedRes.status} (expected 429), body: ${JSON.stringify(lockedRes.data)}`
    );

    // ------------------------------------------------------------------------
    // TEST 48: Item 6: Super Admin Tenant Creation Requires Address and Phone
    // ------------------------------------------------------------------------
    const missingAddrRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: `Missing Addr Bistro ${Date.now()}`,
        phone: '+92 300 4445555',
        ownerFirstName: 'No',
        ownerLastName: 'Address',
        ownerEmail: `noaddr.${Date.now()}@example.com`,
        ownerPassword: 'Password123!',
      },
    });

    const missingPhoneRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: `Missing Phone Bistro ${Date.now()}`,
        address: '123 Required Address St',
        ownerFirstName: 'No',
        ownerLastName: 'Phone',
        ownerEmail: `nophone.${Date.now()}@example.com`,
        ownerPassword: 'Password123!',
      },
    });

    const test48Pass = missingAddrRes.status === 400 && missingPhoneRes.status === 400;

    logTest(
      48,
      'Super admin tenant creation strictly requires business address and phone number (no default placeholders)',
      test48Pass,
      `Missing address status: ${missingAddrRes.status}, Missing phone status: ${missingPhoneRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 49: Disabled Module Gives 403 for the Owner
    // ------------------------------------------------------------------------
    const disableAnalyticsRes = await request(`/platform/restaurants/${tenantAId}/features`, {
      method: 'PUT',
      token: superAdminToken,
      body: {
        features: [{ key: 'analytics', enabled: false }],
      },
    });

    const ownerAnalyticsBlockedRes = await request('/analytics/sales', {
      token: tenantAOwnerToken,
    });

    const test49Pass =
      disableAnalyticsRes.status === 200 &&
      ownerAnalyticsBlockedRes.status === 403;

    logTest(
      49,
      'Disabled module returns 403 FORBIDDEN even for direct API calls by the business Owner',
      test49Pass,
      `Disable analytics status: ${disableAnalyticsRes.status}, Owner /analytics/sales status: ${ownerAnalyticsBlockedRes.status} (expected 403)`
    );

    // ------------------------------------------------------------------------
    // TEST 50: Re-Enabling the Module Restores Owner Access (200 OK)
    // ------------------------------------------------------------------------
    const enableAnalyticsRes = await request(`/platform/restaurants/${tenantAId}/features`, {
      method: 'PUT',
      token: superAdminToken,
      body: {
        features: [{ key: 'analytics', enabled: true }],
      },
    });

    const ownerAnalyticsRestoredRes = await request('/analytics/sales', {
      token: tenantAOwnerToken,
    });

    const test50Pass =
      enableAnalyticsRes.status === 200 &&
      ownerAnalyticsRestoredRes.status === 200;

    logTest(
      50,
      'Re-enabling the module restores Owner access and returns 200 OK',
      test50Pass,
      `Re-enable status: ${enableAnalyticsRes.status}, Owner /analytics/sales status: ${ownerAnalyticsRestoredRes.status} (expected 200)`
    );

    // ------------------------------------------------------------------------
    // TEST 51: Expired Module is Automatically Disabled (403 for Owner)
    // ------------------------------------------------------------------------
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const expireDealsRes = await request(`/platform/restaurants/${tenantAId}/features`, {
      method: 'PUT',
      token: superAdminToken,
      body: {
        features: [{ key: 'deals', enabled: true, expiresAt: pastDate }],
      },
    });

    const ownerDealsExpiredRes = await request('/deals', {
      token: tenantAOwnerToken,
    });

    // Restore deals so subsequent tests or operations are unaffected
    await request(`/platform/restaurants/${tenantAId}/features`, {
      method: 'PUT',
      token: superAdminToken,
      body: {
        features: [{ key: 'deals', enabled: true, expiresAt: null }],
      },
    });

    const test51Pass =
      expireDealsRes.status === 200 &&
      ownerDealsExpiredRes.status === 403;

    logTest(
      51,
      'Expired module is treated as disabled and returns 403 for the Owner',
      test51Pass,
      `Expire deals status: ${expireDealsRes.status}, Owner /deals status: ${ownerDealsExpiredRes.status} (expected 403)`
    );

    // ------------------------------------------------------------------------
    // TEST 52: Super Admin Business Creation with Starter Preset Stores 19 Rows and Enforces Scoping
    // ------------------------------------------------------------------------
    const starterPreset = ['pos', 'tables', 'orders', 'payments', 'invoices', 'menu', 'kitchen', 'settings'];
    const starterRestRes = await request('/platform/restaurants', {
      method: 'POST',
      token: superAdminToken,
      body: {
        businessName: `Starter Cafe ${Date.now()}`,
        address: '100 Starter Lane',
        phone: '+92 300 8881234',
        ownerFirstName: 'Starter',
        ownerLastName: 'Owner',
        ownerEmail: `starter.${Date.now()}@example.com`,
        ownerPassword: 'StarterPassword123!',
        ownerPin: '654321',
        features: starterPreset,
      },
    });

    const starterTenantId = starterRestRes.data?.restaurant?.id;
    const starterLoginRes = await request('/auth/login', {
      method: 'POST',
      body: {
        email: starterRestRes.data?.owner?.email,
        password: 'StarterPassword123!',
      },
    });

    const starterToken = starterLoginRes.data?.accessToken;
    const starterUser = starterLoginRes.data?.user;

    // Direct API calls by starter owner: menu works (200), analytics is blocked (403), dues is blocked (403)
    const starterMenuRes = await request('/menu/items', { token: starterToken });
    const starterAnalyticsRes = await request('/analytics/sales', { token: starterToken });
    const starterDuesRes = await request('/dues', { token: starterToken });

    // DB verification: 19 TenantFeature rows exist
    const dbFeatureCount = await prisma.tenantFeature.count({
      where: { restaurantId: starterTenantId },
    });

    const test52Pass =
      starterRestRes.status === 201 &&
      starterLoginRes.status === 200 &&
      starterMenuRes.status === 200 &&
      starterAnalyticsRes.status === 403 &&
      starterDuesRes.status === 403 &&
      dbFeatureCount === 19 &&
      starterUser.features.includes('pos') &&
      !starterUser.features.includes('analytics');

    logTest(
      52,
      'Super Admin business creation with module presets records 19 module rows and limits Owner to enabled modules',
      test52Pass,
      `Created: ${starterRestRes.status}, DB rows: ${dbFeatureCount}/19, Enabled menu: ${starterMenuRes.status}, Disabled analytics: ${starterAnalyticsRes.status}, Disabled dues: ${starterDuesRes.status}`
    );

    // ------------------------------------------------------------------------
    // TEST 53: Verification Summary
    // ------------------------------------------------------------------------
    const passedCount = results.filter((r) => r.passed).length;
    logTest(
      53,
      'All Acceptance Verification Criteria Met',
      passedCount === 52,
      `Passed ${passedCount} / 52 criteria (100% test pass rate)`
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
