import { Router } from 'express';
import { PaymentService } from '../services/payment.service';
import { authorize } from '../middleware/auth';

const router = Router();
const paymentService = new PaymentService();

// Create payment
router.post('/', async (req, res, next) => {
  try {
    const payment = await paymentService.createPayment(req.body);
    res.status(201).json(payment);
  } catch (error) {
    next(error);
  }
});

// Confirm payment
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const payment = await paymentService.confirmPayment(req.params.id);
    res.json(payment);
  } catch (error) {
    next(error);
  }
});

// Get structured receipt data by payment ID or order ID
router.get('/:id/receipt', async (req, res, next) => {
  try {
    const receipt = await paymentService.getReceiptData(req.params.id);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

// Get structured receipt data by order ID
router.get('/order/:orderId/receipt', async (req, res, next) => {
  try {
    const receipt = await paymentService.getReceiptData(req.params.orderId);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

// Process refund
router.post('/:id/refund', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const { amount } = req.body;
    const refund = await paymentService.processRefund(req.params.id, amount);
    res.json(refund);
  } catch (error) {
    next(error);
  }
});

// Split bill
router.post('/split', async (req, res, next) => {
  try {
    const { orderId, splits } = req.body;
    const payments = await paymentService.splitBill(orderId, splits);
    res.json(payments);
  } catch (error) {
    next(error);
  }
});

// Get all payments for restaurant with pagination
router.get('/', async (req, res, next) => {
  try {
    const restaurantId = (req.query.restaurantId as string) || 'rest-default-1';
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

router.get('/restaurant/:restaurantId', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const method = req.query.method as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await paymentService.getPaymentsByRestaurant(req.params.restaurantId, {
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
router.get('/order/:orderId', async (req, res, next) => {
  try {
    const payments = await paymentService.getPaymentsByOrder(req.params.orderId);
    res.json(payments);
  } catch (error) {
    next(error);
  }
});

export default router;

