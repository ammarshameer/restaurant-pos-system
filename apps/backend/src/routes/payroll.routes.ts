import { Router, Response, NextFunction } from 'express';
import { PayrollService } from '../services/payroll.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requireFeature,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const payrollService = new PayrollService();

// Enforce module feature guard
router.use(requireFeature('payroll'));

// Settings
router.get('/settings', requirePermission('payroll.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const settings = await payrollService.getSettings(restaurantId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const updated = await payrollService.updateSettings(restaurantId, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Advances
router.get('/advances', requirePermission('payroll.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await payrollService.getAdvances(restaurantId, {
      employeeId: req.query.employeeId as string,
      status: req.query.status as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/advances', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const advance = await payrollService.createAdvance(restaurantId, req.body, req.user?.id);
    res.status(201).json(advance);
  } catch (err) {
    next(err);
  }
});

router.post('/advances/:id/cancel', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const updated = await payrollService.cancelAdvance(restaurantId, req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Time entries & overtime approval
router.get('/time-entries', requirePermission('payroll.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await payrollService.getTimeEntries(restaurantId, {
      month: req.query.month as string,
      employeeId: req.query.employeeId as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/time-entries/:id', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const updated = await payrollService.correctTimeEntry(
      restaurantId,
      req.params.id,
      req.body,
      req.user?.id || 'system'
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/time-entries/:id/approve-overtime', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const approved = req.body.approved !== false;
    const updated = await payrollService.approveOvertime(
      restaurantId,
      req.params.id,
      approved,
      req.user?.id || 'system'
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Runs
router.get('/runs', requirePermission('payroll.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await payrollService.getRuns(restaurantId, {
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:idOrMonth', requirePermission('payroll.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const run = await payrollService.getRunDetails(restaurantId, req.params.idOrMonth);
    res.json(run);
  } catch (err) {
    next(err);
  }
});

router.post('/runs', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const month = req.body.month || new Date().toISOString().slice(0, 7);
    const run = await payrollService.createOrCalculateDraft(restaurantId, month);
    res.status(201).json(run);
  } catch (err) {
    next(err);
  }
});

router.patch('/lines/:id', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const updated = await payrollService.updateLine(restaurantId, req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/runs/:id/finalize', requirePermission('payroll.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const finalized = await payrollService.finalizeRun(restaurantId, req.params.id, req.user?.id || 'system');
    res.json(finalized);
  } catch (err) {
    next(err);
  }
});

router.post('/runs/:id/pay', requirePermission('payroll.pay'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const paymentMethod = req.body.paymentMethod || 'BANK_TRANSFER';
    const paid = await payrollService.payRun(
      restaurantId,
      req.params.id,
      paymentMethod,
      req.user?.id || 'system'
    );
    res.json(paid);
  } catch (err) {
    next(err);
  }
});

router.get('/lines/:id/payslip', requirePermission('payroll.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const payslip = await payrollService.getPayslip(restaurantId, req.params.id);
    res.json(payslip);
  } catch (err) {
    next(err);
  }
});

export default router;

