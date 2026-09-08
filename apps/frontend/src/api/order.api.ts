import { api } from '../lib/api';
import { Order } from '../store/slices/orderSlice';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

export const orderApi = {
  // Fetch all orders/invoices from DB
  getAllOrders: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<Order[]> => {
    try {
      const orders: any = await api.get(`/orders/restaurant/${restaurantId}`);
      if (Array.isArray(orders)) {
        return orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          orderType: o.orderType || 'DINE_IN',
          orderTypeLabel: o.orderTypeLabel || (o.orderType === 'TAKE_AWAY' ? 'Take Away' : o.orderType === 'DELIVERY' ? 'Delivery' : 'Dine In'),
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          deliveryAddress: o.deliveryAddress,
          dineInTag: o.dineInTag,
          server: o.server,
          items: Array.isArray(o.items)
            ? o.items.map((i: any) => ({
                id: i.id,
                menuItemId: i.menuItemId,
                name: i.menuItem?.name || i.name || 'Dish',
                quantity: i.quantity,
                price: Number(i.price || i.unitPrice || 0),
                unitPrice: Number(i.unitPrice || i.price || 0),
                notes: i.specialInstructions || i.notes,
              }))
            : [],
          subtotal: Number(o.subtotal || 0),
          serviceCharge: Number(o.serviceCharge || 0),
          serviceChargeRate: Number(o.serviceChargeRate || 0),
          tax: Number(o.tax || 0),
          total: Number(o.total || 0),
          totalPaid: Number(o.totalPaid || 0),
          change: Number(o.change || 0),
          status: o.status || 'confirmed',
          paymentStatus: o.paymentStatus || (o.status === 'paid' ? 'PAID' : 'UNPAID'),
          paymentMethod: o.paymentMethod || 'CASH',
          notes: o.notes,
          createdAt: o.createdAt || new Date().toISOString(),
          updatedAt: o.updatedAt,
        }));
      }
    } catch (e) {
      console.warn('Backend orders fetch fallback to local store:', e);
    }
    return [];
  },

  // Create order/invoice in DB
  createOrder: async (order: Partial<Order>, restaurantId = DEFAULT_RESTAURANT_ID): Promise<any> => {
    try {
      return await api.post('/orders', {
        id: order.id,
        orderNumber: typeof order.orderNumber === 'number' ? order.orderNumber : parseInt(String(order.orderNumber)) || undefined,
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
        tax: 0,
        total: order.total,
        totalPaid: order.totalPaid,
        change: order.change,
        status: order.status || (order.paymentStatus === 'PAID' ? 'paid' : 'confirmed'),
        paymentStatus: order.paymentStatus || 'UNPAID',
        paymentMethod: order.paymentMethod || 'CASH',
        notes: order.notes,
        items: (order.items || []).map((i) => ({
          menuItemId: i.menuItemId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice || i.price,
          price: i.unitPrice || i.price,
          notes: i.notes,
        })),
      });
    } catch (e) {
      console.warn('Failed to save order to backend DB:', e);
      return null;
    }
  },

  // Update order/invoice in DB
  updateOrder: async (id: string, data: Partial<Order>): Promise<any> => {
    try {
      return await api.patch(`/orders/${id}`, {
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
        total: data.total,
        totalPaid: data.totalPaid,
        change: data.change,
        status: data.status,
        paymentStatus: data.paymentStatus,
        paymentMethod: data.paymentMethod,
        items: data.items,
      });
    } catch (e) {
      console.warn('Failed to update order in backend DB:', e);
      return null;
    }
  },

  // Delete/void order in DB
  deleteOrder: async (id: string): Promise<any> => {
    try {
      return await api.delete(`/orders/${id}`);
    } catch (e) {
      console.warn('Failed to delete order from backend DB:', e);
      return null;
    }
  },

  // Update order status (KDS / workflow)
  updateOrderStatus: async (id: string, status: string): Promise<any> => {
    try {
      return await api.patch(`/orders/${id}/status`, { status });
    } catch (e) {
      console.warn('Failed to update order status:', e);
      return null;
    }
  },

  // Update payment status and payment details
  updatePaymentStatus: async (
    id: string,
    paymentStatus: 'PAID' | 'UNPAID',
    paymentMethod = 'CASH',
    totalPaid?: number,
    change?: number
  ): Promise<any> => {
    try {
      return await api.patch(`/orders/${id}`, {
        paymentStatus,
        paymentMethod,
        totalPaid,
        change,
        status: paymentStatus === 'PAID' ? 'paid' : undefined,
      });
    } catch (e) {
      console.warn('Failed to update payment status:', e);
      return null;
    }
  },
};
