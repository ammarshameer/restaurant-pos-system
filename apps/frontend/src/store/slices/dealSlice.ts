import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Deal } from '../../types/deal.types';

const STORAGE_KEY = 'restaurant_pos_deals';

const loadSavedDeals = (): Deal[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load deals from localStorage:', e);
  }
  return [];
};

const saveDealsToStorage = (deals: Deal[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
  } catch (e) {
    console.error('Failed to save deals to localStorage:', e);
  }
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
