import { Router } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const analyticsService = new AnalyticsService();

// Helper to parse dates with defaults
const parseDateRange = (query: any) => {
  const startDate = query.startDate ? new Date(query.startDate as string) : new Date(0);
  const endDate = query.endDate ? new Date(query.endDate as string) : new Date();
  return { startDate, endDate };
};

// All analytics routes require analytics.view
router.use(requirePermission('analytics.view'));

// Get sales analytics
router.get(['/sales', '/sales/:restaurantId'], async (req: AuthRequest, res, next) => {
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
router.get(['/product-sales', '/product-sales/:restaurantId', '/product-revenue', '/product-revenue/:restaurantId'], async (req: AuthRequest, res, next) => {
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
router.get(['/top-items', '/top-items/:restaurantId'], async (req: AuthRequest, res, next) => {
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

// Get hourly revenue
router.get(['/revenue-by-hour', '/revenue-by-hour/:restaurantId'], async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    const result = await analyticsService.getRevenueByHour(restaurantId, date);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get dashboard summary
router.get(['/dashboard', '/dashboard/:restaurantId'], async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await analyticsService.getDashboardSummary(restaurantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
