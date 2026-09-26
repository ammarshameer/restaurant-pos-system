import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

export interface PaymentItem {
  id: string;
  orderId: string;
  orderNumber?: number;
  orderType?: string;
  customerRef?: string;
  amount: number;
  tipAmount: number;
  method: string;
  status: string;
  transactionId?: string;
  processedAt: string;
  createdAt: string;
  order?: any;
}

export const paymentApi = {
  getPaymentsPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    method?: string;
    startDate?: string;
    endDate?: string;
    restaurantId?: string;
  }): Promise<PaginatedResponse<PaymentItem>> => {
    try {
      const restaurantId = params?.restaurantId || DEFAULT_RESTAURANT_ID;
      const res: any = await api.get(`/payments/restaurant/${restaurantId}`, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        method: params?.method || undefined,
        startDate: params?.startDate || undefined,
        endDate: params?.endDate || undefined,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map((p: any) => ({
            id: p.id,
            orderId: p.orderId,
            orderNumber: p.order?.orderNumber,
            orderType: p.order?.orderType,
            customerRef: p.order?.customerName || p.order?.deliveryAddress || p.order?.dineInTag || 'Counter Order',
            amount: Number(p.amount || 0),
            tipAmount: Number(p.tipAmount || 0),
            method: p.method || 'CASH',
            status: p.status || 'COMPLETED',
            transactionId: p.transactionId,
            processedAt: p.processedAt || p.createdAt,
            createdAt: p.createdAt,
            order: p.order,
          })),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map((p: any) => ({
            id: p.id,
            orderId: p.orderId,
            orderNumber: p.order?.orderNumber,
            orderType: p.order?.orderType,
            customerRef: p.order?.customerName || p.order?.deliveryAddress || p.order?.dineInTag || 'Counter Order',
            amount: Number(p.amount || 0),
            tipAmount: Number(p.tipAmount || 0),
            method: p.method || 'CASH',
            status: p.status || 'COMPLETED',
            transactionId: p.transactionId,
            processedAt: p.processedAt || p.createdAt,
            createdAt: p.createdAt,
            order: p.order,
          })),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch paginated payments from backend:', e);
    }

    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  createPayment: async (data: any) => {
    return api.post('/payments', data);
  },

  getReceiptData: async (id: string) => {
    return api.get(`/payments/${id}/receipt`);
  },
};
