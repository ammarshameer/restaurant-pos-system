import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotent post-schema backfill for the Owner Profile address field.
 *
 * It copies the business address onto employees that do not have a personal
 * address yet, then fails closed per business if any active Owner is still
 * missing one. Safe to run on every deploy.
 */
export async function backfillOwnerAddress(): Promise<number> {
  const withoutAddress = await prisma.employee.findMany({
    where: { OR: [{ address: null }, { address: '' }] },
    select: {
      id: true,
      restaurant: { select: { name: true, slug: true, address: true } },
    },
  });

  let updated = 0;
  for (const employee of withoutAddress) {
    const businessAddress = employee.restaurant?.address?.trim();
    if (!businessAddress) continue;

    await prisma.employee.update({
      where: { id: employee.id },
      data: { address: businessAddress },
    });
    updated++;
  }

  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });

  const failures: string[] = [];
  for (const restaurant of restaurants) {
    const label = restaurant.slug
      ? `${restaurant.name} (${restaurant.slug})`
      : restaurant.name;

    const activeOwners = await prisma.employee.findMany({
      where: {
        restaurantId: restaurant.id,
        isActive: true,
        OR: [
          { role: 'OWNER' },
          { roleRecord: { is: { OR: [{ key: 'OWNER' }, { isOwnerRole: true }] } } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, address: true },
    });

    const missing = activeOwners.filter((owner) => !owner.address?.trim());
    if (missing.length > 0) {
      failures.push(
        `${label}: ${missing.length} active Owner(s) without an address ` +
          `(${missing.map((owner) => `${owner.firstName} ${owner.lastName}`).join(', ')})`
      );
    }
  }

  if (failures.length > 0) {
    console.error('Owner address backfill FAILED per business:');
    for (const failure of failures) console.error(`  - ${failure}`);
    throw new Error(`Owner address backfill failed for ${failures.length} business(es).`);
  }

  if (updated > 0) {
    console.log(`Owner address backfill updated ${updated} employee record(s).`);
  } else {
    console.log('Owner address backfill: no changes needed.');
  }

  return updated;
}

export async function disconnectOwnerAddressDb(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-owner-address'))) {
  backfillOwnerAddress()
    .then(() => console.log('Owner address backfill verification PASSED.'))
    .catch((error) => {
      console.error('Owner address backfill failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectOwnerAddressDb();
    });
}
