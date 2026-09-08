import { Router } from 'express';
import { InventoryService } from '../services/inventory.service';
import { authorize } from '../middleware/auth';

const router = Router();
const inventoryService = new InventoryService();

// Get all inventory items
router.get('/restaurant/:restaurantId', async (req, res, next) => {
  try {
    const items = await inventoryService.getInventoryItems(req.params.restaurantId);
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Get single item
router.get('/:id', async (req, res, next) => {
  try {
    const item = await inventoryService.getInventoryItem(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create inventory item
router.post('/', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const item = await inventoryService.createInventoryItem(req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// Update inventory item
router.patch('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const item = await inventoryService.updateInventoryItem(req.params.id, req.body);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Adjust stock
router.post('/:id/adjust', authorize(['ADMIN', 'MANAGER', 'CHEF']), async (req, res, next) => {
  try {
    const { quantity, reason } = req.body;
    const item = await inventoryService.adjustStock(req.params.id, quantity, reason);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Get low stock items
router.get('/restaurant/:restaurantId/low-stock', async (req, res, next) => {
  try {
    const items = await inventoryService.getLowStockItems(req.params.restaurantId);
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Get transactions
router.get('/:id/transactions', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const transactions = await inventoryService.getInventoryTransactions(req.params.id, limit);
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

// Delete inventory item
router.delete('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    await inventoryService.deleteInventoryItem(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
