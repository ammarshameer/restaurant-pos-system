import { Router } from 'express';
import { OrderService } from '../services/order.service';

const router = Router();
const orderService = new OrderService();

// Create new order
router.post('/', async (req, res, next) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

// Get all orders for restaurant
router.get('/restaurant/:restaurantId', async (req, res, next) => {
  try {
    const orders = await orderService.getAllOrdersByRestaurant(req.params.restaurantId);
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// Get active orders for restaurant
router.get('/restaurant/:restaurantId/active', async (req, res, next) => {
  try {
    const orders = await orderService.getActiveOrders(req.params.restaurantId);
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// Get order by ID
router.get('/:id', async (req, res, next) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Update order / invoice details
router.patch('/:id', async (req, res, next) => {
  try {
    const order = await orderService.updateOrder(req.params.id, req.body);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Delete / void order
router.delete('/:id', async (req, res, next) => {
  try {
    await orderService.deleteOrder(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Add items to order
router.post('/:id/items', async (req, res, next) => {
  try {
    const order = await orderService.addItemsToOrder(req.params.id, req.body.items);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Update order item status
router.patch('/items/:itemId/status', async (req, res, next) => {
  try {
    const item = await orderService.updateOrderItemStatus(req.params.itemId, req.body.status);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Update order status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const order = await orderService.updateOrderStatus(req.params.id, req.body.status);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Complete order
router.post('/:id/complete', async (req, res, next) => {
  try {
    const order = await orderService.completeOrder(req.params.id);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Cancel order
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const order = await orderService.cancelOrder(req.params.id, req.body.reason);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Get order total
router.get('/:id/total', async (req, res, next) => {
  try {
    const total = await orderService.getOrderTotal(req.params.id);
    res.json(total);
  } catch (error) {
    next(error);
  }
});

export default router;
