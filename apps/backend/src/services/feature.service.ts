import { PrismaClient } from '@prisma/client';
import { FeatureKey } from '../permissions';

const prisma = new PrismaClient();

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
