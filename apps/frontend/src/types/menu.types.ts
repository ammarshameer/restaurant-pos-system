export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  categoryId: string;
  image?: string;
  preparationTime?: number;
  calories?: number;
  allergens?: string[];
  isAvailable: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
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