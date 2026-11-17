import { api } from '../lib/api';
import { Order } from '../store/slices/orderSlice';
import { PaginatedResponse } from '../types/pagination';
import { uuid } from '../lib/id';
import { getCurrentRestaurantId } from '../lib/session';

/** Resolve tenant id strictly from session, failing safely if unavailable */
const getTenantRestaurantId = (overrideId?: string): string => {
  const id = overrideId || getCurrentRestaurantId();
  if (!id) {
    throw new Error('Tenant restaurant ID not available. Please log in.');
  }
  return id;
};

export function mapOrderRecord(o: any): Order {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    orderType: o.orderType || 'DINE_IN',
    orderTypeLabel:
      o.orderTypeLabel ||
      (o.orderType === 'TAKE_AWAY'
        ? 'Take Away'
        : o.orderType === 'DELIVERY'
        ? 'Delivery'
        : 'Dine In'),
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerId: o.customerId,
    deliveryAddress: o.deliveryAddress,
    dineInTag: o.dineInTag,
    server: o.server,
    items: Array.isArray(o.items)
      ? o.items.map((i: any) => ({
          id: i.id,
          menuItemId: i.menuItemId || undefined,
          dealId: i.dealId || undefined,
          isDeal: Boolean(i.dealId || i.deal || i.isDeal),
          deal: i.deal,
          name: i.deal?.name || i.menuItem?.name || i.name || 'Dish',
          quantity: i.quantity,
          price: Number(i.price || i.unitPrice || 0),
          unitPrice: Number(i.unitPrice || i.price || 0),
          notes: i.specialInstructions || i.notes,
        }))
      : [],
    subtotal: Number(o.subtotal || 0),
    serviceCharge: Number(o.serviceCharge || 0),
    serviceChargeRate: Number(o.serviceChargeRate || 0),
    deliveryCharge: Number(o.deliveryCharge || 0),
    tax: Number(o.tax || 0),
    taxRate: Number(o.taxRate || 0),
    total: Number(o.total || 0),
    totalPaid: Number(o.totalPaid || 0),
    amountDue: Number(o.amountDue ?? Math.max(0, Number(o.total || 0) - Number(o.totalPaid || 0))),
    settledToCredit: Boolean(o.settledToCredit),
    change: Number(o.change || 0),
    status: o.status || 'confirmed',
    paymentStatus: o.paymentStatus || (Number(o.totalPaid || 0) >= Number(o.total || 0) && Number(o.total || 0) > 0 ? 'PAID' : (Number(o.totalPaid || 0) > 0 ? 'PARTIAL' : 'UNPAID')),
    paymentMethod: o.paymentMethod || 'CASH',
    notes: o.notes,
    createdAt: o.createdAt || new Date().toISOString(),
    updatedAt: o.updatedAt,
  };
}

function buildOrderPayload(order: Partial<Order>, restaurantId: string, id: string, clientId: string) {
  return {
    id,
    clientId,
    orderNumber:
      typeof order.orderNumber === 'number' ? order.orderNumber : parseInt(String(order.orderNumber)) || undefined,
    orderType: order.orderType || 'DINE_IN',
    orderTypeLabel: order.orderTypeLabel,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerId: (order as any).customerId,
    deliveryAddress: order.deliveryAddress,
    dineInTag: order.dineInTag,
    restaurantId,
    subtotal: order.subtotal,
    serviceCharge: order.serviceCharge,
    serviceChargeRate: order.serviceChargeRate,
    deliveryCharge: order.deliveryCharge,
    tax: order.tax,
    taxRate: order.taxRate,
    total: order.total,
    totalPaid: order.totalPaid,
    change: order.change,
    status: order.status || (order.paymentStatus === 'PAID' ? 'paid' : 'confirmed'),
    paymentStatus: order.paymentStatus || 'UNPAID',
    paymentMethod: order.paymentMethod || 'CASH',
    notes: order.notes,
    createdAt: order.createdAt,
    items: (order.items || []).map((i: any) => ({
      menuItemId: i.menuItemId || undefined,
      dealId: i.dealId || undefined,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice || i.price,
      price: i.unitPrice || i.price,
      notes: i.notes,
      status: i.status,
    })),
  };
}

