export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
  DIRTY = 'DIRTY',
  CLEANING = 'CLEANING',
}

export enum TableShape {
  SQUARE = 'SQUARE',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  BOOTH = 'BOOTH',
}

export interface Table {
  id: string;
  number: string;
  floorPlanId: string;
  capacity: number;
  minCapacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: TableShape;
  section: string | null;
  status: TableStatus;
  currentOrder: string | null;
  createdAt: string;
  updatedAt: string;
  orders?: Order[];
}

export interface Order {
  id: string;
  orderNumber: number;
  tableId: string | null;
  restaurantId: string;
  serverId: string;
  customerCount: number;
  status: OrderStatus;
  type: OrderType;
  subtotal: number;
  tax: number;
  total: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items?: OrderItem[];
  server?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export enum OrderStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  VOID = 'VOID',
}

export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEOUT = 'TAKEOUT',
  DELIVERY = 'DELIVERY',
  CATERING = 'CATERING',
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  seatNumber: number | null;
  status: OrderItemStatus;
  course: CourseType;
  specialInstructions: string | null;
  sentToKitchenAt: string | null;
  completedAt: string | null;
  createdAt: string;
  menuItem?: MenuItem;
  modifiers?: OrderItemModifier[];
}

export enum OrderItemStatus {
  PENDING = 'PENDING',
  SENT_TO_KITCHEN = 'SENT_TO_KITCHEN',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  CANCELLED = 'CANCELLED',
}

export enum CourseType {
  APPETIZER = 'APPETIZER',
  SALAD = 'SALAD',
  SOUP = 'SOUP',
  ENTREE = 'ENTREE',
  SIDE = 'SIDE',
  DESSERT = 'DESSERT',
  BEVERAGE = 'BEVERAGE',
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  price: number;
  cost: number | null;
  imageUrl: string | null;
  isAvailable: boolean;
  is86d: boolean;
  preparationTime: number | null;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemModifier {
  id: string;
  orderItemId: string;
  modifierId: string;
  quantity: number;
  price: number;
}

export interface FloorPlan {
  id: string;
  name: string;
  restaurantId: string;
  layout: FloorPlanLayout;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  tables?: Table[];
}

export interface FloorPlanLayout {
  width: number;
  height: number;
  backgroundImage?: string;
  sections: FloorPlanSection[];
}

export interface FloorPlanSection {
  id: string;
  name: string;
  color: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CreateTableDto {
  number: string;
  floorPlanId: string;
  capacity: number;
  minCapacity?: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  shape?: TableShape;
  section?: string;
}

export interface UpdateTableDto {
  number?: string;
  capacity?: number;
  minCapacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  shape?: TableShape;
  section?: string;
}

export interface UpdateTableStatusDto {
  status: TableStatus;
  currentOrder?: string | null;
}