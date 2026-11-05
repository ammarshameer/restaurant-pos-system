import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { TableService } from '../services/table.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const tableService = new TableService();
const prisma = new PrismaClient();

router.get('/floor-plans', requirePermission('tables.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const floorPlans = await prisma.floorPlan.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    res.json(floorPlans);
  } catch (error) {
    next(error);
  }
});

// Get all tables for a floor plan
router.get('/floor/:floorPlanId', requirePermission('tables.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const tables = await tableService.getTablesByFloorPlan(req.params.floorPlanId, restaurantId);
    res.json(tables);
  } catch (error) {
    next(error);
  }
});

// Get single table
router.get('/:id', requirePermission('tables.view'), async (req: AuthRequest, res, next) => {
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
router.post('/', requirePermission('tables.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.createTable(req.body, restaurantId);
    res.status(201).json(table);
  } catch (error) {
    next(error);
  }
});

// Update table
router.patch('/:id', requirePermission('tables.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.updateTable(req.params.id, req.body, restaurantId);
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Update table status
router.patch('/:id/status', requirePermission('tables.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const table = await tableService.updateTableStatus(req.params.id, req.body, restaurantId);
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Delete table
router.delete('/:id', requirePermission('tables.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await tableService.deleteTable(req.params.id, restaurantId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Combine tables
router.post('/combine', requirePermission('tables.manage'), async (req: AuthRequest, res, next) => {
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
router.post('/split/:id', requirePermission('tables.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await tableService.splitTable(req.params.id, restaurantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
