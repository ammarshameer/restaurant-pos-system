import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';

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

function mapInventoryItem(i: any): InventoryItem {
  return {
    id: i.id,
    name: i.name,
    sku: i.sku || `SKU-${i.id.slice(0, 4)}`,
    category: i.category || 'General',
    quantity: Number(i.quantity || 0),
    unit: i.unit || 'units',
    reorderPoint: Number(i.reorderPoint || 5),
    costPerUnit: Number(i.costPerUnit || 0),
    lastRestocked: i.lastRestocked ? new Date(i.lastRestocked).toISOString().slice(0, 10) : undefined,
  };
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
      const restaurantId = params?.restaurantId || DEFAULT_RESTAURANT_ID;
      const res: any = await api.get(`/inventory/restaurant/${restaurantId}`, {
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

  getInventory: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<InventoryItem[]> => {
    try {
      const res: any = await api.get(`/inventory/restaurant/${restaurantId}`, { page: 1, limit: 100 });
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
        restaurantId: params?.restaurantId || DEFAULT_RESTAURANT_ID,
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
