import Dexie, { Table } from 'dexie';

/**
 * Operation types that can be queued while the POS is offline and replayed to
 * the server once connectivity is restored.
 */
export type SyncOperationType =
  | 'CREATE_ORDER'
  | 'UPDATE_ORDER'
  | 'UPDATE_PAYMENT_STATUS'
  | 'CANCEL_ORDER'
  | 'DELETE_ORDER';

export type OutboxStatus = 'PENDING' | 'FAILED';

/** A single queued mutation waiting to be pushed to the server. */
export interface OutboxOperation {
  /** Auto-incrementing sequence used to preserve ordering. */
  seq?: number;
  /** Stable idempotency / correlation id. */
  opId: string;
  type: SyncOperationType;
  restaurantId: string;
  /** Local order id this operation targets. */
  entityId: string;
  /** Idempotency key sent to the server for order creation. */
  clientId?: string;
  payload: any;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export type LocalSyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';

/**
 * A locally cached/created order. Offline orders live here until they are
 * synced, and online orders are mirrored here so the UI keeps working when
 * the connection drops.
 */
export interface CachedOrder {
  /** Local (client) order id — also sent to the server as the order id. */
  id: string;
  serverId?: string;
  orderNumber: number | string;
  restaurantId: string;
  /** Full order snapshot used to render the UI offline. */
  order: any;
  pending: number; // 1 = has queued operations, 0 = fully synced
  syncStatus: LocalSyncStatus;
  createdAt: number;
  updatedAt: number;
}

export interface KVEntry {
  key: string;
  value: any;
  updatedAt: number;
}

/**
 * Local offline database. Backed by IndexedDB (Dexie) so it works identically
 * in the browser and inside Electron.
 */
export class PosOfflineDB extends Dexie {
  outbox!: Table<OutboxOperation, number>;
  orders!: Table<CachedOrder, string>;
  kv!: Table<KVEntry, string>;

  constructor() {
    super('restaurant-pos-offline');

    this.version(1).stores({
      outbox: '++seq, opId, type, entityId, status, createdAt',
      orders: 'id, restaurantId, syncStatus, pending, createdAt',
      kv: 'key',
    });
  }
}

export const offlineDB = new PosOfflineDB();
