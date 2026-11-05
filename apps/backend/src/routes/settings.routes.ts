import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';
import { slugify } from '../permissions';
import { validateLogo } from '../utils/validateLogo';

const router = Router();
const prisma = new PrismaClient();

router.get('/branding', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, name: true, slug: true, logoUrl: true, address: true, phone: true, timezone: true },
    });
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(restaurant);
  } catch (error) {
    next(error);
  }
});

// Get current tenant business profile
router.get('/business', requirePermission('settings.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        address: true,
        phone: true,
        email: true,
        timezone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant profile not found' });
    }

    res.json(restaurant);
  } catch (error) {
    next(error);
  }
});

// Update current tenant business profile
router.patch('/business', requirePermission('settings.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { name, address, phone, email, timezone, logoUrl, slug } = req.body;

    const updateData: any = {};

    if (name !== undefined && name.trim()) updateData.name = name.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (phone !== undefined) updateData.phone = phone.trim();
    if (email !== undefined) updateData.email = email.trim();
    if (timezone !== undefined && timezone.trim()) updateData.timezone = timezone.trim();

    if (logoUrl !== undefined) {
      if (logoUrl === null || logoUrl === '') {
        updateData.logoUrl = null;
      } else {
        const validation = validateLogo(logoUrl);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }
        updateData.logoUrl = logoUrl;
      }
    }

    if (slug !== undefined && slug.trim()) {
      const candidate = slugify(slug);
      const existing = await prisma.restaurant.findFirst({
        where: { slug: candidate, id: { not: restaurantId } },
      });
      if (existing) {
        return res.status(400).json({ error: 'This business code/slug is already in use by another restaurant' });
      }
      updateData.slug = candidate;
    }

    const updated = await prisma.restaurant.update({
      where: { id: restaurantId },
      data: updateData,
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        address: true,
        phone: true,
        email: true,
        timezone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
