import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  cost?: number;
  preparationTime?: number;
  isAvailable: boolean;
  is86d: boolean;
  description: string;
  imageUrl?: string;
}

const STORAGE_KEY = 'restaurant_pos_menu_items';

const loadSavedMenuItems = (): MenuItem[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load menu items from localStorage:', e);
  }
  return [];
};

const saveMenuItemsToStorage = (items: MenuItem[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to save menu items to localStorage:', e);
  }
};

interface MenuState {
  items: MenuItem[];
  categories: string[];
  loading: boolean;
  error: string | null;
}

const initialItems = loadSavedMenuItems();

const initialState: MenuState = {
  items: initialItems,
  categories: ['All', ...Array.from(new Set(initialItems.map((item) => item.category)))],
  loading: false,
  error: null,
};

const menuSlice = createSlice({
  name: 'menu',
  initialState,
  reducers: {
    setMenuItems: (state, action: PayloadAction<MenuItem[]>) => {
      state.items = action.payload;
      state.categories = ['All', ...Array.from(new Set(action.payload.map((item) => item.category)))];
      saveMenuItemsToStorage(state.items);
    },
    addMenuItem: (state, action: PayloadAction<MenuItem>) => {
      state.items.unshift(action.payload);
      if (!state.categories.includes(action.payload.category)) {
        state.categories.push(action.payload.category);
      }
      saveMenuItemsToStorage(state.items);
    },
    updateMenuItem: (state, action: PayloadAction<MenuItem>) => {
      const index = state.items.findIndex((item) => item.id === action.payload.id);
      if (index !== -1) {
        state.items[index] = action.payload;
      }
      state.categories = ['All', ...Array.from(new Set(state.items.map((item) => item.category)))];
      saveMenuItemsToStorage(state.items);
    },
    removeMenuItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((item) => item.id !== action.payload);
      state.categories = ['All', ...Array.from(new Set(state.items.map((item) => item.category)))];
      saveMenuItemsToStorage(state.items);
    },
    toggle86Item: (state, action: PayloadAction<string>) => {
      const item = state.items.find((item) => item.id === action.payload);
      if (item) {
        item.is86d = !item.is86d;
        item.isAvailable = !item.is86d;
      }
      saveMenuItemsToStorage(state.items);
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const {
  setMenuItems,
  addMenuItem,
  updateMenuItem,
  removeMenuItem,
  toggle86Item,
  clearError,
} = menuSlice.actions;

export default menuSlice.reducer;
