import { Router } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { authorize } from '../middleware/auth';

const router = Router();
const analyticsService = new AnalyticsService();

// Get sales analytics
router.get('/sales/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const analytics = await analyticsService.getSalesAnalytics(
      req.params.restaurantId,
      startDate,
      endDate
    );
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

// Get top selling items
router.get('/top-items/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const limit = parseInt(req.query.limit as string) || 10;
    const items = await analyticsService.getTopSellingItems(
      req.params.restaurantId,
      startDate,
      endDate,
      limit
    );
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Get revenue by hour
router.get('/revenue-by-hour/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const date = new Date(req.query.date as string);
    const data = await analyticsService.getRevenueByHour(req.params.restaurantId, date);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get table performance
router.get('/tables/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const performance = await analyticsService.getTablePerformance(
      req.params.restaurantId,
      startDate,
      endDate
    );
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

// Get employee performance
router.get('/employees/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const performance = await analyticsService.getEmployeePerformance(
      req.params.restaurantId,
      startDate,
      endDate
    );
    res.json(performance);
  } catch (error) {
    next(error);
  }
});

// Get dashboard summary
router.get('/dashboard/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const summary = await analyticsService.getDashboardSummary(req.params.restaurantId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

export default router;
