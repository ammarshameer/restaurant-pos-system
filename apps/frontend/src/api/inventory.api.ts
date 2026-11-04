import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';
import { getCurrentRestaurantId } from '../lib/session';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  unit: string;
  purchaseUnit?: string;
  conversionFactor?: number;
  reorderPoint: number;
  costPerUnit: number;
  lastRestocked?: string;
}

export interface InventoryTransaction {
  id: string;
  itemName: string;
  quantity: number;
  type: 'RESTOCK' | 'USAGE' | 'WASTE' | 'ADJUSTMENT';
  reason: string;
  createdAt: string;
}

function mapInventoryItem(i: any): InventoryItem {
  return {
    id: i.id,
    name: i.name,
    sku: i.sku || `SKU-${i.id.slice(0, 4)}`,
    category: i.category || 'General',
    quantity: Number(i.quantity || 0),
    unit: i.unit || 'units',
    purchaseUnit: i.purchaseUnit || i.unit || 'units',
    conversionFactor: Number(i.conversionFactor || 1),
    reorderPoint: Number(i.reorderPoint || 5),
    costPerUnit: Number(i.costPerUnit || 0),
    lastRestocked: i.lastRestocked ? new Date(i.lastRestocked).toISOString().slice(0, 10) : undefined,
  };
}

export function getCostPerSaleUnit(item: InventoryItem): number {
  const purchaseUnit = item.purchaseUnit || item.unit;
  if (purchaseUnit.toLowerCase() === item.unit.toLowerCase()) {
    return item.costPerUnit / (item.conversionFactor || 1);
  }
  const standardUnits: Record<string, number> = {
    g: 1, gram: 1, grams: 1,
    kg: 1000, kilogram: 1000, kilograms: 1000,
    ml: 1, milliliter: 1, milliliters: 1, l: 1000, litre: 1000, liters: 1000,
    lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
    oz: 28.349523, ounce: 28.349523, ounces: 28.349523,
  };
  const purchaseScale = standardUnits[purchaseUnit.toLowerCase()];
  const saleScale = standardUnits[item.unit.toLowerCase()];
  if (purchaseScale && saleScale) {
    return item.costPerUnit / (purchaseScale / saleScale);
  }
  return item.costPerUnit / (item.conversionFactor || 1);
}

export function getConvertedIngredientCost(
  quantity: number,
  usageUnit: string,
  saleUnit: string,
  costPerSaleUnit: number,
  conversionFactor = 1
): number {
  const from = usageUnit.toLowerCase().trim();
  const to = saleUnit.toLowerCase().trim();
  if (from === to) return quantity * costPerSaleUnit;

  const scales: Record<string, number> = {
    g: 1, gram: 1, grams: 1,
    kg: 1000, kilogram: 1000, kilograms: 1000,
    ml: 1, milliliter: 1, milliliters: 1, l: 1000, litre: 1000, liters: 1000,
    lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
    oz: 28.349523, ounce: 28.349523, ounces: 28.349523,
  };
  if (scales[from] && scales[to]) {
    return quantity * (scales[from] / scales[to]) * costPerSaleUnit;
  }
  return quantity * costPerSaleUnit / conversionFactor;
}

export const inventoryApi = {
  getInventoryPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    restaurantId?: string;
  }): Promise<PaginatedResponse<InventoryItem>> => {
    try {
      const restaurantId = params?.restaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/inventory/restaurant/${restaurantId}` : '/inventory';
      const res: any = await api.get(endpoint, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        category: params?.category || undefined,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map(mapInventoryItem),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map(mapInventoryItem),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (err) {
      console.warn('Failed to fetch paginated inventory:', err);
    }

    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  getInventory: async (paramRestaurantId?: string): Promise<InventoryItem[]> => {
    try {
      const restaurantId = paramRestaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/inventory/restaurant/${restaurantId}` : '/inventory';
      const res: any = await api.get(endpoint, { page: 1, limit: 100 });
      const list = res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      return list.map(mapInventoryItem);
    } catch (err) {
      console.warn('Failed to fetch inventory from API:', err);
    }
    return [];
  },

  getInventoryItem: async (id: string): Promise<InventoryItem | null> => {
    try {
      return await api.get<InventoryItem>(`/inventory/${id}`);
    } catch (err) {
      console.warn('Failed to fetch inventory item from API:', err);
      return null;
    }
  },

  createInventoryItem: async (
    data: Partial<InventoryItem>,
    paramRestaurantId?: string
  ): Promise<InventoryItem | null> => {
    try {
      const restaurantId = paramRestaurantId || getCurrentRestaurantId();
      return await api.post<InventoryItem>('/inventory', {
        ...data,
        restaurantId,
      });
    } catch (err) {
      console.error('Failed to create inventory item via API:', err);
      throw err;
    }
  },

  updateInventoryItem: async (id: string, data: Partial<InventoryItem>): Promise<InventoryItem | null> => {
    try {
      return await api.patch<InventoryItem>(`/inventory/${id}`, data);
    } catch (err) {
      console.error('Failed to update inventory item via API:', err);
      throw err;
    }
  },

  adjustStock: async (id: string, quantity: number, reason: string, type?: string, unit?: string): Promise<any> => {
    return api.post(`/inventory/${id}/adjust`, { quantity, reason, type, unit });
  },

  getLowStock: async (paramRestaurantId?: string): Promise<InventoryItem[]> => {
    const restaurantId = paramRestaurantId || getCurrentRestaurantId();
    const endpoint = restaurantId ? `/inventory/restaurant/${restaurantId}/low-stock` : '/inventory';
    return api.get<InventoryItem[]>(endpoint);
  },

  getTransactionsPaginated: async (
    id?: string,
    params?: {
      page?: number;
      limit?: number;
      restaurantId?: string;
    }
  ): Promise<PaginatedResponse<InventoryTransaction>> => {
    try {
      const endpoint = id && id !== 'all' ? `/inventory/${id}/transactions` : `/inventory/transactions/all`;
      const res: any = await api.get(endpoint, {
        page: params?.page || 1,
        limit: params?.limit || 50,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map((t: any) => ({
            id: t.id,
            itemName: t.inventoryItem?.name || 'Item',
            quantity: Number(t.quantity || 0),
            type: t.type,
            reason: t.reason || '',
            createdAt: t.createdAt || new Date().toISOString(),
          })),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map((t: any) => ({
            id: t.id,
            itemName: t.inventoryItem?.name || 'Item',
            quantity: Number(t.quantity || 0),
            type: t.type,
            reason: t.reason || '',
            createdAt: t.createdAt || new Date().toISOString(),
          })),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (err) {
      console.warn('Failed to fetch paginated transactions:', err);
    }

    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  getTransactions: async (id: string, limit = 50): Promise<InventoryTransaction[]> => {
    try {
      const res: any = await api.get(`/inventory/${id}/transactions`, { page: 1, limit });
      const txs = res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      return txs.map((t: any) => ({
        id: t.id,
        itemName: t.inventoryItem?.name || 'Item',
        quantity: Number(t.quantity || 0),
        type: t.type,
        reason: t.reason || '',
        createdAt: t.createdAt || new Date().toISOString(),
      }));
    } catch (err) {
      console.warn('Failed to fetch transactions from API:', err);
    }
    return [];
  },

  deleteInventoryItem: async (id: string): Promise<void> => {
    await api.delete(`/inventory/${id}`);
  },
};
