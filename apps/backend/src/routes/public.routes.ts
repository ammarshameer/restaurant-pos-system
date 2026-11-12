import { Router, Response, NextFunction, Request } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPublicRestaurantBySlug,
  getPublicMenu,
  createPublicOrder,
  hasWebsiteModuleSafe,
} from '../services/weborder.service';

const router = Router();

/**
 * Public, unauthenticated ordering API. Every route is rate-limited per IP and
 * returns 404 for unknown slugs, suspended businesses, and disabled or expired
 * modules — never leaking which businesses exist.
 */

const publicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many orders from this network, please try again later' },
});

const getMenuForSlug = async (req: Request, res: Response) => {
  const restaurant = await getPublicRestaurantBySlug(String(req.params.slug || ''));
  if (!restaurant || !restaurant.isActive) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!(await hasWebsiteModuleSafe(restaurant.id))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const menu = await getPublicMenu(restaurant);
  res.json(menu);
};

router.get('/:slug/menu', publicLimiter, (req: Request, res: Response, next: NextFunction) => {
  getMenuForSlug(req, res).catch(next);
});

router.post('/:slug/orders', publicLimiter, orderLimiter, (req: Request, res: Response, next: NextFunction) => {
  createPublicOrder({
    slug: String(req.params.slug || ''),
    items: req.body?.items,
    name: req.body?.name,
    phone: req.body?.phone,
    orderType: req.body?.orderType,
    address: req.body?.address,
    lat: req.body?.lat,
    lng: req.body?.lng,
    notes: req.body?.notes,
    paymentMethod: req.body?.paymentMethod,
    cfToken: req.body?.cfToken,
    ip: req.ip,
  })
    .then(async (result: any) => {
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.status(201).json({
        reference: result.reference,
        total: result.total,
        whatsappUrl: result.whatsappUrl,
      });
    })
    .catch(next);
});

export default router;
