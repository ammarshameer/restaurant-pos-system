import { api } from '../lib/api';
import { Order } from '../store/slices/orderSlice';
import { PaginatedResponse } from '../types/pagination';
import { syncEngine } from '../lib/offline/syncEngine';
import { network, isNetworkError } from '../lib/offline/network';
import { uuid } from '../lib/offline/id';
import { getCurrentRestaurantId } from '../lib/session';

/** Resolve the tenant id: explicit → session user → demo fallback. */
const DEFAULT_RESTAURANT_ID = (): string => getCurrentRestaurantId() || 'rest-default-1';

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
    change: Number(o.change || 0),
    status: o.status || 'confirmed',
    paymentStatus: o.paymentStatus || (o.status === 'paid' ? 'PAID' : 'UNPAID'),
    paymentMethod: o.paymentMethod || 'CASH',
    notes: o.notes,
    createdAt: o.createdAt || new Date().toISOString(),
    updatedAt: o.updatedAt,
    syncStatus: o.__syncStatus || o.syncStatus,
    pending: o.__pending ?? o.pending,
  };
}

/**
 * Persist a server order into the local cache without clobbering pending edits.
 * `notify` should be true for user-initiated writes (so the app reconciles with
 * the server version) and false for bulk list fetches (to avoid noisy updates).
 */
async function cacheServerOrder(order: any, restaurantId: string, notify = true): Promise<void> {
  if (!order?.id) return;
  try {
    await syncEngine.saveLocalOrder(mapOrderRecord(order), restaurantId, {
      pending: false,
      syncStatus: 'SYNCED',
    });
    if (notify) syncEngine.notifyServerOrder(order.id, order);
  } catch (e) {
    // Caching is best-effort.
  }
}

