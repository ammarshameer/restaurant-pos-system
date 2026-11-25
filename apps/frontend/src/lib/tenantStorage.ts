import { getCurrentRestaurantId } from './session';

/**
 * Browser caches must never be shared between businesses. Every persisted POS
 * record is stored under a key that includes the signed-in restaurant id.
 */
const TENANT_PREFIX = 'tenant:';

const LEGACY_KEYS = [
  'restaurant_pos_menu_items',
  'restaurant_pos_deals',
  'restaurant_pos_orders',
  'pos_business_print_settings',
  'pos_order_seq',
];

function scopedKey(key: string, restaurantId?: string | null): string | null {
  const tenantId = restaurantId ?? getCurrentRestaurantId();
  return tenantId ? `${TENANT_PREFIX}${tenantId}:${key}` : null;
}

export function getTenantItem<T>(key: string, fallback: T, restaurantId?: string | null): T {
  const storageKey = scopedKey(key, restaurantId);
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function setTenantItem<T>(key: string, value: T, restaurantId?: string | null): void {
  const storageKey = scopedKey(key, restaurantId);
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage can be disabled; the Redux state still works for this session.
  }
}

export function getTenantRawItem(key: string, restaurantId?: string | null): string | null {
  const storageKey = scopedKey(key, restaurantId);
  if (!storageKey) return null;
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function setTenantRawItem(key: string, value: string, restaurantId?: string | null): void {
  const storageKey = scopedKey(key, restaurantId);
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Remove old unscoped caches. They may contain another business's menu, orders,
 * deals, or receipt branding and must not be migrated into a tenant scope.
 */
export function purgeLegacyTenantStorage(): void {
  try {
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage can be disabled.
  }
}
