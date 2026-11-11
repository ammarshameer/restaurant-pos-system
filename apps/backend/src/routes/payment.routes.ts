import { Router, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const paymentService = new PaymentService();

// Middleware to allow receipt viewing if user has either invoices.view OR payments.view
function requireReceiptPermission(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.isOwnerRole || req.user?.role === 'OWNER') return next();
  const perms = req.user?.permissions || [];
  if (perms.includes('invoices.view') || perms.includes('payments.view')) {
    return next();
  }
  return res.status(403).json({
    error: 'Insufficient permissions: requires invoices.view or payments.view to access receipts',
    code: 'FORBIDDEN',
  });
}

// Create payment
router.post('/', requirePermission('payments.process'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const payment = await paymentService.createPayment(
      { ...req.body, createdById: req.user?.id },
      restaurantId
    );
    res.status(201).json(payment);
  } catch (error) {
    next(error);
  }
});

// Confirm payment
router.post('/:id/confirm', requirePermission('payments.process'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const payment = await paymentService.confirmPayment(req.params.id, restaurantId);
    res.json(payment);
  } catch (error) {
    next(error);
  }
});

// Get structured receipt data by payment ID or order ID
router.get('/:id/receipt', requireReceiptPermission, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const receipt = await paymentService.getReceiptData(req.params.id, restaurantId);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

// Get structured receipt data by order ID
router.get('/order/:orderId/receipt', requireReceiptPermission, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const receipt = await paymentService.getReceiptData(req.params.orderId, restaurantId);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

// Process refund
router.post('/:id/refund', requirePermission('orders.refund'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { amount } = req.body;
    const refund = await paymentService.processRefund(req.params.id, amount, restaurantId);
    res.json(refund);
  } catch (error) {
    next(error);
  }
});

// Split bill
router.post('/split', requirePermission('payments.process'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { orderId, splits } = req.body;
    const payments = await paymentService.splitBill(orderId, splits, restaurantId);
    res.json(payments);
  } catch (error) {
    next(error);
  }
});

// Get all payments for restaurant with pagination
router.get('/', requirePermission('payments.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const method = req.query.method as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await paymentService.getPaymentsByRestaurant(restaurantId, {
      page,
      limit,
      search,
      method,
      startDate,
      endDate,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/restaurant/:restaurantId', requirePermission('payments.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const method = req.query.method as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await paymentService.getPaymentsByRestaurant(restaurantId, {
      page,
      limit,
      search,
      method,
      startDate,
      endDate,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get payments for order
router.get('/order/:orderId', requirePermission('payments.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const payments = await paymentService.getPaymentsByOrder(req.params.orderId, restaurantId);
    res.json(payments);
  } catch (error) {
    next(error);
  }
});

export default router;
