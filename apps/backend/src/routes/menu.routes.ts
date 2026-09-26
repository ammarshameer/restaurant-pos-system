import { Router } from 'express';
import { MenuService } from '../services/menu.service';
import { authorize } from '../middleware/auth';

const router = Router();
const menuService = new MenuService();

// Get all menu items with pagination
router.get('/items', async (req, res, next) => {
  try {
    const restaurantId = (req.query.restaurantId as string) || 'rest-default-1';
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

router.get('/restaurant/:restaurantId/items', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const category = req.query.category as string;
    const categoryId = req.query.categoryId as string;

    const result = await menuService.getMenuItems(req.params.restaurantId, {
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
router.get('/restaurant/:restaurantId', async (req, res, next) => {
  try {
    if (req.query.page) {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const search = req.query.search as string;
      const category = req.query.category as string;
      const categoryId = req.query.categoryId as string;

      const result = await menuService.getMenuItems(req.params.restaurantId, {
        page,
        limit,
        search,
        category,
        categoryId,
      });
      return res.json(result);
    }

    const menu = await menuService.getMenuByRestaurant(req.params.restaurantId);
    res.json(menu);
  } catch (error) {
    next(error);
  }
});

// Get menu item
router.get('/items/:id', async (req, res, next) => {
  try {
    const item = await menuService.getMenuItem(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create menu item
router.post('/items', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const item = await menuService.createMenuItem(req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// Update menu item
router.patch('/items/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const item = await menuService.updateMenuItem(req.params.id, req.body);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Delete menu item
router.delete('/items/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    await menuService.deleteMenuItem(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Create category
router.post('/categories', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const category = await menuService.createCategory(req.body);
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

// Update category
router.patch('/categories/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const category = await menuService.updateCategory(req.params.id, req.body);
    res.json(category);
  } catch (error) {
    next(error);
  }
});

// Delete category
router.delete('/categories/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    await menuService.deleteCategory(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
