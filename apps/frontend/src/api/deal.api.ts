import { api } from '../lib/api';
import { Deal } from '../types/deal.types';
import { PaginatedResponse } from '../types/pagination';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

function mapDeal(item: any): Deal {
  return {
    id: item.id,
    name: item.name,
    description: item.description || '',
    price: Number(item.price),
    isActive: item.isActive !== false,
    imageUrl: item.imageUrl || undefined,
    restaurantId: item.restaurantId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    items: Array.isArray(item.items)
      ? item.items.map((di: any) => ({
          id: di.id,
          dealId: di.dealId,
          menuItemId: di.menuItemId,
          quantity: Number(di.quantity || 1),
          menuItem: di.menuItem
            ? {
                id: di.menuItem.id,
                name: di.menuItem.name,
                price: Number(di.menuItem.price || 0),
                cost: Number(di.menuItem.cost || 0),
                imageUrl: di.menuItem.imageUrl,
                category: di.menuItem.category?.name || di.menuItem.category || 'General',
              }
            : undefined,
        }))
      : [],
  };
}

export const dealApi = {
  // Paginated deals fetch
  getDealsPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    restaurantId?: string;
  }): Promise<PaginatedResponse<Deal>> => {
    try {
      const restaurantId = params?.restaurantId || DEFAULT_RESTAURANT_ID;
      const res: any = await api.get(`/deals/restaurant/${restaurantId}`, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        isActive: params?.isActive !== undefined ? String(params.isActive) : undefined,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map(mapDeal),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map(mapDeal),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch paginated deals:', e);
    }

    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  // Fetch active deals for restaurant
  getActiveDeals: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<Deal[]> => {
    try {
      const res: any = await api.get(`/deals/restaurant/${restaurantId}/active`);
      if (Array.isArray(res)) {
        return res.map(mapDeal);
      }
    } catch (e) {
      console.warn('Backend active deals fetch fallback:', e);
    }
    return [];
  },

  // Get deal by ID
  getDealById: async (id: string): Promise<Deal | null> => {
    try {
      const res: any = await api.get(`/deals/${id}`);
      if (res) return mapDeal(res);
    } catch (e) {
      console.warn('Failed to fetch deal by ID:', e);
    }
    return null;
  },

  // Create deal
  createDeal: async (deal: Partial<Deal>, restaurantId = DEFAULT_RESTAURANT_ID): Promise<Deal | null> => {
    try {
      const res: any = await api.post('/deals', {
        id: deal.id,
        name: deal.name,
        description: deal.description,
        price: Number(deal.price),
        isActive: deal.isActive !== false,
        imageUrl: deal.imageUrl || undefined,
        restaurantId: deal.restaurantId || restaurantId,
        items: deal.items?.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: Number(item.quantity || 1),
        })),
      });
      return res ? mapDeal(res) : null;
    } catch (e) {
      console.warn('Failed to save deal to backend DB:', e);
      return null;
    }
  },

  // Update deal
  updateDeal: async (id: string, deal: Partial<Deal>): Promise<Deal | null> => {
    try {
      const payload: any = {
        name: deal.name,
        description: deal.description,
        price: deal.price !== undefined ? Number(deal.price) : undefined,
        isActive: deal.isActive,
        imageUrl: deal.imageUrl,
        restaurantId: deal.restaurantId,
      };

      if (deal.items !== undefined) {
        payload.items = deal.items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: Number(item.quantity || 1),
        }));
      }

      const res: any = await api.patch(`/deals/${id}`, payload);
      return res ? mapDeal(res) : null;
    } catch (e) {
      console.warn('Failed to update deal in backend DB:', e);
      return null;
    }
  },

  // Toggle active status
  toggleDealActive: async (id: string, isActive?: boolean): Promise<Deal | null> => {
    try {
      const res: any = await api.patch(`/deals/${id}/toggle`, { isActive });
      return res ? mapDeal(res) : null;
    } catch (e) {
      console.warn('Failed to toggle deal status in backend DB:', e);
      return null;
    }
  },

  // Delete deal
  deleteDeal: async (id: string): Promise<boolean> => {
    try {
      await api.delete(`/deals/${id}`);
      return true;
    } catch (e) {
      console.warn('Failed to delete deal from backend DB:', e);
      return false;
    }
  },
};
