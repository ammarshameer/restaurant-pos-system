import { Router } from 'express';
import { AccountingService } from '../services/accounting.service';
import { AuthRequest, getAuthenticatedRestaurantId, requireFeature, requirePermission } from '../middleware/auth';

const router = Router();
const accounting = new AccountingService();

router.use(requireFeature('accounting'));

router.get('/summary', requirePermission('accounting.view'), async (req: AuthRequest, res, next) => {
  try {
    res.json(await accounting.summary(getAuthenticatedRestaurantId(req), String(req.query.startDate || ''), String(req.query.endDate || '')));
  } catch (error) { next(error); }
});

router.get('/transactions', requirePermission('accounting.view'), async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Number(req.query.limit) || 20);
    res.json(await accounting.transactions(
      getAuthenticatedRestaurantId(req), page, limit,
      String(req.query.startDate || ''), String(req.query.endDate || ''), String(req.query.type || 'ALL')
    ));
  } catch (error) { next(error); }
});

router.get('/export', requirePermission('accounting.manage'), async (req: AuthRequest, res) => {
  const summary = await accounting.summary(getAuthenticatedRestaurantId(req), String(req.query.startDate || ''), String(req.query.endDate || ''));
  res.setHeader('Content-Type', 'text/csv');
  res.send(Object.entries(summary).map(([key, value]) => `${key},${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n'));
});

export default router;
