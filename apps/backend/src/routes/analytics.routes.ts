import { Router } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { authorize, getAuthenticatedRestaurantId } from '../middleware/auth';

const router = Router();
const analyticsService = new AnalyticsService();

// Helper to parse dates with defaults
const parseDateRange = (query: any) => {
  const startDate = query.startDate ? new Date(query.startDate as string) : new Date(0);
  const endDate = query.endDate ? new Date(query.endDate as string) : new Date();
  return { startDate, endDate };
};

// Get sales analytics
router.get(['/sales', '/sales/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { startDate, endDate } = parseDateRange(req.query);
    const analytics = await analyticsService.getSalesAnalytics(
      restaurantId,
      startDate,
      endDate
    );
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

// Get product & deal sales revenue breakdown with pagination
router.get(['/product-sales', '/product-sales/:restaurantId', '/product-revenue', '/product-revenue/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { startDate, endDate } = parseDateRange(req.query);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const result = await analyticsService.getProductRevenueBreakdown(
      restaurantId,
      startDate,
      endDate,
      { page, limit }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get top selling items with pagination
router.get(['/top-items', '/top-items/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { startDate, endDate } = parseDateRange(req.query);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const result = await analyticsService.getTopSellingItems(
      restaurantId,
      startDate,
      endDate,
      { page, limit }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get revenue by hour
router.get(['/revenue-by-hour', '/revenue-by-hour/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    const data = await analyticsService.getRevenueByHour(restaurantId, date);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get table performance
router.get(['/tables', '/tables/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { startDate, endDate } = parseDateRange(req.query);
    const performance = await analyticsService.getTablePerformance(
      restaurantId,
      startDate,
      endDate
    );
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

// Get employee performance
router.get(['/employees', '/employees/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { startDate, endDate } = parseDateRange(req.query);
    const performance = await analyticsService.getEmployeePerformance(
      restaurantId,
      startDate,
      endDate
    );
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

// Get dashboard summary
router.get(['/dashboard', '/dashboard/:restaurantId'], authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const summary = await analyticsService.getDashboardSummary(restaurantId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

export default router;
