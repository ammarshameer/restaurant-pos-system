import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { DEFAULT_SYSTEM_ROLES, ALL_PERMISSIONS, Permission } from '../src/permissions';
import { slugify } from '../src/permissions';
import { getDevPlatformCredentials } from '../src/config/dev-credentials';

const prisma = new PrismaClient();

const ROLE_NORMALIZATION_MAP: Record<string, string> = {
  ADMIN: 'OWNER',
  SERVER: 'WAITER',
  KITCHEN: 'CHEF',
  COOK: 'CHEF',
};

const LEGACY_CUSTOM_ROLE_DEFAULTS: Record<
  string,
  { name: string; description: string; permissions: Permission[] }
> = {
  BARTENDER: {
    name: 'Bartender',
    description: 'Bar station operator with POS ordering and payment processing',
    permissions: [
      'dashboard.view',
      'pos.use',
      'orders.view',
      'orders.create',
      'orders.update',
      'payments.view',
      'payments.process',
      'menu.view',
      'invoices.view',
    ],
  },
  HOST: {
    name: 'Host / Hostess',
    description: 'Front door host managing guest seating, tables, and reservations',
    permissions: [
      'dashboard.view',
      'tables.view',
      'tables.manage',
      'orders.view',
    ],
  },
};

async function generateUniqueSlug(restaurantId: string, name: string): Promise<string> {
  const baseSlug = slugify(name) || 'restaurant';
  let candidate = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.restaurant.findFirst({
      where: {
        slug: candidate,
        id: { not: restaurantId },
      },
    });
    if (!existing) {
      return candidate;
    }
    counter++;
    candidate = `${baseSlug}-${counter}`;
  }
}

