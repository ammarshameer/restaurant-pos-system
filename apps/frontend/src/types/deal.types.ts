import { MenuItem } from '../store/slices/menuSlice';

export interface DealItem {
  id?: string;
  dealId?: string;
  menuItemId: string;
  quantity: number;
  menuItem?: MenuItem | {
    id: string;
    name: string;
    price: number;
    cost?: number;
    imageUrl?: string;
    category?: string | { name: string };
  };
}

export interface Deal {
  id: string;
  name: string;
  description?: string;
  price: number;
  isActive: boolean;
  imageUrl?: string;
  restaurantId?: string;
  items?: DealItem[];
  dealItems?: DealItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DealFormData {
  name: string;
  description: string;
  price: number | string;
  isActive: boolean;
  imageUrl: string;
  items: Array<{
    menuItemId: string;
    quantity: number | string;
  }>;
}
