import { Router, Response, NextFunction } from 'express';
import { ExpensesService } from '../services/expenses.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requireFeature,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const expensesService = new ExpensesService();

// Enforce module feature guard
router.use(requireFeature('expenses'));

// Categories
router.get('/categories', requirePermission('expenses.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const categories = await expensesService.getCategories(restaurantId);
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.post('/categories', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const category = await expensesService.createCategory(restaurantId, req.body);
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

router.patch('/categories/:id', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const category = await expensesService.updateCategory(restaurantId, req.params.id, req.body);
    res.json(category);
  } catch (err) {
    next(err);
  }
});

router.delete('/categories/:id', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await expensesService.deleteCategory(restaurantId, req.params.id);
    res.json({ success: true, message: 'Category removed' });
  } catch (err) {
    next(err);
  }
});

// Recurring Expenses
router.get('/recurring/templates', requirePermission('expenses.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const templates = await expensesService.getRecurringExpenses(restaurantId);
    res.json(templates);
  } catch (err) {
    next(err);
  }
});

router.post('/recurring/templates', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const template = await expensesService.createRecurringExpense(restaurantId, req.body);
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
});

router.patch('/recurring/templates/:id', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const template = await expensesService.updateRecurringExpense(restaurantId, req.params.id, req.body);
    res.json(template);
  } catch (err) {
    next(err);
  }
});

router.delete('/recurring/templates/:id', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    await expensesService.deleteRecurringExpense(restaurantId, req.params.id);
    res.json({ success: true, message: 'Template removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/recurring/generate', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const month = req.body.month || new Date().toISOString().slice(0, 7);
    const result = await expensesService.generateDueRecurring(restaurantId, month, req.user?.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// CSV Export
router.get('/export/csv', requirePermission('expenses.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const csv = await expensesService.exportExpensesCSV(restaurantId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// Expenses CRUD & actions
router.get('/', requirePermission('expenses.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await expensesService.getExpenses(restaurantId, {
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      month: req.query.month as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      categoryId: req.query.categoryId as string,
      status: req.query.status as string,
      source: req.query.source as string,
      search: req.query.search as string,
      includeVoided: req.query.includeVoided === 'true',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('expenses.create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const expense = await expensesService.createExpense(restaurantId, req.body, req.user?.id);
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('expenses.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const expense = await expensesService.getExpenseById(restaurantId, req.params.id);
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/pay', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const updated = await expensesService.markPaid(restaurantId, req.params.id, req.body, req.user?.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/void', requirePermission('expenses.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const updated = await expensesService.voidExpense(restaurantId, req.params.id, req.body.reason, req.user?.id || 'system');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;

