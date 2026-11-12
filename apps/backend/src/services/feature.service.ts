import { PrismaClient } from '@prisma/client';
import { FeatureKey, FEATURES } from '../permissions';

const prisma = new PrismaClient();

export const MODULE_PRESETS = {
  starter: ['pos', 'tables', 'orders', 'payments', 'invoices', 'menu', 'kitchen', 'settings'] as FeatureKey[],
  standard: [
    'pos',
    'tables',
    'orders',
    'payments',
    'invoices',
    'menu',
    'kitchen',
    'settings',
    'deals',
    'customers',
    'dues',
    'inventory',
    'employees',
    'roles',
    'backups',
  ] as FeatureKey[],
  full: [
    'pos',
    'tables',
    'orders',
    'payments',
    'invoices',
    'menu',
    'kitchen',
    'settings',
    'deals',
    'customers',
    'dues',
    'inventory',
    'employees',
    'roles',
    'backups',
    'analytics',
    'costing',
    'expenses',
    'payroll',
    'website',
  ] as FeatureKey[],
} as const;

export const REQUIRED_MODULES: FeatureKey[] = ['pos', 'orders', 'payments', 'settings'];

export const MODULE_DEPENDENCIES: Record<string, FeatureKey[]> = {
  dues: ['customers'],
  costing: ['inventory', 'menu'],
  payroll: ['employees'],
  analytics: ['orders'],
};

export async function getEnabledFeatures(restaurantId: string): Promise<FeatureKey[]> {
  const now = new Date();
  const rows = await prisma.tenantFeature.findMany({
    where: { restaurantId, enabled: true },
    select: { featureKey: true, expiresAt: true },
  });

  return rows
    .filter((row) => !row.expiresAt || row.expiresAt > now)
    .map((row) => row.featureKey as FeatureKey);
}

export async function hasFeature(restaurantId: string, key: FeatureKey): Promise<boolean> {
  const features = await getEnabledFeatures(restaurantId);
  return features.includes(key);
}

/**
 * Migration helper to ensure existing businesses keep all standard modules enabled,
 * costing keeps its current state, and expenses/payroll start disabled.
 */
export async function migrateExistingBusinesses(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const restaurants = await prisma.restaurant.findMany({
      select: { id: true },
    });

    const standardModules: FeatureKey[] = [
      'pos',
      'tables',
      'orders',
      'payments',
      'invoices',
      'menu',
      'deals',
      'inventory',
      'kitchen',
      'employees',
      'customers',
      'dues',
      'roles',
      'analytics',
      'settings',
      'backups',
    ];

    const toCreate: Array<{ restaurantId: string; featureKey: string; enabled: boolean }> = [];

    for (const rest of restaurants) {
      const existingFeatures = await prisma.tenantFeature.findMany({
        where: { restaurantId: rest.id },
        select: { featureKey: true },
      });
      const featureSet = new Set(existingFeatures.map((f) => f.featureKey));

      for (const mod of standardModules) {
        if (!featureSet.has(mod)) {
          toCreate.push({ restaurantId: rest.id, featureKey: mod, enabled: true });
        }
      }

      for (const mod of ['expenses', 'payroll']) {
        if (!featureSet.has(mod)) {
          toCreate.push({ restaurantId: rest.id, featureKey: mod, enabled: false });
        }
      }

      if (!featureSet.has('costing')) {
        toCreate.push({ restaurantId: rest.id, featureKey: 'costing', enabled: false });
      }
    }

    if (toCreate.length > 0) {
      await prisma.tenantFeature.createMany({
        data: toCreate,
      });
    }
  } catch (err) {
    console.warn('Tenant module migration notice:', err);
  }
}
