import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { validateLogo } from '../src/utils/validateLogo';

const prisma = new PrismaClient();

/**
 * Idempotent post-schema backfill for the Owner Profile logo field.
 *
 * Active owners inherit the business logo when they have not chosen a personal
 * one. Safe to run on every deploy: only empty values are filled. Verification
 * fails closed per business when an owner still has no logo despite a business
 * logo being available, or when a stored logo is invalid.
 */
export async function backfillOwnerLogo(): Promise<number> {
  const activeOwners = await prisma.employee.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'OWNER' },
        { roleRecord: { is: { OR: [{ key: 'OWNER' }, { isOwnerRole: true }] } } },
      ],
    },
    select: {
      id: true,
      logoUrl: true,
      restaurant: { select: { name: true, slug: true, logoUrl: true } },
    },
  });

  let updated = 0;
  for (const owner of activeOwners) {
    if (owner.logoUrl?.trim()) continue;
    const businessLogo = owner.restaurant?.logoUrl?.trim();
    if (!businessLogo) continue;

    await prisma.employee.update({
      where: { id: owner.id },
      data: { logoUrl: businessLogo },
    });
    updated++;
  }

  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, slug: true, logoUrl: true },
    orderBy: { name: 'asc' },
  });

  const failures: string[] = [];
  const profileLogos = await prisma.employee.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'OWNER' },
        { roleRecord: { is: { OR: [{ key: 'OWNER' }, { isOwnerRole: true }] } } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, logoUrl: true, restaurantId: true },
  });

  for (const restaurant of restaurants) {
    const label = restaurant.slug
      ? `${restaurant.name} (${restaurant.slug})`
      : restaurant.name;
    const owners = profileLogos.filter((owner) => owner.restaurantId === restaurant.id);
    const businessLogo = restaurant.logoUrl?.trim();
    const missing = owners.filter((owner) => !owner.logoUrl?.trim() && businessLogo);
    const invalid = owners.filter((owner) => {
      const value = owner.logoUrl?.trim();
      return Boolean(value && !validateLogo(value).valid);
    });

    if (missing.length > 0) {
      failures.push(
        `${label}: ${missing.length} active Owner(s) without a profile logo while a business logo exists ` +
          `(${missing.map((owner) => `${owner.firstName} ${owner.lastName}`).join(', ')})`
      );
    }
    if (invalid.length > 0) {
      failures.push(
        `${label}: ${invalid.length} active Owner(s) with an invalid profile logo ` +
          `(${invalid.map((owner) => `${owner.firstName} ${owner.lastName}`).join(', ')})`
      );
    }
  }

  if (failures.length > 0) {
    console.error('Owner logo backfill FAILED per business:');
    for (const failure of failures) console.error(`  - ${failure}`);
    throw new Error(`Owner logo backfill failed for ${failures.length} business(es).`);
  }

  if (updated > 0) {
    console.log(`Owner logo backfill updated ${updated} employee record(s).`);
  } else {
    console.log('Owner logo backfill: no changes needed.');
  }

  return updated;
}

export async function disconnectOwnerLogoDb(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-owner-logo'))) {
  backfillOwnerLogo()
    .then(() => console.log('Owner logo backfill verification PASSED.'))
    .catch((error) => {
      console.error('Owner logo backfill failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectOwnerLogoDb();
    });
}
