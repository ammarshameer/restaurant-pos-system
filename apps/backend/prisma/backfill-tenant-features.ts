import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { FEATURES, FeatureKey } from '../src/permissions';

const prisma = new PrismaClient();

/**
 * Modules that existed before expenses, payroll and website were introduced.
 * These are safe to enable for every legacy business because they were already
 * part of the product when the live database was created.
 */
export const LEGACY_ENABLED_MODULES: FeatureKey[] = FEATURES.filter(
  (feature) => feature !== 'expenses' && feature !== 'payroll' && feature !== 'website' && feature !== 'costing'
);

const EXCLUDED_LEGACY_MODULES = new Set<FeatureKey>(['expenses', 'payroll', 'website']);

export interface TenantFeatureBackfillSummary {
  restaurantsProcessed: number;
  featuresCreated: number;
  costingRowsCreated: number;
}

/**
 * Idempotently restore the module rows a pre-upgrade business could use.
 *
 * Expenses, payroll and website are deliberately not created here. Costing is
 * special: an existing row is never modified (enabled/disabled/expiry are
 * preserved exactly), and a missing row is created disabled so the upgrade does
 * not silently turn on a module the business did not have.
 */
export async function backfillTenantFeatures(): Promise<TenantFeatureBackfillSummary> {
  const summary: TenantFeatureBackfillSummary = {
    restaurantsProcessed: 0,
    featuresCreated: 0,
    costingRowsCreated: 0,
  };

  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  for (const restaurant of restaurants) {
    summary.restaurantsProcessed++;

    const existing = await prisma.tenantFeature.findMany({
      where: { restaurantId: restaurant.id },
      select: { featureKey: true },
    });
    const existingKeys = new Set(existing.map((row) => row.featureKey));

    const toCreate: Array<{
      restaurantId: string;
      featureKey: string;
      enabled: boolean;
    }> = [];

    for (const feature of LEGACY_ENABLED_MODULES) {
      if (!EXCLUDED_LEGACY_MODULES.has(feature) && !existingKeys.has(feature)) {
        toCreate.push({ restaurantId: restaurant.id, featureKey: feature, enabled: true });
      }
    }

    if (!existingKeys.has('costing')) {
      toCreate.push({ restaurantId: restaurant.id, featureKey: 'costing', enabled: false });
      summary.costingRowsCreated++;
    }

    if (toCreate.length === 0) {
      continue;
    }

    await prisma.tenantFeature.createMany({ data: toCreate });
    summary.featuresCreated += toCreate.length;
    console.log(
      `  ✓ ${restaurant.name}: created ${toCreate.length} legacy module row(s)${
        toCreate.some((row) => row.featureKey === 'costing') ? ' (costing disabled)' : ''
      }`
    );
  }

  return summary;
}

export async function disconnectTenantFeaturesDb(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-tenant-features'))) {
  backfillTenantFeatures()
    .then((summary) => {
      console.log(
        `Tenant feature backfill complete: ${summary.restaurantsProcessed} business(es), ` +
          `${summary.featuresCreated} row(s) created.`
      );
    })
    .catch((error) => {
      console.error('Tenant feature backfill failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
