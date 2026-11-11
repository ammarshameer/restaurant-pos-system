import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/auth.service';

const router = Router();
const authService = new AuthService();

// Rate limiting on sensitive auth endpoints to prevent brute-force attacks
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 1000 : 30, // Limit each IP to 30 requests per windowMs (relaxed in test)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

const onboardRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many onboarding requests created from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// Multi-tenant Onboarding: Disabled by default. Platform Super Admin creates businesses.
router.post('/onboard', onboardRateLimiter, async (req, res, next) => {
  try {
    if (process.env.ALLOW_SELF_ONBOARDING !== 'true') {
      return res.status(403).json({
        error: 'Public self-onboarding is disabled. Please contact the platform super administrator to create a tenant account.',
        code: 'SELF_ONBOARDING_DISABLED',
      });
    }

    const {
      restaurantName,
      address,
      phone,
      email,
      timezone,
      adminEmail,
      adminPassword,
      adminFirstName,
      adminLastName,
      adminPin,
      adminPhone,
    } = req.body;

    if (!restaurantName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
      return res.status(400).json({
        error: 'Missing required onboarding fields: restaurantName, adminEmail, adminPassword, adminFirstName, adminLastName',
      });
    }

    if (adminPassword.length < 6) {
      return res.status(400).json({ error: 'Admin password must be at least 6 characters long.' });
    }

    const result = await authService.onboardRestaurant({
      restaurantName,
      address,
      phone,
      email,
      timezone,
      adminEmail,
      adminPassword,
      adminFirstName,
      adminLastName,
      adminPin,
      adminPhone,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// Login with email & password or businessCode + username
router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const { email, username, identifier, password, businessCode, tenantSlug } = req.body;
    const loginIdentifier = username || email || identifier;
    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }
    const ip = req.ip || (req.socket?.remoteAddress as string) || '0.0.0.0';
    const result = await authService.login(loginIdentifier, password, businessCode || tenantSlug, ip);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode === 429) {
      return res.status(429).json({ error: error.message, code: 'LOCKED' });
    }
    if (error.message?.includes('suspended')) {
      return res.status(403).json({ error: error.message, code: 'BUSINESS_SUSPENDED' });
    }
    res.status(401).json({ error: error.message || 'Invalid email or password' });
  }
});

// Scoped PIN login (for POS terminal users within a specific tenant)
router.post('/pin-login', authRateLimiter, async (req, res, next) => {
  try {
    const { pin, tenantSlug, restaurantId, businessCode } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'PIN is required' });
    }
    if (!tenantSlug && !restaurantId && !businessCode) {
      return res.status(400).json({
        error: 'Tenant identifier (tenantSlug, businessCode or restaurantId) is required for PIN login',
      });
    }

    const ip = req.ip || (req.socket?.remoteAddress as string) || '0.0.0.0';
    const result = await authService.loginWithPin(pin, { tenantSlug, restaurantId, businessCode }, ip);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode === 429) {
      return res.status(429).json({ error: error.message, code: 'LOCKED' });
    }
    if (error.message?.includes('suspended')) {
      return res.status(403).json({ error: error.message, code: 'BUSINESS_SUSPENDED' });
    }
    res.status(401).json({ error: error.message || 'Invalid PIN or tenant not found' });
  }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    const result = await authService.refreshToken(refreshToken);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Verify token
router.get('/verify', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const user = await authService.verifyToken(token);
    res.json({ user });
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid token' });
  }
});

export default router;
