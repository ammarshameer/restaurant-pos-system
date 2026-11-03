import { Router } from 'express';
import { MenuService } from '../services/menu.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const menuService = new MenuService();

// Get all menu items with pagination
router.get('/items', requirePermission('menu.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const category = req.query.category as string;
    const categoryId = req.query.categoryId as string;

    const result = await menuService.getMenuItems(restaurantId, {
      page,
      limit,
      search,
      category,
      categoryId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/restaurant/:restaurantId/items', requirePermission('menu.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const category = req.query.category as string;
    const categoryId = req.query.categoryId as string;

    const result = await menuService.getMenuItems(restaurantId, {
      page,
      limit,
      search,
      category,
      categoryId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get full menu (categories with items)
router.get('/restaurant/:restaurantId', requirePermission('menu.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    if (req.query.page) {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const search = req.query.search as string;
      const category = req.query.category as string;
      const categoryId = req.query.categoryId as string;

      const result = await menuService.getMenuItems(restaurantId, {
        page,
        limit,
        search,
        category,
        categoryId,
      });
      return res.json(result);
    }

    const menu = await menuService.getMenuByRestaurant(restaurantId);
    res.json(menu);
  } catch (error) {
    next(error);
  }
});

// Get menu item
router.get('/items/:id', requirePermission('menu.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const item = await menuService.getMenuItem(req.params.id, restaurantId);
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create menu item
router.post('/items', requirePermission('menu.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const item = await menuService.createMenuItem({
      ...req.body,
      restaurantId,
    });
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// Update menu item
router.patch('/items/:id', requirePermission('menu.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const item = await menuService.updateMenuItem(req.params.id, req.body, restaurantId);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Delete menu item
router.delete('/items/:id', requirePermission('menu.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await menuService.deleteMenuItem(req.params.id, restaurantId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Create category
router.post('/categories', requirePermission('menu.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const category = await menuService.createCategory({
      ...req.body,
      restaurantId,
    });
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

// Update category
router.patch('/categories/:id', requirePermission('menu.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const category = await menuService.updateCategory(req.params.id, req.body, restaurantId);
    res.json(category);
  } catch (error) {
    next(error);
  }
});

// Delete category
router.delete('/categories/:id', requirePermission('menu.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await menuService.deleteCategory(req.params.id, restaurantId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
