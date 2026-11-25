import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Deal } from '../../types/deal.types';
import { getTenantItem, setTenantItem } from '../../lib/tenantStorage';

const STORAGE_KEY = 'restaurant_pos_deals';

const loadSavedDeals = (): Deal[] => {
  const saved = getTenantItem<Deal[]>(STORAGE_KEY, []);
  return Array.isArray(saved) ? saved : [];
};

const saveDealsToStorage = (deals: Deal[]) => {
  setTenantItem(STORAGE_KEY, deals);
};

interface DealState {
  deals: Deal[];
  loading: boolean;
  error: string | null;
}

const initialDeals = loadSavedDeals();

const initialState: DealState = {
  deals: initialDeals,
  loading: false,
  error: null,
};

const dealSlice = createSlice({
  name: 'deal',
  initialState,
  reducers: {
    setDeals: (state, action: PayloadAction<Deal[]>) => {
      state.deals = action.payload;
      saveDealsToStorage(state.deals);
    },
    addDeal: (state, action: PayloadAction<Deal>) => {
      state.deals.unshift(action.payload);
      saveDealsToStorage(state.deals);
    },
    updateDealInState: (state, action: PayloadAction<Deal>) => {
      const index = state.deals.findIndex((d) => d.id === action.payload.id);
      if (index !== -1) {
        state.deals[index] = action.payload;
      }
      saveDealsToStorage(state.deals);
    },
    removeDeal: (state, action: PayloadAction<string>) => {
      state.deals = state.deals.filter((d) => d.id !== action.payload);
      saveDealsToStorage(state.deals);
    },
    toggleDealActiveInState: (state, action: PayloadAction<{ id: string; isActive: boolean }>) => {
      const deal = state.deals.find((d) => d.id === action.payload.id);
      if (deal) {
        deal.isActive = action.payload.isActive;
      }
      saveDealsToStorage(state.deals);
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const {
  setDeals,
  addDeal,
  updateDealInState,
  removeDeal,
  toggleDealActiveInState,
  clearError,
} = dealSlice.actions;

export default dealSlice.reducer;
