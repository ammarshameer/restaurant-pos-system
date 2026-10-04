import { Router } from 'express';
import { TableService } from '../services/table.service';
import { authorize, getAuthenticatedRestaurantId } from '../middleware/auth';

const router = Router();
const tableService = new TableService();

// Get all tables for a floor plan
router.get('/floor/:floorPlanId', async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const tables = await tableService.getTablesByFloorPlan(req.params.floorPlanId, restaurantId);
    res.json(tables);
  } catch (error) {
    next(error);
  }
});

// Get single table
router.get('/:id', async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.getTableById(req.params.id, restaurantId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Create table
router.post('/', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.createTable(req.body, restaurantId);
    res.status(201).json(table);
  } catch (error) {
    next(error);
  }
});

// Update table
router.patch('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.updateTable(req.params.id, req.body, restaurantId);
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Update table status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.updateTableStatus(req.params.id, req.body, restaurantId);
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Delete table
router.delete('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await tableService.deleteTable(req.params.id, restaurantId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Combine tables
router.post('/combine', authorize(['ADMIN', 'MANAGER', 'SERVER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { tableIds } = req.body;
    const result = await tableService.combineTables(tableIds, restaurantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Split tables
router.post('/split/:id', authorize(['ADMIN', 'MANAGER', 'SERVER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await tableService.splitTable(req.params.id, restaurantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
