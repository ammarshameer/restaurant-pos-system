import { Router, Response, NextFunction } from 'express';
import { OrderService } from '../services/order.service';
import { hasFeature } from '../services/feature.service';
import { redactCosting } from '../services/cost-redaction.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
  requireAnyPermission,
} from '../middleware/auth';

const router = Router();
const orderService = new OrderService();

router.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    const restaurantId = getAuthenticatedRestaurantId(req);
    void hasFeature(restaurantId, 'costing').then((enabled) => {
      originalJson(enabled ? body : redactCosting(body));
    }).catch(next);
    return res;
  }) as any;
  next();
});

// Create new order
router.post('/', requirePermission('orders.create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const order = await orderService.createOrder({
      ...req.body,
      restaurantId,
    });
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

// Get all orders with pagination support
router.get('/', requirePermission('orders.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const orderType = req.query.orderType as string;
    const paymentStatus = req.query.paymentStatus as string;
    const status = req.query.status as string;

    const result = await orderService.getAllOrdersByRestaurant(restaurantId, {
      page,
      limit,
      search,
      orderType,
      paymentStatus,
      status,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Scoped orders by restaurant (scoping strictly uses JWT)
router.get('/restaurant/:restaurantId', requirePermission('orders.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const orderType = req.query.orderType as string;
    const paymentStatus = req.query.paymentStatus as string;
    const status = req.query.status as string;

    const result = await orderService.getAllOrdersByRestaurant(restaurantId, {
      page,
      limit,
      search,
      orderType,
      paymentStatus,
      status,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get active orders for restaurant
router.get('/restaurant/:restaurantId/active', requirePermission('orders.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const orders = await orderService.getActiveOrders(restaurantId);
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// Get order by ID
router.get('/:id', requirePermission('orders.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const order = await orderService.getOrderById(req.params.id, restaurantId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Middleware to check discount permission if discount is being modified
function checkDiscountPermission(req: AuthRequest, res: Response, next: NextFunction) {
  const isOwner = req.user?.isOwnerRole || req.user?.role === 'OWNER';
  if (isOwner) return next();

  const hasDiscountFields =
    req.body.discount !== undefined ||
    req.body.discountPercent !== undefined ||
    req.body.discountAmount !== undefined;

  if (hasDiscountFields) {
    if (!req.user?.permissions?.includes('orders.discount')) {
      return res.status(403).json({
        error: 'Insufficient permissions: missing orders.discount to modify order discounts',
        code: 'FORBIDDEN',
      });
    }
  }
  next();
}

// Update order / invoice details
router.patch(
  '/:id',
  requirePermission('orders.update'),
  checkDiscountPermission,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const order = await orderService.updateOrder(req.params.id, req.body, restaurantId);
      res.json(order);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/:id',
  requirePermission('orders.update'),
  checkDiscountPermission,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const order = await orderService.updateOrder(req.params.id, req.body, restaurantId);
      res.json(order);
    } catch (error) {
      next(error);
    }
  }
);

// Delete / void order
router.delete('/:id', requirePermission('orders.cancel'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await orderService.deleteOrder(req.params.id, restaurantId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Add items to order
router.post('/:id/items', requirePermission('orders.update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const order = await orderService.addItemsToOrder(req.params.id, req.body.items, restaurantId);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Update order item status
router.patch('/items/:itemId/status', requireAnyPermission(['orders.update', 'kitchen.manage']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const item = await orderService.updateOrderItemStatus(req.params.itemId, req.body.status, restaurantId);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Update order status
router.patch('/:id/status', requireAnyPermission(['orders.update', 'kitchen.manage']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const order = await orderService.updateOrderStatus(req.params.id, req.body.status, restaurantId);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Complete order
router.post('/:id/complete', requirePermission('orders.update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const order = await orderService.completeOrder(req.params.id, restaurantId);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Cancel order
router.post('/:id/cancel', requirePermission('orders.cancel'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const order = await orderService.cancelOrder(req.params.id, req.body.reason, restaurantId);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Get order total
router.get('/:id/total', requirePermission('orders.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const total = await orderService.getOrderTotal(req.params.id, restaurantId);
    res.json(total);
  } catch (error) {
    next(error);
  }
});

export default router;
