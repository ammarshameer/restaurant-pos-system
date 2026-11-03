import { api } from '../lib/api';
import { Deal } from '../types/deal.types';
import { PaginatedResponse } from '../types/pagination';
import { offlineDB } from '../lib/offline/db';
import { isNetworkError } from '../lib/offline/network';
import { getCurrentRestaurantId } from '../lib/session';

const DEALS_CACHE_KEY = (restaurantId: string) => `deals:${restaurantId}`;

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
      const restaurantId = params?.restaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/deals/restaurant/${restaurantId}` : '/deals';
      const res: any = await api.get(endpoint, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        isActive: params?.isActive !== undefined ? String(params.isActive) : undefined,
      });

      if (res && Array.isArray(res.data)) {
        return {
          data: res.data.map(mapDeal),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }
    } catch (e) {
      if (isNetworkError(e)) {
        const restId = params?.restaurantId || getCurrentRestaurantId();
        if (restId) {
          const cached = await getCachedDeals(restId);
          if (cached.length > 0) {
            return {
              data: cached,
              page: 1,
              limit: cached.length,
              totalCount: cached.length,
              hasMore: false,
            };
          }
        }
      }
      console.warn('Backend paginated deals fetch error:', e);
    }

    return {
      data: [],
      page: 1,
      limit: 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  // Fetch active deals for restaurant (cached locally for offline POS use)
  getActiveDeals: async (paramRestaurantId?: string): Promise<Deal[]> => {
    const restaurantId = paramRestaurantId || getCurrentRestaurantId();
    if (!restaurantId) return [];

    try {
      const res: any = await api.get(`/deals/restaurant/${restaurantId}/active`);
      if (Array.isArray(res)) {
        const deals = res.map(mapDeal);
        try {
          await offlineDB.kv.put({ key: DEALS_CACHE_KEY(restaurantId), value: deals, updatedAt: Date.now() });
        } catch {
          // Cache write is best-effort.
        }
        return deals;
      }
    } catch (e) {
      if (isNetworkError(e)) {
        const cached = await getCachedDeals(restaurantId);
        if (cached.length > 0) {
          console.warn('Offline: serving cached deals.');
          return cached;
        }
      }
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
  createDeal: async (deal: Partial<Deal>, paramRestaurantId?: string): Promise<Deal | null> => {
    const restaurantId = paramRestaurantId || deal.restaurantId || getCurrentRestaurantId();
    try {
      const res: any = await api.post('/deals', {
        id: deal.id,
        name: deal.name,
        description: deal.description,
        price: Number(deal.price),
        isActive: deal.isActive !== false,
        imageUrl: deal.imageUrl || undefined,
        restaurantId,
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
  updateDeal: async (id: string, data: Partial<Deal>): Promise<Deal | null> => {
    try {
      const payload: any = { ...data };
      if (data.items) {
        payload.items = data.items.map((item) => ({
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

  // Toggle deal active
  toggleDealActive: async (id: string, isActive: boolean): Promise<Deal | null> => {
    return dealApi.updateDeal(id, { isActive });
  },

  // Delete deal
  deleteDeal: async (id: string): Promise<any> => {
    try {
      return await api.delete(`/deals/${id}`);
    } catch (e) {
      console.warn('Failed to delete deal from backend DB:', e);
      return null;
    }
  },
};

/** Read the last cached deals for offline use. */
export async function getCachedDeals(paramRestaurantId?: string): Promise<Deal[]> {
  const restaurantId = paramRestaurantId || getCurrentRestaurantId();
  if (!restaurantId) return [];
  try {
    const entry = await offlineDB.kv.get(DEALS_CACHE_KEY(restaurantId));
    return Array.isArray(entry?.value) ? (entry.value as Deal[]) : [];
  } catch {
    return [];
  }
}
