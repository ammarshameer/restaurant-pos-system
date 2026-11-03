import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';
import { getCurrentRestaurantId } from '../lib/session';

export interface SalesAnalyticsResponse {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  itemsSold: number;
  dealsSold?: number;
  standaloneItemsSold?: number;
  orders: any[];
}

export interface ProductRevenueItem {
  id: string;
  name: string;
  type: 'DEAL' | 'MENU_ITEM';
  category: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  dealId?: string | null;
  menuItemId?: string | null;
  rank?: number;
}

export interface TopSellingItem {
  id: string;
  name: string;
  category?: string;
  directQuantity: number;
  comboQuantity: number;
  quantity: number;
  revenue: number;
  rank?: number;
}

export interface HourlyRevenueItem {
  hour: string;
  revenue: number;
  orders: number;
}

export const analyticsApi = {
  getSalesAnalytics: async (
    startDate: string | Date,
    endDate: string | Date,
    paramRestaurantId?: string
  ): Promise<SalesAnalyticsResponse> => {
    const restaurantId = paramRestaurantId || getCurrentRestaurantId();
    const endpoint = restaurantId ? `/analytics/sales/${restaurantId}` : '/analytics/sales';
    return api.get<SalesAnalyticsResponse>(endpoint, {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    });
  },

  getProductRevenuePaginated: async (params: {
    startDate: string | Date;
    endDate: string | Date;
    page?: number;
    limit?: number;
    restaurantId?: string;
  }): Promise<PaginatedResponse<ProductRevenueItem> & { totalRevenue?: number; totalQuantity?: number }> => {
    try {
      const restaurantId = params.restaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/analytics/product-sales/${restaurantId}` : '/analytics/product-sales';
      const res: any = await api.get(endpoint, {
        startDate: new Date(params.startDate).toISOString(),
        endDate: new Date(params.endDate).toISOString(),
        page: params.page || 1,
        limit: params.limit || 50,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type || 'MENU_ITEM',
            category: item.category || (item.type === 'DEAL' ? 'Combo Deals' : 'General'),
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            revenue: Number(item.revenue || 0),
            dealId: item.dealId || null,
            menuItemId: item.menuItemId || null,
            rank: item.rank,
          })),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
          totalRevenue: res.totalRevenue,
          totalQuantity: res.totalQuantity,
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map((item: any, idx: number) => ({
            id: item.id,
            name: item.name,
            type: item.type || 'MENU_ITEM',
            category: item.category || 'General',
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            revenue: Number(item.revenue || 0),
            dealId: item.dealId || null,
            menuItemId: item.menuItemId || null,
            rank: idx + 1,
          })),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch paginated product revenue breakdown:', e);
    }

    return {
      data: [],
      page: params.page || 1,
      limit: params.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  getTopSellingItemsPaginated: async (params: {
    startDate: string | Date;
    endDate: string | Date;
    page?: number;
    limit?: number;
    restaurantId?: string;
  }): Promise<PaginatedResponse<TopSellingItem>> => {
    try {
      const restaurantId = params.restaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/analytics/top-items/${restaurantId}` : '/analytics/top-items';
      const res: any = await api.get(endpoint, {
        startDate: new Date(params.startDate).toISOString(),
        endDate: new Date(params.endDate).toISOString(),
        page: params.page || 1,
        limit: params.limit || 50,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map((item: any) => ({
            id: item.id,
            name: item.name,
            directQuantity: Number(item.directQuantity || 0),
            comboQuantity: Number(item.comboQuantity || 0),
            quantity: Number(item.quantity || 0),
            revenue: Number(item.revenue || 0),
            category: item.category || 'General',
            rank: item.rank,
          })),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map((item: any, idx: number) => ({
            id: item.id,
            name: item.name,
            directQuantity: Number(item.directQuantity || item.quantity || 0),
            comboQuantity: Number(item.comboQuantity || 0),
            quantity: Number(item.quantity || 0),
            revenue: Number(item.revenue || 0),
            category: item.category || 'General',
            rank: idx + 1,
          })),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch paginated top selling items:', e);
    }

    return {
      data: [],
      page: params.page || 1,
      limit: params.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  getTopSellingItems: async (
    startDate: string | Date,
    endDate: string | Date,
    limit = 10,
    paramRestaurantId?: string
  ): Promise<TopSellingItem[]> => {
    try {
      const restaurantId = paramRestaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/analytics/top-items/${restaurantId}` : '/analytics/top-items';
      const res: any = await api.get(endpoint, {
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        limit,
      });
      return res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  },

  getRevenueByHour: async (
    date: string | Date,
    paramRestaurantId?: string
  ): Promise<HourlyRevenueItem[]> => {
    const restaurantId = paramRestaurantId || getCurrentRestaurantId();
    const endpoint = restaurantId ? `/analytics/revenue-by-hour/${restaurantId}` : '/analytics/revenue-by-hour';
    return api.get<HourlyRevenueItem[]>(endpoint, {
      date: new Date(date).toISOString(),
    });
  },

  getDashboardSummary: async (
    paramRestaurantId?: string
  ): Promise<any> => {
    const restaurantId = paramRestaurantId || getCurrentRestaurantId();
    const endpoint = restaurantId ? `/analytics/dashboard/${restaurantId}` : '/analytics/dashboard';
    return api.get(endpoint);
  },
};
