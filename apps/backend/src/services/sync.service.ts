import { OrderService } from './order.service';

const orderService = new OrderService();

export type SyncOperationType =
  | 'CREATE_ORDER'
  | 'UPDATE_ORDER'
  | 'UPDATE_PAYMENT_STATUS'
  | 'CANCEL_ORDER'
  | 'DELETE_ORDER';

export interface SyncOperation {
  /** Stable, client-generated operation id (idempotency + result correlation). */
  opId: string;
  type: SyncOperationType;
  /** Local (client) order id this operation targets. */
  entityId?: string;
  /** Client idempotency key for order creation. */
  clientId?: string;
  payload: any;
  createdAt?: string;
}

export interface SyncResult {
  opId: string;
  type: SyncOperationType;
  entityId?: string;
  status: 'ok' | 'error';
  /** Server-assigned order id (when known). */
  serverId?: string;
  /** Server-authoritative order number (when known). */
  orderNumber?: number;
  error?: string;
  /** Full server order record for CREATE/UPDATE operations, so the client can reconcile. */
  order?: any;
  /** True when the operation was already applied (idempotent replay). */
  duplicate?: boolean;
}

/**
 * Applies a batch of queued offline operations against the server in order.
 * Every operation is designed to be idempotent so the client can safely
 * retry an entire batch after a dropped connection without creating
 * duplicate orders, payments, or inventory movements.
 */
export class SyncService {
  async push(operations: SyncOperation[], restaurantId: string) {
    const results: SyncResult[] = [];

    for (const op of operations) {
      try {
        results.push(await this.applyOperation(op, restaurantId));
      } catch (error: any) {
        results.push({
          opId: op.opId,
          type: op.type,
          entityId: op.entityId,
          status: 'error',
          error: error?.message || 'Sync operation failed',
        });
      }
    }

    return results;
  }

  private async applyOperation(op: SyncOperation, restaurantId: string): Promise<SyncResult> {
    const payload = op.payload || {};

    switch (op.type) {
      case 'CREATE_ORDER': {
        const order = await orderService.createOrder({
          ...payload,
          restaurantId,
          clientId: op.clientId || payload.clientId || op.entityId || undefined,
        });
        return {
          opId: op.opId,
          type: op.type,
          entityId: op.entityId,
          status: 'ok',
          serverId: order.id,
          orderNumber: order.orderNumber,
          order,
        };
      }

      case 'UPDATE_ORDER': {
        const id = payload.id || op.entityId;
        if (!id) throw new Error('update order requires an order id');
        const order = await orderService.updateOrder(id, payload.data || {}, restaurantId);
        return {
          opId: op.opId,
          type: op.type,
          entityId: op.entityId,
          status: 'ok',
          serverId: order.id,
          orderNumber: order.orderNumber,
          order,
        };
      }

      case 'UPDATE_PAYMENT_STATUS': {
        const id = payload.id || op.entityId;
        if (!id) throw new Error('update payment status requires an order id');
        const isPaid = String(payload.paymentStatus || '').toUpperCase() === 'PAID';
        const order = await orderService.updateOrder(
          id,
          {
            paymentStatus: isPaid ? 'PAID' : 'UNPAID',
            paymentMethod: payload.paymentMethod || 'CASH',
            totalPaid: payload.totalPaid,
            change: payload.change,
            ...(isPaid ? { status: 'paid' } : {}),
          },
          restaurantId
        );
        return {
          opId: op.opId,
          type: op.type,
          entityId: op.entityId,
          status: 'ok',
          serverId: order.id,
          orderNumber: order.orderNumber,
          order,
        };
      }

      case 'CANCEL_ORDER': {
        const id = payload.id || op.entityId;
        if (!id) throw new Error('cancel order requires an order id');
        const order = await orderService.cancelOrder(id, payload.reason, restaurantId);
        return {
          opId: op.opId,
          type: op.type,
          entityId: op.entityId,
          status: 'ok',
          serverId: order.id,
          orderNumber: order.orderNumber,
          order,
        };
      }

      case 'DELETE_ORDER': {
        const id = payload.id || op.entityId;
        if (!id) throw new Error('delete order requires an order id');
        try {
          await orderService.deleteOrder(id, restaurantId);
        } catch (error: any) {
          // Deleting an already-deleted order is a successful no-op (idempotent replay).
          if (!/not found|unauthorized/i.test(error?.message || '')) {
            throw error;
          }
        }
        return {
          opId: op.opId,
          type: op.type,
          entityId: op.entityId,
          status: 'ok',
          duplicate: true,
        };
      }

      default:
        throw new Error(`Unknown sync operation type: ${(op as any).type}`);
    }
  }
}

export const syncService = new SyncService();
