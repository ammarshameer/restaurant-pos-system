import { api } from '../lib/api';
import { MenuItem } from '../store/slices/menuSlice';
import { PaginatedResponse } from '../types/pagination';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

function mapMenuItem(item: any): MenuItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category?.name || item.category || 'General',
    price: Number(item.price),
    cost: Number(item.cost || 0),
    preparationTime: item.preparationTime || 10,
    isAvailable: item.isAvailable !== false,
    is86d: Boolean(item.is86d),
    description: item.description || '',
    imageUrl: item.imageUrl,
    ingredients: Array.isArray(item.ingredients)
      ? item.ingredients.map((ing: any) => ({
          id: ing.id,
          inventoryItemId: ing.inventoryItemId,
          quantityUsed: Number(ing.quantityUsed),
          inventoryItem: ing.inventoryItem
            ? {
                id: ing.inventoryItem.id,
                name: ing.inventoryItem.name,
                unit: ing.inventoryItem.unit,
                quantity: Number(ing.inventoryItem.quantity || 0),
                costPerUnit: Number(ing.inventoryItem.costPerUnit || 0),
              }
            : undefined,
        }))
      : [],
  };
}

export const menuApi = {
  // Paginated menu items fetch (50 records per page by default)
  getMenuItemsPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    categoryId?: string;
    restaurantId?: string;
  }): Promise<PaginatedResponse<MenuItem>> => {
    try {
      const restaurantId = params?.restaurantId || DEFAULT_RESTAURANT_ID;
      const res: any = await api.get(`/menu/restaurant/${restaurantId}/items`, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        category: params?.category || undefined,
        categoryId: params?.categoryId || undefined,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map(mapMenuItem),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map(mapMenuItem),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch paginated menu items:', e);
    }

    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  // Fetch full restaurant menu from DB
  getMenu: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<MenuItem[]> => {
    try {
      const categories: any = await api.get(`/menu/restaurant/${restaurantId}`);
      if (Array.isArray(categories)) {
        const flatItems: MenuItem[] = [];
        for (const cat of categories) {
          if (Array.isArray(cat.menuItems)) {
            for (const item of cat.menuItems) {
              flatItems.push(mapMenuItem({ ...item, category: cat.name || 'General' }));
            }
          }
        }
        return flatItems;
      }
    } catch (e) {
      console.warn('Backend menu fetch fallback to local store:', e);
    }
    return [];
  },

  // Create menu item in DB
  createMenuItem: async (item: Partial<MenuItem>, restaurantId = DEFAULT_RESTAURANT_ID): Promise<any> => {
    try {
      // First ensure category exists or fetch categories
      const categories: any = await api.get(`/menu/restaurant/${restaurantId}`);
      let catId = '';
      if (Array.isArray(categories)) {
        const existingCat = categories.find((c) => c.name.toLowerCase() === (item.category || '').toLowerCase());
        if (existingCat) {
          catId = existingCat.id;
        } else {
          const newCat: any = await api.post('/menu/categories', {
            name: item.category || 'General',
            restaurantId,
          });
          catId = newCat.id;
        }
      }

      return await api.post('/menu/items', {
        id: item.id,
        name: item.name,
        description: item.description,
        price: Number(item.price),
        cost: Number(item.cost || 0),
        preparationTime: Number(item.preparationTime || 10),
        categoryId: catId || 'default-cat',
        categoryName: item.category,
        restaurantId,
        imageUrl: item.imageUrl || undefined,
        isAvailable: item.isAvailable !== false,
        is86d: Boolean(item.is86d),
        ingredients: item.ingredients?.map((ing) => ({
          inventoryItemId: ing.inventoryItemId,
          quantityUsed: Number(ing.quantityUsed),
        })),
      });
    } catch (e) {
      console.warn('Failed to save menu item to backend DB:', e);
      return null;
    }
  },

  // Update menu item in DB
  updateMenuItem: async (id: string, data: Partial<MenuItem>): Promise<any> => {
    try {
      const payload: any = { ...data };
      if (data.ingredients !== undefined) {
        payload.ingredients = data.ingredients.map((ing) => ({
          inventoryItemId: ing.inventoryItemId,
          quantityUsed: Number(ing.quantityUsed),
        }));
      }
      return await api.patch(`/menu/items/${id}`, payload);
    } catch (e) {
      console.warn('Failed to update menu item in backend DB:', e);
      return null;
    }
  },

  // Delete menu item from DB
  deleteMenuItem: async (id: string): Promise<any> => {
    try {
      return await api.delete(`/menu/items/${id}`);
    } catch (e) {
      console.warn('Failed to delete menu item from backend DB:', e);
      return null;
    }
  },
};
