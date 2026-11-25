import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface BackfillReport {
  restaurants: number;
  failures: string[];
}

/**
 * Fail-closed report that runs after every live baseline backfill.
 *
 * It prints, per business: enabled modules, staff without a role, unpaid orders
 * still showing amountDue = 0, and the active Owner's address. Missing modules,
 * staff without a role, a missing active Owner or an Owner without an address
 * are upgrade blockers.
 */
export async function verifyBackfilledTenants(): Promise<BackfillReport> {
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });

  const failures: string[] = [];
  const now = new Date();

  console.log('\n=========================================================');
  console.log('Post-backfill business check');
  console.log('=========================================================');

  for (const restaurant of restaurants) {
    const label = restaurant.slug ? `${restaurant.name} (${restaurant.slug})` : restaurant.name;

    const enabledFeatures = await prisma.tenantFeature.findMany({
      where: {
        restaurantId: restaurant.id,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { featureKey: true },
      orderBy: { featureKey: 'asc' },
    });
    const enabledModules = enabledFeatures.map((row) => row.featureKey);

    const unassignedStaff = await prisma.employee.findMany({
      where: {
        restaurantId: restaurant.id,
        OR: [{ roleId: null }, { role: '' }],
      },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
      orderBy: { firstName: 'asc' },
    });

    const zeroDueCandidates = await prisma.order.findMany({
      where: {
        restaurantId: restaurant.id,
        amountDue: 0,
        settledToCredit: false,
        total: { gt: 0 },
        paymentStatus: { not: 'PAID' },
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        totalPaid: true,
        paymentStatus: true,
      },
      orderBy: { orderNumber: 'asc' },
    });
    const unpaidZeroDue = zeroDueCandidates.filter(
      (order) => (order.totalPaid ?? 0) < order.total
    );

    const activeOwner = await prisma.employee.findFirst({
      where: {
        restaurantId: restaurant.id,
        isActive: true,
        OR: [
          { role: 'OWNER' },
          { roleRecord: { is: { OR: [{ key: 'OWNER' }, { isOwnerRole: true }] } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        address: true,
        logoUrl: true,
        restaurant: { select: { logoUrl: true } },
      },
    });

    console.log(`\nBusiness: ${label}`);
    console.log(`  Enabled modules (${enabledModules.length}): ${enabledModules.join(', ') || '(none)'}`);
    console.log(
      `  Staff without a role (${unassignedStaff.length}): ` +
        (unassignedStaff.length
          ? unassignedStaff
              .map((emp) => `${emp.firstName} ${emp.lastName}${emp.email ? ` <${emp.email}>` : ''}`)
              .join('; ')
          : '(none)')
    );
    console.log(
      `  Unpaid orders with amountDue = 0 (${unpaidZeroDue.length}): ` +
        (unpaidZeroDue.length
          ? unpaidZeroDue
              .map(
                (order) =>
                  `#${order.orderNumber} total=${order.total} paid=${order.totalPaid ?? 0} status=${order.paymentStatus}`
              )
              .join('; ')
          : '(none)')
    );
    const ownerLogo = activeOwner?.logoUrl?.trim();
    const businessLogo = activeOwner?.restaurant?.logoUrl?.trim();
    console.log(
      `  Active Owner: ` +
        (activeOwner
          ? `${activeOwner.firstName} ${activeOwner.lastName}${activeOwner.email ? ` <${activeOwner.email}>` : ''}` +
            ` (address: ${activeOwner.address?.trim() || 'MISSING'}, ` +
            `logo: ${ownerLogo ? 'SET' : businessLogo ? 'MISSING (business logo available)' : 'MISSING (no business logo)'})`
          : 'MISSING')
    );

    if (enabledModules.length === 0) {
      failures.push(`${label}: no enabled modules`);
    }
    if (unassignedStaff.length > 0) {
      failures.push(`${label}: ${unassignedStaff.length} staff member(s) without a role`);
    }
    if (!activeOwner) {
      failures.push(`${label}: no active employee with the Owner role`);
    } else if (!activeOwner.address?.trim()) {
      failures.push(`${label}: active Owner has no address`);
    } else if (businessLogo && !ownerLogo) {
      failures.push(`${label}: active Owner has no profile logo while a business logo exists`);
    }
  }

  if (restaurants.length === 0) {
    console.log('  No businesses found.');
  }

  console.log('\n=========================================================');
  if (failures.length > 0) {
    console.error('Post-backfill check FAILED:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
  } else {
    console.log('Post-backfill check PASSED.');
  }
  console.log('=========================================================\n');

  return { restaurants: restaurants.length, failures };
}

export async function disconnectBackfillVerifyDb(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('verify-backfill'))) {
  verifyBackfilledTenants()
    .then((report) => {
      if (report.failures.length > 0) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error('Post-backfill check could not complete:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
