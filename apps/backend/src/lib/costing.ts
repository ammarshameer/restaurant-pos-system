/**
 * Costing helpers shared by the costing service.
 *
 * Inventory items are purchased in a "purchase unit" (e.g. kg, l) at
 * `costPerUnit`, but consumed in a "sale/usage unit" (e.g. g, ml). Recipe
 * quantities are expressed in the usage unit, so the cost of one usage unit
 * has to be derived before multiplying by the quantity used.
 *
 * These helpers mirror the logic used by the frontend inventory page so the
 * numbers shown in the UI and the numbers reported by the backend agree.
 */

export interface CostableInventoryItem {
  unit?: string | null;
  purchaseUnit?: string | null;
  conversionFactor?: number | null;
  costPerUnit?: number | null;
}

const STANDARD_UNIT_SCALE: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  ml: 1, milliliter: 1, milliliters: 1,
  l: 1000, litre: 1000, liters: 1000,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
  oz: 28.349523, ounce: 28.349523, ounces: 28.349523,
};

function normalizeUnit(unit?: string | null): string {
  return (unit || '').trim().toLowerCase();
}

/**
 * Cost of a single unit of the inventory item's sale unit (the unit stored in
 * `InventoryItem.unit` and used by recipe quantities).
 */
export function getCostPerSaleUnit(item: CostableInventoryItem): number {
  const saleUnit = normalizeUnit(item.unit) || 'each';
  const purchaseUnit = normalizeUnit(item.purchaseUnit) || saleUnit;
  const costPerUnit = Number(item.costPerUnit || 0);
  const conversionFactor = Number(item.conversionFactor || 1) || 1;

  if (purchaseUnit === saleUnit) {
    return costPerUnit / conversionFactor;
  }

  const purchaseScale = STANDARD_UNIT_SCALE[purchaseUnit];
  const saleScale = STANDARD_UNIT_SCALE[saleUnit];
  if (purchaseScale && saleScale) {
    return costPerUnit / (purchaseScale / saleScale);
  }

  return costPerUnit / conversionFactor;
}

/**
 * Convert a recipe quantity expressed in `usageUnit` into a cost, using the
 * cost of one sale unit.
 */
export function getConvertedIngredientCost(
  quantity: number,
  usageUnit: string | null | undefined,
  saleUnit: string | null | undefined,
  costPerSaleUnit: number,
  conversionFactor = 1
): number {
  const qty = Number(quantity || 0);
  const from = normalizeUnit(usageUnit);
  const to = normalizeUnit(saleUnit);

  if (!from || from === to) return qty * costPerSaleUnit;

  const fromScale = STANDARD_UNIT_SCALE[from];
  const toScale = STANDARD_UNIT_SCALE[to];
  if (fromScale && toScale) {
    return qty * (fromScale / toScale) * costPerSaleUnit;
  }

  return (qty * costPerSaleUnit) / (conversionFactor || 1);
}

/** Unit cost of a menu item, derived from its recipe when one exists. */
export function getRecipeUnitCost(menuItem: any): number {
  const ingredients = menuItem?.ingredients || [];
  if (ingredients.length > 0) {
    return ingredients.reduce((sum: number, ing: any) => {
      const inventoryItem = ing?.inventoryItem;
      if (!inventoryItem) return sum;

      const saleUnit = inventoryItem.unit || 'each';
      const costPerSaleUnit = getCostPerSaleUnit(inventoryItem);
      const usageUnit = ing.unit || saleUnit;
      return (
        sum +
        getConvertedIngredientCost(
          Number(ing.quantityUsed || 0),
          usageUnit,
          saleUnit,
          costPerSaleUnit,
          Number(inventoryItem.conversionFactor || 1)
        )
      );
    }, 0);
  }

  return Number(menuItem?.cost || 0);
}

/**
 * Cost of one unit of an order line. Uses `costAtSale` when recorded,
 * falling back to expanding deals into dishes or the live recipe cost.
 */
export function getOrderItemUnitCost(orderItem: any): number {
  if (orderItem?.costAtSale !== null && orderItem?.costAtSale !== undefined) {
    return Number(orderItem.costAtSale);
  }

  const dealItems = orderItem?.deal?.items;
  if (Array.isArray(dealItems) && dealItems.length > 0) {
    return dealItems.reduce(
      (sum: number, dealItem: any) =>
        sum + Number(dealItem.quantity || 0) * getRecipeUnitCost(dealItem.menuItem),
      0
    );
  }

  return getRecipeUnitCost(orderItem?.menuItem);
}
