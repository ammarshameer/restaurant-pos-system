import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;
  unitPrice?: number;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: number | string;
  orderType: 'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY';
  orderTypeLabel: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  dineInTag?: string;
  server?: any;
  items: OrderItem[];
  subtotal: number;
  serviceCharge: number;
  serviceChargeRate: number;
  tax: number;
  total: number;
  totalPaid?: number;
  change?: number;
  status: 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';
  paymentStatus: 'PAID' | 'UNPAID';
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

const STORAGE_KEY = 'restaurant_pos_orders';

const loadSavedOrders = (): Order[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load orders from localStorage:', e);
  }
  return [];
};

const saveOrdersToStorage = (orders: Order[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch (e) {
    console.error('Failed to save orders to localStorage:', e);
  }
};

interface OrderState {
  orders: Order[];
  currentOrder: Order | null;
  loading: boolean;
  error: string | null;
}

const initialOrders = loadSavedOrders();

const initialState: OrderState = {
  orders: initialOrders,
  currentOrder: null,
  loading: false,
  error: null,
};

const orderSlice = createSlice({
  name: 'orders',
  initialState,
  reducers: {
    setOrders: (state, action: PayloadAction<Order[]>) => {
      state.orders = action.payload;
      saveOrdersToStorage(state.orders);
    },
    setCurrentOrder: (state, action: PayloadAction<Order | null>) => {
      state.currentOrder = action.payload;
    },
    addOrder: (state, action: PayloadAction<Order>) => {
      const existsIndex = state.orders.findIndex((o) => o.id === action.payload.id);
      if (existsIndex !== -1) {
        state.orders[existsIndex] = action.payload;
      } else {
        state.orders.unshift(action.payload);
      }
      saveOrdersToStorage(state.orders);
    },
    updateOrder: (state, action: PayloadAction<Order>) => {
      const index = state.orders.findIndex((o) => o.id === action.payload.id);
      if (index !== -1) {
        state.orders[index] = { ...action.payload, updatedAt: new Date().toISOString() };
      } else {
        state.orders.unshift(action.payload);
      }
      saveOrdersToStorage(state.orders);
    },
    removeOrder: (state, action: PayloadAction<string>) => {
      state.orders = state.orders.filter((o) => o.id !== action.payload);
      saveOrdersToStorage(state.orders);
    },
    updatePaymentStatus: (
      state,
      action: PayloadAction<{ id: string; paymentStatus: 'PAID' | 'UNPAID'; paymentMethod?: string; totalPaid?: number; change?: number }>
    ) => {
      const order = state.orders.find((o) => o.id === action.payload.id);
      if (order) {
        order.paymentStatus = action.payload.paymentStatus;
        if (action.payload.paymentMethod) order.paymentMethod = action.payload.paymentMethod;
        if (action.payload.totalPaid !== undefined) order.totalPaid = action.payload.totalPaid;
        if (action.payload.change !== undefined) order.change = action.payload.change;
        if (action.payload.paymentStatus === 'PAID') order.status = 'paid';
        order.updatedAt = new Date().toISOString();
      }
      saveOrdersToStorage(state.orders);
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const {
  setOrders,
  setCurrentOrder,
  addOrder,
  updateOrder,
  removeOrder,
  updatePaymentStatus,
  clearError,
} = orderSlice.actions;

export default orderSlice.reducer;
