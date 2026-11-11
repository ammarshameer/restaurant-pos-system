import { Router, Response, NextFunction } from 'express';
import { CustomerCreditService } from '../services/customer-credit.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const creditService = new CustomerCreditService();

// GET /api/dues - customers with balanceDue > 0, search, pagination, totalOutstanding
router.get('/', requirePermission('dues.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const result = await creditService.listDues(restaurantId, { search, page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/dues/:customerId - customer details + ledger + unpaid orders
router.get('/:customerId', requirePermission('dues.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const statement = await creditService.getStatement(restaurantId, req.params.customerId);
    res.json(statement);
  } catch (error) {
    next(error);
  }
});

// POST /api/dues/:customerId/payments - receive dues payment
router.post('/:customerId/payments', requirePermission('dues.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { amount, method, note, clientId, idempotencyKey } = req.body;
    const result = await creditService.receivePayment(
      restaurantId,
      req.params.customerId,
      Number(amount),
      method || 'CASH',
      note,
      req.user?.id,
      clientId || idempotencyKey
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to receive dues payment' });
  }
});

// POST /api/dues/:customerId/adjustments - manual adjustment
router.post('/:customerId/adjustments', requirePermission('dues.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { amount, note } = req.body;
    const result = await creditService.adjust(
      restaurantId,
      req.params.customerId,
      Number(amount),
      note,
      req.user?.id
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to adjust customer balance' });
  }
});

// GET /api/dues/:customerId/statement - statement between dates
router.get('/:customerId/statement', requirePermission('dues.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const statement = await creditService.getStatement(restaurantId, req.params.customerId, startDate, endDate);
    res.json(statement);
  } catch (error) {
    next(error);
  }
});

export default router;

