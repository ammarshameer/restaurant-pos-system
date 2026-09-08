import { Router } from 'express';
import { TableService } from '../services/table.service';
import { authorize } from '../middleware/auth';

const router = Router();
const tableService = new TableService();

// Get all tables for a floor plan
router.get('/floor/:floorPlanId', async (req, res, next) => {
  try {
    const tables = await tableService.getTablesByFloorPlan(req.params.floorPlanId);
    res.json(tables);
  } catch (error) {
    next(error);
  }
});

// Get single table
router.get('/:id', async (req, res, next) => {
  try {
    const table = await tableService.getTableById(req.params.id);
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
    const table = await tableService.createTable(req.body);
    res.status(201).json(table);
  } catch (error) {
    next(error);
  }
});

// Update table
router.patch('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const table = await tableService.updateTable(req.params.id, req.body);
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Update table status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const table = await tableService.updateTableStatus(req.params.id, req.body);
    res.json(table);
  } catch (error) {
    next(error);
  }
});

// Delete table
router.delete('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    await tableService.deleteTable(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Combine tables
router.post('/combine', authorize(['ADMIN', 'MANAGER', 'SERVER']), async (req, res, next) => {
  try {
    const { tableIds } = req.body;
    const result = await tableService.combineTables(tableIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Split tables
router.post('/split/:id', authorize(['ADMIN', 'MANAGER', 'SERVER']), async (req, res, next) => {
  try {
    const result = await tableService.splitTable(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
