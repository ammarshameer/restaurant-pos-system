import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { PlatformService } from '../services/platform.service';
import {
  authenticatePlatform,
  authorizePlatform,
  AuthRequest,
} from '../middleware/auth';

const router = Router();
const platformService = new PlatformService();

const platformLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // Stricter limit for platform super admin / support
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many platform authentication attempts, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// Platform Login
router.post('/auth/login', platformLoginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await platformService.login(email, password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid platform credentials' });
  }
});

// Platform Refresh Token
router.post('/auth/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Platform refresh token required' });
    }
    const result = await platformService.refresh(refreshToken);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid refresh token' });
  }
});

// Platform Logout
router.post('/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    await platformService.logout(refreshToken);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// All routes below require authenticatePlatform
router.use(authenticatePlatform);

// Current platform user profile
router.get('/me', (req: AuthRequest, res: Response) => {
  res.json({ user: req.platformUser });
});

// List all tenants (SUPER_ADMIN, SUPPORT)
router.get('/restaurants', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurants = await platformService.listRestaurants();
    res.json(restaurants);
  } catch (error) {
    next(error);
  }
});

// Create tenant and business owner atomically (SUPER_ADMIN only)
router.post(
  '/restaurants',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        businessName,
        address,
        phone,
        businessEmail,
        timezone,
        logoUrl,
        ownerFirstName,
        ownerLastName,
        ownerEmail,
        ownerPhone,
        ownerPassword,
        ownerPin,
      } = req.body;

      if (
        !businessName ||
        !ownerFirstName ||
        !ownerLastName ||
        !ownerEmail ||
        !ownerPassword
      ) {
        return res.status(400).json({
          error:
            'Missing required fields: businessName, ownerFirstName, ownerLastName, ownerEmail, ownerPassword',
        });
      }

      if (ownerPassword.length < 6) {
        return res.status(400).json({
          error: 'Owner password must be at least 6 characters long',
        });
      }

      const result = await platformService.createRestaurant(
        {
          businessName,
          address,
          phone,
          businessEmail,
          timezone,
          logoUrl,
          ownerFirstName,
          ownerLastName,
          ownerEmail,
          ownerPhone,
          ownerPassword,
          ownerPin,
        },
        req.platformUser!.id,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );

      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to create business' });
    }
  }
);

// Update tenant business details or status (SUPER_ADMIN only)
router.patch(
  '/restaurants/:id',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const updated = await platformService.updateRestaurant(
        req.params.id,
        req.body,
        req.platformUser!.id,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to update business' });
    }
  }
);

// Reset business owner password (SUPER_ADMIN only)
router.post(
  '/restaurants/:id/reset-owner-password',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { newPassword } = req.body;
      const result = await platformService.resetOwnerPassword(
        req.params.id,
        newPassword,
        req.platformUser!.id,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to reset owner password' });
    }
  }
);

// Impersonate / Enter tenant in support mode (SUPER_ADMIN, SUPPORT)
router.post(
  '/restaurants/:id/enter',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reason } = req.body || {};
      const session = await platformService.enterTenant(
        req.params.id,
        req.platformUser!,
        reason,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );
      res.json(session);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to enter tenant' });
    }
  }
);

// Manage single SUPPORT user account (SUPER_ADMIN only)
const handleUpsertSupportAccount = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, isActive } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Support email is required' });
    }

    const supportAccount = await platformService.upsertSupportAccount(
      { name, email, password, isActive },
      req.platformUser!.id,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.json(supportAccount);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to configure support account' });
  }
};

router.put('/support-account', authorizePlatform(['SUPER_ADMIN']), handleUpsertSupportAccount);
router.post('/support-account', authorizePlatform(['SUPER_ADMIN']), handleUpsertSupportAccount);

// Platform Audit Logs (SUPER_ADMIN only)
router.get(
  '/audit-logs',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const restaurantId = req.query.restaurantId as string;
      const action = req.query.action as string;

      const logs = await platformService.getAuditLogs({ page, limit, restaurantId, action });
      res.json(logs);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

