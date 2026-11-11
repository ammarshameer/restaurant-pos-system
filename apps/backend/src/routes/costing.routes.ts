import { Router, Response, NextFunction } from 'express';
import { CostingService } from '../services/costing.service';
import { ProfitService } from '../services/profit.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requireFeature,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const costingService = new CostingService();
const profitService = new ProfitService();

// Entire router is guarded by costing feature
router.use(requireFeature('costing'));

router.get('/summary', requirePermission('costing.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const startDate = String(req.query.startDate || '');
    const endDate = String(req.query.endDate || '');
    const summary = await costingService.summary(restaurantId, startDate, endDate);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.get('/menu', requirePermission('costing.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const menuCosting = await costingService.getMenuCosting(restaurantId);
    res.json(menuCosting);
  } catch (error) {
    next(error);
  }
});

router.get('/inventory', requirePermission('costing.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const inventoryValuation = await costingService.getInventoryValuation(restaurantId);
    res.json(inventoryValuation);
  } catch (error) {
    next(error);
  }
});

router.get('/transactions', requirePermission('costing.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const startDate = String(req.query.startDate || '');
    const endDate = String(req.query.endDate || '');
    const transactions = await costingService.getCostingTransactions(restaurantId, {
      page,
      limit,
      startDate,
      endDate,
    });
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

router.get('/profit-loss', requirePermission('profit.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    const report = await profitService.getMonthlyProfitAndLoss(restaurantId, month);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

export default router;

