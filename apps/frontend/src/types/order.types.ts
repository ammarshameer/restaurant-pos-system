export enum OrderStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum OrderItemStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  CANCELLED = 'CANCELLED',
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItem: {
    id: string;
    name: string;
    price: number;
    description?: string;
    image?: string;
  };
  quantity: number;
  notes?: string;
  modifiers?: any;
  status: OrderItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  tableId: string;
  table: {
    id: string;
    number: string;
  };
  customerId?: string;
  status: OrderStatus;
  items: OrderItem[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderDto {
  tableId: string;
  customerId?: string;
  items: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    modifiers?: any;
  }[];
  notes?: string;
}

export interface AddOrderItemsDto {
  items: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    modifiers?: any;
  }[];
}