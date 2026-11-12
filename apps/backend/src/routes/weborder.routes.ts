import { Router, Response, NextFunction } from 'express';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
  requireAnyPermission,
  requireFeature,
} from '../middleware/auth';
import {
  getWebsiteSettings,
  updateWebsiteSettings,
  listWebOrders,
  acceptWebOrder,
  rejectWebOrder,
  markDelivered,
  getWebOrderForTenant,
  getWebOrderByReference,
  ensureWebsiteSlug,
  buildWhatsAppUrl,
  buildWhatsAppMessage,
} from '../services/weborder.service';
import { normalizePhone } from '../utils/phone';

const router = Router();

// All POS-side website routes require the 'website' module: disabled or
// expired module answers 403.
router.use(requireFeature('website'));

// ---- Website settings ----

router.get(
  '/settings',
  requireAnyPermission(['weborders.view', 'website.settings']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const settings = await getWebsiteSettings(restaurantId);
      if (!settings) return res.status(404).json({ error: 'Restaurant not found' });
      if (!settings.websiteSlug) {
        settings.websiteSlug = await ensureWebsiteSlug(restaurantId);
      }
      res.json(settings);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/settings',
  requirePermission('website.settings'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const result = await updateWebsiteSettings(restaurantId, req.body || {});
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json(result.restaurant);
    } catch (error) {
      next(error);
    }
  }
);

// Send a test WhatsApp message to the business number.
router.post(
  '/settings/test-whatsapp',
  requirePermission('website.settings'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const settings = await getWebsiteSettings(restaurantId);
      if (!settings) return res.status(404).json({ error: 'Restaurant not found' });
      const digits = normalizePhone(String(settings.whatsappNumber || req.body?.number || ''));
      if (!digits) {
        return res.status(400).json({ error: 'Set a valid WhatsApp number first (e.g. 0300 1234567)' });
      }
      const url = buildWhatsAppUrl(
        digits,
        `Test message from ${settings.name} POS - your WhatsApp ordering number works! 🎉`
      );
      res.json({ whatsappUrl: url, number: '+' + digits });
    } catch (error) {
      next(error);
    }
  }
);

// ---- Order inbox ----

router.get(
  '/orders',
  requirePermission('weborders.view'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const orders = await listWebOrders(restaurantId, {
        status: req.query.status as string | undefined,
        limit: Number(req.query.limit) || 100,
      });
      res.json(orders);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/orders/:id',
  requirePermission('weborders.view'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      // Tenant isolation: the lookup is always scoped to the authenticated tenant.
      const order = await getWebOrderForTenant(restaurantId, String(req.params.id));
      if (!order) {
        const byRef = await getWebOrderByReference(restaurantId, String(req.params.id));
        if (!byRef) return res.status(404).json({ error: 'Order not found' });
        return res.json(byRef);
      }
      res.json(order);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/orders/:id/accept',
  requirePermission('weborders.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const result = await acceptWebOrder(
        restaurantId,
        String(req.params.id),
        req.user?.id,
        req.body?.deliveryFee
      );
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json(result.webOrder);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/orders/:id/reject',
  requirePermission('weborders.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const result = await rejectWebOrder(restaurantId, String(req.params.id), String(req.body?.reason || ''));
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json(result.webOrder);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/orders/:id/delivered',
  requirePermission('weborders.manage'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const result = await markDelivered(restaurantId, String(req.params.id));
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json(result.webOrder);
    } catch (error) {
      next(error);
    }
  }
);

// Prefilled "Reply on WhatsApp" link to the customer, built server-side.
router.get(
  '/orders/:id/reply-url',
  requirePermission('weborders.view'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      const order = await getWebOrderForTenant(restaurantId, String(req.params.id));
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const settings = await getWebsiteSettings(restaurantId);
      const businessName = settings?.name || '';
      const statusText =
        order.status === 'ACCEPTED'
          ? `Your order ${order.reference} is confirmed! 👨‍🍳`
          : order.status === 'REJECTED'
            ? `Sorry, we could not accept order ${order.reference}.${order.rejectionReason ? ` Reason: ${order.rejectionReason}` : ''}`
            : `Update on your order ${order.reference}`;
      const message = `Hello ${order.customerName}! ${statusText}\n- ${businessName} via WhatsApp Ordering`;
      res.json({ whatsappUrl: buildWhatsAppUrl(order.customerPhone, message) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