async function backfill() {
  console.log('🚀 Starting Multi-Tenant Backfill Migration...');
  const summary = {
    restaurantsProcessed: 0,
    rolesCreated: 0,
    employeesNormalized: 0,
    platformUsersCreated: 0,
    pinsNormalized: 0,
  };

  // 1. Process Restaurants
  const restaurants = await prisma.restaurant.findMany({
    include: {
      roles: { include: { permissions: true } },
      employees: true,
    },
  });

  for (const restaurant of restaurants) {
    summary.restaurantsProcessed++;

    // Ensure slug and isActive
    const needsSlug = !restaurant.slug || !restaurant.slug.trim();
    const needsActive = restaurant.isActive === null || restaurant.isActive === undefined;

    let targetSlug = restaurant.slug;
    if (needsSlug) {
      targetSlug = await generateUniqueSlug(restaurant.id, restaurant.name);
    }

    if (needsSlug || needsActive) {
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data: {
          slug: targetSlug,
          isActive: restaurant.isActive ?? true,
        },
      });
      console.log(`✓ Restaurant "${restaurant.name}" updated (slug: ${targetSlug})`);
    }

    // Ensure 5 system roles exist
    const existingRolesByKey = new Map(restaurant.roles.map((r) => [r.key.toUpperCase(), r]));

    for (const sysDef of DEFAULT_SYSTEM_ROLES) {
      let roleRecord = existingRolesByKey.get(sysDef.key.toUpperCase());
      if (!roleRecord) {
        roleRecord = await prisma.role.create({
          data: {
            restaurantId: restaurant.id,
            key: sysDef.key,
            name: sysDef.name,
            description: sysDef.description,
            isSystem: sysDef.isSystem,
            isOwnerRole: sysDef.isOwnerRole,
            permissions: {
              create: sysDef.permissions.map((p) => ({ permission: p })),
            },
          },
          include: { permissions: true },
        });
        existingRolesByKey.set(sysDef.key.toUpperCase(), roleRecord);
        summary.rolesCreated++;
        console.log(`  + Created system role: ${sysDef.key} for "${restaurant.name}"`);
      } else {
        // Ensure permissions are up to date for OWNER
        if (sysDef.isOwnerRole) {
          const currentPerms = new Set(roleRecord.permissions.map((p) => p.permission));
          const missing = ALL_PERMISSIONS.filter((p) => !currentPerms.has(p));
          if (missing.length > 0) {
            await prisma.rolePermission.createMany({
              data: missing.map((p) => ({ roleId: roleRecord!.id, permission: p })),
            });
          }
        }
      }
    }

    // 2. Normalize Employees in this Restaurant
    for (const emp of restaurant.employees) {
      const rawRole = (emp.role || 'SERVER').trim().toUpperCase();
      const normalizedKey = ROLE_NORMALIZATION_MAP[rawRole] || rawRole;

      let matchedRole = existingRolesByKey.get(normalizedKey);

      // If it's a custom role like BARTENDER or HOST, create it if not present
      if (!matchedRole) {
        const customDef = LEGACY_CUSTOM_ROLE_DEFAULTS[normalizedKey] || {
          name: normalizedKey.charAt(0) + normalizedKey.slice(1).toLowerCase(),
          description: `Custom ${normalizedKey} role`,
          permissions: ['dashboard.view', 'pos.use', 'orders.view'],
        };

        matchedRole = await prisma.role.create({
          data: {
            restaurantId: restaurant.id,
            key: normalizedKey,
            name: customDef.name,
            description: customDef.description,
            isSystem: false,
            isOwnerRole: false,
            permissions: {
              create: customDef.permissions.map((p) => ({ permission: p })),
            },
          },
          include: { permissions: true },
        });
        existingRolesByKey.set(normalizedKey, matchedRole);
        summary.rolesCreated++;
        console.log(`  + Created custom role: ${normalizedKey} for "${restaurant.name}"`);
      }

      // Update employee role and roleId if needed
      if (emp.roleId !== matchedRole.id || emp.role !== matchedRole.key) {
        await prisma.employee.update({
          where: { id: emp.id },
          data: {
            roleId: matchedRole.id,
            role: matchedRole.key,
          },
        });
        summary.employeesNormalized++;
        console.log(
          `  ✓ Employee "${emp.firstName} ${emp.lastName}" normalized from ${rawRole} -> ${matchedRole.key}`
        );
      }
    }
  }

  // 3. Bootstrap Platform Users from Environment
  const isProduction = process.env.NODE_ENV === 'production';
  let superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  let superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
  let supportEmail = process.env.SUPPORT_EMAIL?.trim().toLowerCase();
  let supportPassword = process.env.SUPPORT_PASSWORD;

  if (isProduction) {
    if (!superAdminEmail || !superAdminPassword || !supportEmail || !supportPassword) {
      throw new Error(
        'FATAL: SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPPORT_EMAIL, and SUPPORT_PASSWORD must all be explicitly set in production environments.'
      );
    }
  } else {
    // In dev / test: if credentials not provided in environment, read or generate one-time dev credentials
    if (!superAdminPassword || !supportPassword) {
      const devCreds = getDevPlatformCredentials();
      superAdminEmail = superAdminEmail || devCreds.superAdmin.email;
      superAdminPassword = superAdminPassword || devCreds.superAdmin.password;
      supportEmail = supportEmail || devCreds.support.email;
      supportPassword = supportPassword || devCreds.support.password;
    }
    superAdminEmail = superAdminEmail || 'superadmin@restaurantpos.com';
    supportEmail = supportEmail || 'support@restaurantpos.com';
  }

  const superAdminName = process.env.SUPER_ADMIN_NAME || 'Super Administrator';

  const existingSuperAdmin = await prisma.platformUser.findUnique({
    where: { email: superAdminEmail },
  });

  if (!existingSuperAdmin) {
    const hash = await bcrypt.hash(superAdminPassword, 10);
    await prisma.platformUser.create({
      data: {
        name: superAdminName,
        email: superAdminEmail,
        passwordHash: hash,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    summary.platformUsersCreated++;
    console.log(`✓ Bootstrapped Super Admin Platform User: ${superAdminEmail}`);
  }

  const supportName = process.env.SUPPORT_NAME || 'Global Platform Support';

  const existingSupport = await prisma.platformUser.findUnique({
    where: { email: supportEmail },
  });

  if (!existingSupport) {
    const hash = await bcrypt.hash(supportPassword, 10);
    await prisma.platformUser.create({
      data: {
        name: supportName,
        email: supportEmail,
        passwordHash: hash,
        role: 'SUPPORT',
        isActive: true,
      },
    });
    summary.platformUsersCreated++;
    console.log(`✓ Bootstrapped Support Platform User: ${supportEmail}`);
  }

  // 4. Normalize duplicate PINs per tenant
  for (const restaurant of restaurants) {
    const updated = await normalizeTenantPins(restaurant.id);
    if (updated > 0) {
      console.log(`✓ Normalized ${updated} duplicate PIN(s) in tenant "${restaurant.name}"`);
      summary.pinsNormalized += updated;
    }
  }

  console.log('\n=============================================');
  console.log('🎉 Multi-Tenant Backfill Migration Completed');
  console.log('=============================================');
  console.log(`- Restaurants processed:    ${summary.restaurantsProcessed}`);
  console.log(`- Roles created:            ${summary.rolesCreated}`);
  console.log(`- Employees normalized:     ${summary.employeesNormalized}`);
  console.log(`- Duplicate PINs resolved:  ${summary.pinsNormalized}`);
  console.log(`- Platform users created:   ${summary.platformUsersCreated}`);
  console.log('=============================================\n');
}

export async function normalizeTenantPins(restaurantId: string): Promise<number> {
  const activeEmployees = await prisma.employee.findMany({
    where: { restaurantId, isActive: true },
    select: { id: true, pin: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const pinGroups = new Map<string, Array<{ id: string; pin: string }>>();
  for (const emp of activeEmployees) {
    const list = pinGroups.get(emp.pin) || [];
    list.push(emp);
    pinGroups.set(emp.pin, list);
  }

  const takenPins = new Set<string>(activeEmployees.map((e) => e.pin));
  let changedCount = 0;

  for (const [, emps] of pinGroups.entries()) {
    if (emps.length > 1) {
      // Keep first employee's PIN intact, reassign subsequent colliding employees
      for (let i = 1; i < emps.length; i++) {
        const empToUpdate = emps[i];
        let newPin = '';
        for (let attempt = 0; attempt < 50; attempt++) {
          const candidate = crypto.randomInt(1000, 10000).toString();
          if (!takenPins.has(candidate)) {
            newPin = candidate;
            break;
          }
        }
        if (!newPin) {
          throw new Error(`Unable to generate unique PIN for employee ${empToUpdate.id} in restaurant ${restaurantId}`);
        }
        takenPins.add(newPin);
        await prisma.employee.update({
          where: { id: empToUpdate.id },
          data: { pin: newPin },
        });
        changedCount++;
      }
    }
  }

  return changedCount;
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-multi-tenant'))) {
  backfill()
    .catch((e) => {
      console.error('❌ Backfill failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

