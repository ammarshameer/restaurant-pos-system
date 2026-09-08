export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING' | string;
export type TableShape = 'ROUND' | 'SQUARE' | 'RECTANGLE' | string;

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

export interface TablePositionUpdate {
  id: string;
  x: number;
  y: number;
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
