import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  minimumStock: number;
  category: string;
  lastUpdated: string;
}

interface InventoryState {
  items: InventoryItem[];
  lowStockItems: InventoryItem[];
  loading: boolean;
  error: string | null;
}

const initialState: InventoryState = {
  items: [],
  lowStockItems: [],
  loading: false,
  error: null,
};

const inventorySlice = createSlice({
  name: 'inventory',
  initialState,
  reducers: {
    setInventoryItems: (state, action: PayloadAction<InventoryItem[]>) => {
      state.items = action.payload;
      state.lowStockItems = action.payload.filter(
        (item) => item.quantity <= item.minimumStock
      );
    },
    addInventoryItem: (state, action: PayloadAction<InventoryItem>) => {
      state.items.push(action.payload);
      if (action.payload.quantity <= action.payload.minimumStock) {
        state.lowStockItems.push(action.payload);
      }
    },
    updateInventoryItem: (state, action: PayloadAction<InventoryItem>) => {
      const index = state.items.findIndex((item) => item.id === action.payload.id);
      if (index !== -1) {
        state.items[index] = action.payload;
        state.lowStockItems = state.items.filter(
          (item) => item.quantity <= item.minimumStock
        );
      }
    },
    removeInventoryItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((item) => item.id !== action.payload);
      state.lowStockItems = state.lowStockItems.filter((item) => item.id !== action.payload);
    },
    adjustQuantity: (
      state,
      action: PayloadAction<{ id: string; adjustment: number }>
    ) => {
      const item = state.items.find((item) => item.id === action.payload.id);
      if (item) {
        item.quantity += action.payload.adjustment;
        item.lastUpdated = new Date().toISOString();
        state.lowStockItems = state.items.filter(
          (item) => item.quantity <= item.minimumStock
        );
      }
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const {
  setInventoryItems,
  addInventoryItem,
  updateInventoryItem,
  removeInventoryItem,
  adjustQuantity,
  clearError,
} = inventorySlice.actions;

export default inventorySlice.reducer;