export const orderApi = {
  getOrdersPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    orderType?: string;
    paymentStatus?: string;
    status?: string;
    restaurantId?: string;
  }): Promise<PaginatedResponse<Order>> => {
    let restaurantId: string;
    try {
      restaurantId = getTenantRestaurantId(params?.restaurantId);
    } catch {
      return { data: [], page: 1, limit: 50, totalCount: 0, hasMore: false };
    }
    try {
      const res: any = await api.get(`/orders/restaurant/${restaurantId}`, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        orderType: params?.orderType || undefined,
        paymentStatus: params?.paymentStatus || undefined,
        status: params?.status || undefined,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map(mapOrderRecord),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }
      if (Array.isArray(res)) {
        return { data: res.map(mapOrderRecord), page: 1, limit: res.length, totalCount: res.length, hasMore: false };
      }
    } catch (e) {
      console.warn('Failed to fetch paginated orders from backend:', e);
    }
    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  getAllOrders: async (paramRestaurantId?: string): Promise<Order[]> => {
    let restaurantId: string;
    try {
      restaurantId = getTenantRestaurantId(paramRestaurantId);
    } catch {
      return [];
    }
    try {
      const res: any = await api.get(`/orders/restaurant/${restaurantId}`, { page: 1, limit: 100 });
      const list = res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      return list.map(mapOrderRecord);
    } catch (e) {
      console.warn('Failed to fetch orders from backend:', e);
      return [];
    }
  },

  // The clientId is stable across retries; the server dedupes on it.
  createOrder: async (order: Partial<Order>, paramRestaurantId?: string): Promise<any> => {
    const restaurantId = getTenantRestaurantId(paramRestaurantId);
    const clientId = (order as any).clientId || uuid();
    const id = order.id || clientId;
    return api.post('/orders', buildOrderPayload(order, restaurantId, id, clientId));
  },

  updateOrder: async (id: string, data: Partial<Order>, paramRestaurantId?: string): Promise<any> => {
    getTenantRestaurantId(paramRestaurantId);
    const payload = {
      orderType: data.orderType,
      orderTypeLabel: data.orderTypeLabel,
      customerId: (data as any).customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      deliveryAddress: data.deliveryAddress,
      dineInTag: data.dineInTag,
      notes: data.notes,
      subtotal: data.subtotal,
      serviceCharge: data.serviceCharge,
      serviceChargeRate: data.serviceChargeRate,
      deliveryCharge: data.deliveryCharge,
      tax: data.tax,
      taxRate: data.taxRate,
      total: data.total,
      totalPaid: data.totalPaid,
      change: data.change,
      status: data.status,
      paymentStatus: data.paymentStatus,
      paymentMethod: data.paymentMethod,
      items: (data.items || []).map((i: any) => ({
        menuItemId: i.menuItemId || undefined,
        dealId: i.dealId || undefined,
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice || i.price,
        price: i.unitPrice || i.price,
        notes: i.notes,
      })),
    };
    return api.patch(`/orders/${id}`, payload);
  },

  deleteOrder: async (id: string, paramRestaurantId?: string): Promise<any> => {
    getTenantRestaurantId(paramRestaurantId);
    return api.delete(`/orders/${id}`);
  },

  updateOrderStatus: async (id: string, status: string, paramRestaurantId?: string): Promise<any> => {
    getTenantRestaurantId(paramRestaurantId);
    return api.patch(`/orders/${id}/status`, { status });
  },

  updatePaymentStatus: async (
    id: string,
    paymentStatus: 'PAID' | 'UNPAID',
    paymentMethod = 'CASH',
    totalPaid?: number,
    change?: number,
    paramRestaurantId?: string
  ): Promise<any> => {
    getTenantRestaurantId(paramRestaurantId);
    return api.patch(`/orders/${id}`, {
      paymentStatus,
      paymentMethod,
      totalPaid,
      change,
      status: paymentStatus === 'PAID' ? 'paid' : undefined,
    });
  },
};
