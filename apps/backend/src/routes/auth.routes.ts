import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/auth.service';

const router = Router();
const authService = new AuthService();

// Rate limiting on sensitive auth endpoints to prevent brute-force attacks
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

const onboardRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit onboarding attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many onboarding requests created from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// Multi-tenant Onboarding: Create new restaurant client + admin account
router.post('/onboard', onboardRateLimiter, async (req, res, next) => {
  try {
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

// Register new staff user (within an existing tenant)
router.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// Login with email & password
router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = await authService.login(email, password);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Quick PIN login (for POS terminal users)
router.post('/pin-login', authRateLimiter, async (req, res, next) => {
  try {
    const { pin, restaurantId } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'PIN is required' });
    }
    const result = await authService.loginWithPin(pin, restaurantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refreshToken(refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
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
  } catch (error) {
    next(error);
  }
});

export default router;

