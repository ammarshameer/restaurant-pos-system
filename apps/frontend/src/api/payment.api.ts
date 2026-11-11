import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';
import { getCurrentRestaurantId } from '../lib/session';
import { syncEngine } from '../lib/offline/syncEngine';
import { network, isNetworkError } from '../lib/offline/network';

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
      const restaurantId = params?.restaurantId || getCurrentRestaurantId();
      const endpoint = restaurantId ? `/payments/restaurant/${restaurantId}` : '/payments';

      const res: any = await api.get(endpoint, {
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
    const restaurantId = getCurrentRestaurantId();

    // Payments must survive an offline POS: queue them in the sync outbox so
    // they are replayed (idempotently) once connectivity returns.
    const queuePayment = async () => {
      const orderId = data?.orderId;
      if (!orderId) throw new Error('orderId is required to queue a payment');
      if (!restaurantId) throw new Error('Tenant restaurant ID not available. Please log in.');

      const amount = Number(data.amount || 0);
      await syncEngine.patchLocalOrder(orderId, {
        ...(data.totalPaid !== undefined ? { totalPaid: data.totalPaid } : {}),
        ...(data.paymentStatus ? { paymentStatus: data.paymentStatus } : {}),
        ...(data.settleToCredit ? { settledToCredit: true } : {}),
        syncStatus: 'PENDING',
        pending: true,
      });
      await syncEngine.enqueue({
        type: 'UPDATE_PAYMENT_STATUS',
        restaurantId,
        entityId: orderId,
        payload: {
          id: orderId,
          amount,
          paymentMethod: data.method || 'CASH',
          tipAmount: Number(data.tipAmount || 0),
          settleToCredit: Boolean(data.settleToCredit),
          transactionId: data.transactionId,
        },
      });

      return { orderId, amount, pending: true, customerBalance: undefined };
    };

    if (!network.isOnline()) return queuePayment();

    try {
      return await api.post('/payments', data);
    } catch (error) {
      if (isNetworkError(error)) return queuePayment();
      throw error;
    }
  },

  getReceiptData: async (id: string) => {
    return api.get(`/payments/${id}/receipt`);
  },
};
