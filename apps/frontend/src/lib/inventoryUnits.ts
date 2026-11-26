/**
 * Shared inventory unit definitions.
 *
 * Piece-based items are labelled "pcs" in the UI. Existing rows may still hold
 * legacy values such as "each" or "unit"; those are treated as the same unit by
 * the backend converters and are displayed as "pcs" here.
 */
export const INVENTORY_UNITS = ['pcs', 'g', 'kg', 'ml', 'l', 'cans', 'boxes'] as const;

const PIECE_UNITS = new Set(['pcs', 'pc', 'piece', 'pieces', 'each', 'unit', 'units']);

export function canonicalUnit(unit?: string | null): string {
  const value = (unit || '').trim();
  if (!value) return 'pcs';
  return PIECE_UNITS.has(value.toLowerCase()) ? 'pcs' : value;
}

export function formatUnitLabel(unit?: string | null): string {
  const value = (unit || '').trim();
  if (PIECE_UNITS.has(value.toLowerCase())) return 'pcs';
  if (/^(lbs?|pound|pounds)$/i.test(value)) return 'lbs';
  if (/^(l|litre|litres|liter|liters)$/i.test(value)) return 'l';
  return value || 'pcs';
}

/** Dropdown values, keeping the current value selectable even if it is legacy. */
export function unitOptionsWithCurrent(current?: string | null): string[] {
  const normalized = PIECE_UNITS.has((current || '').trim().toLowerCase())
    ? 'pcs'
    : (current || '').trim();
  if (!normalized) return [...INVENTORY_UNITS];
  return INVENTORY_UNITS.includes(normalized as (typeof INVENTORY_UNITS)[number])
    ? [...INVENTORY_UNITS]
    : [normalized, ...INVENTORY_UNITS];
}
