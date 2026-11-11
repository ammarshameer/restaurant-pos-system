import { hasFeature } from './feature.service';

const COST_FIELDS = new Set([
  'cost', 'costPerUnit', 'purchaseUnitCost', 'saleUnitCost', 'convertedCostPerSaleUnit',
  'unitCost', 'averageCost', 'totalCost', 'foodCost', 'netMargin', 'profit', 'cogs',
  'costPercentage', 'estimatedCost', 'costTotal', 'margin', 'grossProfit', 'netProfit',
  'grossMargin',
]);

export function redactCosting<T>(payload: T): T {
  const redact = (value: any): any => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    const result: any = {};
    for (const [key, child] of Object.entries(value)) {
      if (!COST_FIELDS.has(key)) result[key] = redact(child);
    }
    return result;
  };
  return redact(payload);
}

export function canUserViewCosting(
  user?: { isOwnerRole?: boolean; role?: string; permissions?: string[] } | null
): boolean {
  if (!user) return false;
  if (user.isOwnerRole || user.role === 'OWNER') return true;
  return Array.isArray(user.permissions) && user.permissions.includes('costing.view');
}

export async function redactCostingIfUnauthorized<T>(
  restaurantId: string,
  payload: T,
  user?: { isOwnerRole?: boolean; role?: string; permissions?: string[] } | null
): Promise<T> {
  if (!canUserViewCosting(user)) {
    return redactCosting(payload);
  }
  const enabled = await hasFeature(restaurantId, 'costing');
  return enabled ? payload : redactCosting(payload);
}
