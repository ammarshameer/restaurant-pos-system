import { api } from '../lib/api';

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

  getTopSellingItems: async (
    startDate: string | Date,
    endDate: string | Date,
    limit = 10,
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<TopSellingItem[]> => {
    return api.get<TopSellingItem[]>(`/analytics/top-items/${restaurantId}`, {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      limit,
    });
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
