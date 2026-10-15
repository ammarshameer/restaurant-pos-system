import { api } from '../api';
import { offlineDB, OutboxOperation, SyncOperationType, CachedOrder, LocalSyncStatus } from './db';
import { network, isNetworkError } from './network';
import { uuid } from './id';

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  /** Operations still waiting to be sent. */
  pending: number;
  /** Operations that failed repeatedly and need manual retry. */
  failed: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface EnqueueInput {
  type: SyncOperationType;
  restaurantId: string;
  entityId: string;
  clientId?: string;
  payload: any;
}

export interface ServerOrderEvent {
  localId: string;
  serverOrder: any;
}

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 20_000;

const LAST_SYNCED_KEY = 'sync:lastSyncedAt';

/**
 * Offline-first synchronization engine.
 *
 * Mutations that fail because the device is offline are written to an
 * IndexedDB outbox and replayed to `POST /api/sync/push` as soon as the
 * connection returns. Every operation is idempotent server-side, so replaying
 * a partially-delivered batch never creates duplicates.
 */
class SyncEngine {
  private status: SyncStatus = {
    online: network.isOnline(),
    syncing: false,
    pending: 0,
    failed: 0,
    lastSyncedAt: null,
    lastError: null,
  };

  private listeners = new Set<(status: SyncStatus) => void>();
  private orderListeners = new Set<(event: ServerOrderEvent) => void>();
  private started = false;
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      const meta = await offlineDB.kv.get(LAST_SYNCED_KEY);
      if (meta?.value) this.status.lastSyncedAt = Number(meta.value) || null;
      await this.refreshCounts();
    } catch (e) {
      console.warn('[sync] failed to read local sync state:', e);
    }

    network.subscribe((online) => {
      this.patch({ online });
      if (online) this.scheduleFlush(0);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.scheduleFlush(0));
      window.addEventListener('focus', () => this.scheduleFlush(0));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.scheduleFlush(0);
      });
    }

    this.retryTimer = setInterval(() => {
      if (network.isOnline() && this.status.pending > 0) this.flush();
    }, FLUSH_INTERVAL_MS);

    if (this.status.pending > 0 && network.isOnline()) this.scheduleFlush(500);
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onServerOrder(listener: (event: ServerOrderEvent) => void): () => void {
    this.orderListeners.add(listener);
    return () => {
      this.orderListeners.delete(listener);
    };
  }

  /**
   * Let subscribers (App) refresh their in-memory state with the
   * server-authoritative version of an order. Used for direct online writes
   * as well as queued operations replayed during a flush.
   */
  notifyServerOrder(localId: string, serverOrder: any): void {
    this.orderListeners.forEach((listener) => listener({ localId, serverOrder }));
  }

  // ---------------------------------------------------------------- queueing

  async enqueue(input: EnqueueInput): Promise<OutboxOperation> {
    const now = Date.now();
    const op: OutboxOperation = {
      opId: uuid(),
      type: input.type,
      restaurantId: input.restaurantId,
      entityId: input.entityId,
      clientId: input.clientId,
      payload: input.payload,
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    op.seq = (await offlineDB.outbox.add(op)) as number;
    await this.refreshCounts();

    if (network.isOnline()) this.scheduleFlush(0);
    return op;
  }

  /** Re-queue operations that previously gave up after repeated failures. */
  async retryFailed(): Promise<void> {
    const failed = await offlineDB.outbox.where('status').equals('FAILED').toArray();
    await Promise.all(
      failed.map((op) =>
        offlineDB.outbox.update(op.seq!, { status: 'PENDING', attempts: 0, lastError: undefined, updatedAt: Date.now() })
      )
    );
    await this.refreshCounts();
    await this.flush();
  }

  /** Manually trigger a sync (used by the "Sync now" button). */
  async syncNow(): Promise<void> {
    if (this.status.failed > 0) {
      await this.retryFailed();
      return;
    }
    await this.flush();
  }

  // --------------------------------------------------------------- flushing

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (!network.isOnline()) {
      this.patch({ online: false });
      return;
    }

    // Never push without an auth token — otherwise every queued request 401s.
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) return;

    const ops = await offlineDB.outbox.where('status').equals('PENDING').sortBy('seq');
    await this.refreshCounts();
    if (ops.length === 0) return;

    this.flushing = true;
    this.patch({ syncing: true, lastError: null });

    try {
      for (let i = 0; i < ops.length; i += BATCH_SIZE) {
        await this.pushBatch(ops.slice(i, i + BATCH_SIZE));
      }

      const now = Date.now();
      await offlineDB.kv.put({ key: LAST_SYNCED_KEY, value: now, updatedAt: now });
      this.patch({ lastSyncedAt: now, lastError: null });
    } catch (error: any) {
      if (isNetworkError(error)) {
        network.set(false);
        this.patch({ online: false, lastError: error?.message || 'Network unreachable' });
      } else {
        this.patch({ lastError: error?.message || 'Sync failed' });
      }
    } finally {
      this.flushing = false;
      await this.refreshCounts();
      this.patch({ syncing: false });
    }
  }

  private async pushBatch(batch: OutboxOperation[]): Promise<void> {
    const operations = batch.map((op) => ({
      opId: op.opId,
      type: op.type,
      entityId: op.entityId,
      clientId: op.clientId,
      payload: op.payload,
      createdAt: new Date(op.createdAt).toISOString(),
    }));

    const response: any = await api.post('/sync/push', { operations });
    const results: any[] = Array.isArray(response?.results) ? response.results : [];

    for (const op of batch) {
      const result = results.find((r) => r.opId === op.opId);

      if (!result) {
        // Server did not acknowledge this op; keep it queued for the next flush.
        continue;
      }

      if (result.status === 'ok') {
        await offlineDB.outbox.where('opId').equals(op.opId).delete();
        if (result.order) {
          await this.reconcileOrder(op, result.order);
        }
      } else {
        const attempts = op.attempts + 1;
        await offlineDB.outbox.update(op.seq!, {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          lastError: result.error || 'Sync operation rejected',
          updatedAt: Date.now(),
        });
      }
    }
  }

  // ------------------------------------------------------------ local cache

  private async reconcileOrder(op: OutboxOperation, serverOrder: any): Promise<void> {
    const localId = op.entityId;
    const remaining = await offlineDB.outbox.where('entityId').equals(localId).count();

    const existing = await offlineDB.orders.get(localId);
    await offlineDB.orders.put({
      id: localId,
      serverId: serverOrder.id,
      orderNumber: serverOrder.orderNumber,
      restaurantId: op.restaurantId,
      order: serverOrder,
      pending: remaining > 0 ? 1 : 0,
      syncStatus: remaining > 0 ? 'PENDING' : 'SYNCED',
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    this.orderListeners.forEach((listener) => listener({ localId, serverOrder }));
  }

  /** Upsert an order snapshot into the local cache. */
  async saveLocalOrder(
    order: any,
    restaurantId: string,
    options?: { pending?: boolean; syncStatus?: LocalSyncStatus }
  ): Promise<void> {
    if (!order?.id) return;
    const existing = await offlineDB.orders.get(order.id);

    // Never let a stale server snapshot overwrite an order that still has
    // queued offline operations.
    if (existing?.pending === 1 && options?.pending !== true) return;

    const pending = options?.pending ?? (existing?.pending === 1);
    const syncStatus: LocalSyncStatus =
      options?.syncStatus ?? (pending ? 'PENDING' : existing?.syncStatus ?? 'SYNCED');

    await offlineDB.orders.put({
      id: order.id,
      serverId: order.serverId || existing?.serverId,
      orderNumber: order.orderNumber,
      restaurantId,
      order,
      pending: pending ? 1 : 0,
      syncStatus,
      createdAt: existing?.createdAt ?? (Date.parse(order.createdAt) || Date.now()),
      updatedAt: Date.now(),
    });
  }

  /** Merge a partial change into a cached order and mark it pending sync. */
  async patchLocalOrder(id: string, patch: Record<string, any>): Promise<void> {
    try {
      const existing = await offlineDB.orders.get(id);
      if (!existing) return;
      await offlineDB.orders.put({
        ...existing,
        order: { ...existing.order, ...patch, syncStatus: 'PENDING', pending: true },
        pending: 1,
        syncStatus: 'PENDING',
        updatedAt: Date.now(),
      });
    } catch (e) {
      // Best-effort cache update.
    }
  }

  async removeLocalOrder(id: string): Promise<void> {
    try {
      await offlineDB.orders.delete(id);
    } catch (e) {
      console.warn('[sync] failed to remove cached order:', e);
    }
  }

  /** Return cached order snapshots for a restaurant, newest first. */
  async listCachedOrders(restaurantId: string): Promise<any[]> {
    const rows = await offlineDB.orders.where('restaurantId').equals(restaurantId).toArray();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({ ...row.order, __syncStatus: row.syncStatus, __pending: row.pending === 1 }));
  }

  // -------------------------------------------------------------- internals

  private scheduleFlush(delayMs: number): void {
    if (delayMs <= 0) {
      void this.flush();
      return;
    }
    setTimeout(() => void this.flush(), delayMs);
  }

  private async refreshCounts(): Promise<void> {
    try {
      const [pending, failed] = await Promise.all([
        offlineDB.outbox.where('status').equals('PENDING').count(),
        offlineDB.outbox.where('status').equals('FAILED').count(),
      ]);
      this.patch({ pending, failed });
    } catch (e) {
      // Ignore — counts will refresh next cycle.
    }
  }

  private patch(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    const snapshot = this.getStatus();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const syncEngine = new SyncEngine();
