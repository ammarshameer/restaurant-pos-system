export interface MenuItemIngredient {
  id?: string;
  menuItemId?: string;
  inventoryItemId: string;
  quantityUsed: number;
  inventoryItem?: {
    id: string;
    name: string;
    unit: string;
    quantity?: number;
    costPerUnit?: number;
  };
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  cost?: number;
  categoryId: string;
  image?: string;
  imageUrl?: string;
  preparationTime?: number;
  calories?: number;
  allergens?: string[];
  isAvailable: boolean;
  is86d?: boolean;
  sortOrder?: number;
  ingredients?: MenuItemIngredient[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MenuCategory {
  id: string;
  name: string;
  description?: string;
  restaurantId: string;
  sortOrder: number;
  items: MenuItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMenuItemDto {
  name: string;
  description?: string;
  price: number;
  categoryId: string;
  image?: string;
  preparationTime?: number;
  calories?: number;
  allergens?: string[];
  isAvailable?: boolean;
}

export interface CreateMenuCategoryDto {
  name: string;
  description?: string;
  restaurantId: string;
  sortOrder?: number;
}