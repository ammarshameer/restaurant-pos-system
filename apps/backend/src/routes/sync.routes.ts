import { Router } from 'express';
import { syncService, SyncOperation } from '../services/sync.service';
import { getAuthenticatedRestaurantId } from '../middleware/auth';

const router = Router();

/**
 * POST /api/sync/push
 *
 * Receives a batch of offline operations queued by the POS client and applies
 * them idempotently. Returns one result per operation, in the same order.
 * The client uses the results to reconcile server ids / order numbers and to
 * decide whether to retry or discard each queued operation.
 */
router.post('/push', async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const operations: SyncOperation[] = Array.isArray(req.body?.operations)
      ? req.body.operations
      : [];

    if (operations.length === 0) {
      return res.json({ results: [], serverTime: new Date().toISOString() });
    }

    // Guard against oversized batches from a very long offline period.
    const batch = operations.slice(0, 200);
    const results = await syncService.push(batch, restaurantId);

    res.json({
      results,
      processed: results.length,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
