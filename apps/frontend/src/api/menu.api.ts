import { api } from '../lib/api';
import { MenuItem } from '../store/slices/menuSlice';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

export const menuApi = {
  // Fetch full restaurant menu from DB
  getMenu: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<MenuItem[]> => {
    try {
      const categories: any = await api.get(`/menu/restaurant/${restaurantId}`);
      if (Array.isArray(categories)) {
        const flatItems: MenuItem[] = [];
        for (const cat of categories) {
          if (Array.isArray(cat.menuItems)) {
            for (const item of cat.menuItems) {
              flatItems.push({
                id: item.id,
                name: item.name,
                category: cat.name || 'General',
                price: Number(item.price),
                cost: Number(item.cost || 0),
                preparationTime: item.preparationTime || 10,
                isAvailable: item.isAvailable !== false,
                is86d: Boolean(item.is86d),
                description: item.description || '',
                imageUrl: item.imageUrl,
              });
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
      });
    } catch (e) {
      console.warn('Failed to save menu item to backend DB:', e);
      return null;
    }
  },

  // Update menu item in DB
  updateMenuItem: async (id: string, data: Partial<MenuItem>): Promise<any> => {
    try {
      return await api.patch(`/menu/items/${id}`, data);
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