/** Build the POST /orders payload shared by direct + queued creation. */
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
  // Paginated order fetch (50 records per page by default)
  getOrdersPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    orderType?: string;
    paymentStatus?: string;
    status?: string;
    restaurantId?: string;
  }): Promise<PaginatedResponse<Order>> => {
    const restaurantId = params?.restaurantId || DEFAULT_RESTAURANT_ID();
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
        res.data.forEach((o: any) => void cacheServerOrder(o, restaurantId, false));
        return {
          data: res.data.map(mapOrderRecord),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        res.forEach((o: any) => void cacheServerOrder(o, restaurantId, false));
        return {
          data: res.map(mapOrderRecord),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (e) {
      if (isNetworkError(e)) {
        return getCachedOrdersPage(params, restaurantId);
      }
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

  // Fetch all orders/invoices from DB (legacy support)
  getAllOrders: async (restaurantId = DEFAULT_RESTAURANT_ID()): Promise<Order[]> => {
    try {
      const res: any = await api.get(`/orders/restaurant/${restaurantId}`, { page: 1, limit: 100 });
      const list = res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      list.forEach((o: any) => void cacheServerOrder(o, restaurantId, false));
      return list.map(mapOrderRecord);
    } catch (e) {
      if (isNetworkError(e)) {
        const cached = await syncEngine.listCachedOrders(restaurantId);
        return cached.map(mapOrderRecord);
      }
      console.warn('Backend orders fetch fallback to local store:', e);
    }
    return [];
  },

  // Create order/invoice in DB — queues locally when offline
  createOrder: async (order: Partial<Order>, restaurantId = DEFAULT_RESTAURANT_ID()): Promise<any> => {
    const clientId = (order as any).clientId || uuid();
    const id = order.id || clientId;
    const payload = buildOrderPayload(order, restaurantId, id, clientId);

    const queueCreate = async () => {
      const localOrder: any = {
        ...order,
        id,
        clientId,
        syncStatus: 'PENDING',
        pending: true,
        createdAt: order.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await syncEngine.saveLocalOrder(localOrder, restaurantId, { pending: true, syncStatus: 'PENDING' });
      await syncEngine.enqueue({
        type: 'CREATE_ORDER',
        restaurantId,
        entityId: id,
        clientId,
        payload,
      });
      return localOrder;
    };

    if (!network.isOnline()) return queueCreate();

    try {
      const res: any = await api.post('/orders', payload);
      await cacheServerOrder(res, restaurantId);
      return res;
    } catch (e) {
      if (isNetworkError(e)) return queueCreate();
      console.warn('Failed to save order to backend DB:', e);
      return null;
    }
  },

  // Update order/invoice in DB — queues locally when offline
  updateOrder: async (id: string, data: Partial<Order>, restaurantId = DEFAULT_RESTAURANT_ID()): Promise<any> => {
    const payload = {
      orderType: data.orderType,
      orderTypeLabel: data.orderTypeLabel,
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

    const queueUpdate = async () => {
      await syncEngine.saveLocalOrder(
        { ...data, id, syncStatus: 'PENDING', pending: true },
        restaurantId,
        { pending: true, syncStatus: 'PENDING' }
      );
      await syncEngine.enqueue({
        type: 'UPDATE_ORDER',
        restaurantId,
        entityId: id,
        payload: { id, data: payload },
      });
      return { ...data, id, pending: true };
    };

    if (!network.isOnline()) return queueUpdate();

    try {
      const res: any = await api.patch(`/orders/${id}`, payload);
      await cacheServerOrder(res, restaurantId);
      return res;
    } catch (e) {
      if (isNetworkError(e)) return queueUpdate();
      console.warn('Failed to update order in backend DB:', e);
      return null;
    }
  },

  // Delete/void order in DB — queues locally when offline
  deleteOrder: async (id: string, restaurantId = DEFAULT_RESTAURANT_ID()): Promise<any> => {
    const queueDelete = async () => {
      await syncEngine.removeLocalOrder(id);
      await syncEngine.enqueue({
        type: 'DELETE_ORDER',
        restaurantId,
        entityId: id,
        payload: { id },
      });
      return true;
    };

    if (!network.isOnline()) return queueDelete();

    try {
      const res = await api.delete(`/orders/${id}`);
      await syncEngine.removeLocalOrder(id);
      return res;
    } catch (e) {
      if (isNetworkError(e)) return queueDelete();
      console.warn('Failed to delete order from backend DB:', e);
      return null;
    }
  },

  // Update order status (KDS / workflow) — queues locally when offline
  updateOrderStatus: async (id: string, status: string, restaurantId = DEFAULT_RESTAURANT_ID()): Promise<any> => {
    const queueStatus = async () => {
      await syncEngine.patchLocalOrder(id, { status });
      await syncEngine.enqueue({
        type: 'UPDATE_ORDER',
        restaurantId,
        entityId: id,
        payload: { id, data: { status } },
      });
      return { id, status, pending: true };
    };

    if (!network.isOnline()) return queueStatus();

    try {
      const res: any = await api.patch(`/orders/${id}/status`, { status });
      await cacheServerOrder(res, restaurantId);
      return res;
    } catch (e) {
      if (isNetworkError(e)) return queueStatus();
      console.warn('Failed to update order status:', e);
      return null;
    }
  },

  // Update payment status and payment details — queues locally when offline
  updatePaymentStatus: async (
    id: string,
    paymentStatus: 'PAID' | 'UNPAID',
    paymentMethod = 'CASH',
    totalPaid?: number,
    change?: number,
    restaurantId = DEFAULT_RESTAURANT_ID()
  ): Promise<any> => {
    const queuePayment = async () => {
      await syncEngine.patchLocalOrder(id, {
        paymentStatus,
        paymentMethod,
        totalPaid,
        change,
        ...(paymentStatus === 'PAID' ? { status: 'paid' } : {}),
      });
      await syncEngine.enqueue({
        type: 'UPDATE_PAYMENT_STATUS',
        restaurantId,
        entityId: id,
        payload: { id, paymentStatus, paymentMethod, totalPaid, change },
      });
      return { id, paymentStatus, paymentMethod, totalPaid, change, pending: true };
    };

    if (!network.isOnline()) return queuePayment();

    try {
      const res: any = await api.patch(`/orders/${id}`, {
        paymentStatus,
        paymentMethod,
        totalPaid,
        change,
        status: paymentStatus === 'PAID' ? 'paid' : undefined,
      });
      await cacheServerOrder(res, restaurantId);
      return res;
    } catch (e) {
      if (isNetworkError(e)) return queuePayment();
      console.warn('Failed to update payment status:', e);
      return null;
    }
  },
};

/** Filter + paginate locally cached orders when the server is unreachable. */
async function getCachedOrdersPage(
  params:
    | {
        page?: number;
        limit?: number;
        search?: string;
        orderType?: string;
        paymentStatus?: string;
        status?: string;
        restaurantId?: string;
      }
    | undefined,
  restaurantId: string
): Promise<PaginatedResponse<Order>> {
  const limit = params?.limit || 50;
  const page = params?.page || 1;

  let list = (await syncEngine.listCachedOrders(restaurantId)).map(mapOrderRecord);

  if (params?.orderType && params.orderType !== 'ALL') {
    list = list.filter((o) => o.orderType === params.orderType);
  }
  if (params?.paymentStatus && params.paymentStatus !== 'ALL') {
    list = list.filter((o) => o.paymentStatus === params.paymentStatus);
  }
  if (params?.status && params.status !== 'ALL') {
    list = list.filter((o) => o.status === params.status);
  }
  if (params?.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase();
    list = list.filter(
      (o) =>
        String(o.orderNumber).includes(q) ||
        (o.customerName || '').toLowerCase().includes(q) ||
        (o.customerPhone || '').toLowerCase().includes(q) ||
        (o.deliveryAddress || '').toLowerCase().includes(q) ||
        (o.dineInTag || '').toLowerCase().includes(q)
    );
  }

  const totalCount = list.length;
  const start = (page - 1) * limit;

  return {
    data: list.slice(start, start + limit),
    page,
    limit,
    totalCount,
    hasMore: start + limit < totalCount,
  };
}
