import { api } from '../lib/api';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  unit: string;
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

export const inventoryApi = {
  getInventory: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<InventoryItem[]> => {
    try {
      const items: any = await api.get(`/inventory/restaurant/${restaurantId}`);
      if (Array.isArray(items)) {
        return items.map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku || `SKU-${i.id.slice(0, 4)}`,
          category: i.category || 'General',
          quantity: Number(i.quantity || 0),
          unit: i.unit || 'units',
          reorderPoint: Number(i.reorderPoint || 5),
          costPerUnit: Number(i.costPerUnit || 0),
          lastRestocked: i.lastRestocked ? new Date(i.lastRestocked).toISOString().slice(0, 10) : undefined,
        }));
      }
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
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<InventoryItem | null> => {
    try {
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

  adjustStock: async (id: string, quantity: number, reason: string): Promise<any> => {
    return api.post(`/inventory/${id}/adjust`, { quantity, reason });
  },

  getLowStock: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<InventoryItem[]> => {
    return api.get<InventoryItem[]>(`/inventory/restaurant/${restaurantId}/low-stock`);
  },

  getTransactions: async (id: string, limit = 20): Promise<InventoryTransaction[]> => {
    try {
      const txs: any = await api.get(`/inventory/${id}/transactions`, { limit });
      if (Array.isArray(txs)) {
        return txs.map((t) => ({
          id: t.id,
          itemName: t.inventoryItem?.name || 'Item',
          quantity: Number(t.quantity || 0),
          type: t.type,
          reason: t.reason || '',
          createdAt: t.createdAt || new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.warn('Failed to fetch transactions from API:', err);
    }
    return [];
  },

  deleteInventoryItem: async (id: string): Promise<void> => {
    await api.delete(`/inventory/${id}`);
  },
};
