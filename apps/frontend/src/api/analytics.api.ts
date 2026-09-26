import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

export interface SalesAnalyticsResponse {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  itemsSold: number;
  orders: any[];
}

export interface TopSellingItem {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
  category?: string;
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
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<SalesAnalyticsResponse> => {
    return api.get<SalesAnalyticsResponse>(`/analytics/sales/${restaurantId}`, {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    });
  },

  getTopSellingItemsPaginated: async (params: {
    startDate: string | Date;
    endDate: string | Date;
    page?: number;
    limit?: number;
    restaurantId?: string;
  }): Promise<PaginatedResponse<TopSellingItem>> => {
    try {
      const restaurantId = params.restaurantId || DEFAULT_RESTAURANT_ID;
      const res: any = await api.get(`/analytics/top-items/${restaurantId}`, {
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
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<TopSellingItem[]> => {
    try {
      const res: any = await api.get(`/analytics/top-items/${restaurantId}`, {
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
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<HourlyRevenueItem[]> => {
    return api.get<HourlyRevenueItem[]>(`/analytics/revenue-by-hour/${restaurantId}`, {
      date: new Date(date).toISOString(),
    });
  },

  getDashboardSummary: async (
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<any> => {
    return api.get(`/analytics/dashboard/${restaurantId}`);
  },
};
