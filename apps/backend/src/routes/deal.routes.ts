import { Router } from 'express';
import { dealService } from '../services/deal.service';
import { authorize } from '../middleware/auth';

const router = Router();

// Get active deals directly
router.get('/active', async (req, res, next) => {
  try {
    const restaurantId = (req.query.restaurantId as string) || 'rest-default-1';
    const deals = await dealService.getActiveDeals(restaurantId);
    res.json(deals);
  } catch (error) {
    next(error);
  }
});

// Get all deals with pagination
router.get('/', async (req, res, next) => {
  try {
    const restaurantId = (req.query.restaurantId as string) || 'rest-default-1';
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const result = await dealService.getDeals(restaurantId, {
      page,
      limit,
      search,
      isActive,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get active deals for specific restaurant
router.get('/restaurant/:restaurantId/active', async (req, res, next) => {
  try {
    const deals = await dealService.getActiveDeals(req.params.restaurantId);
    res.json(deals);
  } catch (error) {
    next(error);
  }
});

// Get all deals for specific restaurant with pagination
router.get('/restaurant/:restaurantId', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const result = await dealService.getDeals(req.params.restaurantId, {
      page,
      limit,
      search,
      isActive,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get single deal by ID
router.get('/:id', async (req, res, next) => {
  try {
    const deal = await dealService.getDealById(req.params.id);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json(deal);
  } catch (error) {
    next(error);
  }
});

// Create new deal
router.post('/', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const deal = await dealService.createDeal(req.body);
    res.status(201).json(deal);
  } catch (error) {
    next(error);
  }
});

// Toggle deal active status
router.patch('/:id/toggle', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const deal = await dealService.toggleDealActive(req.params.id, req.body.isActive);
    res.json(deal);
  } catch (error) {
    next(error);
  }
});

// Update deal (PUT)
router.put('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const deal = await dealService.updateDeal(req.params.id, req.body);
    res.json(deal);
  } catch (error) {
    next(error);
  }
});

// Update deal (PATCH)
router.patch('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const deal = await dealService.updateDeal(req.params.id, req.body);
    res.json(deal);
  } catch (error) {
    next(error);
  }
});

// Delete deal
router.delete('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    await dealService.deleteDeal(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
