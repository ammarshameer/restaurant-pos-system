import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, FeatureKey, Permission } from '../permissions';
import { JWT_PLATFORM_SECRET } from '../config/secrets';
import {
  resolveTenantSession,
  AuthenticatedUser,
  SessionResolverError,
} from '../services/session-resolver';
import { hasFeature } from '../services/feature.service';

const prisma = new PrismaClient();

export { AuthenticatedUser };

export interface AuthenticatedPlatformUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | string;
  isPlatform: true;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  platformUser?: AuthenticatedPlatformUser;
}

/**
 * Tenant Authentication Middleware
 * Strictly validates tenant tokens and scopes requests to the authenticated tenant.
 * Rejects platform tokens and verifies tenant active status.
 */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const allowMock = process.env.ALLOW_MOCK_AUTH === 'true';

    // Allow mock token ONLY when NOT in production AND explicitly enabled by env
    if (!isProduction && allowMock && (token === 'mock-jwt-token' || token.startsWith('mock-'))) {
      const defaultRest = await prisma.restaurant.findFirst();
      if (!defaultRest || !defaultRest.isActive) {
        return res.status(403).json({ error: 'Business account suspended or not configured' });
      }

      const defaultEmp = await prisma.employee.findFirst({
        where: { restaurantId: defaultRest.id },
        include: { roleRecord: { include: { permissions: true } } },
      });

      req.user = {
        id: defaultEmp?.id || 'emp-dev-1',
        email: defaultEmp?.email || 'owner@restaurant.local',
        role: defaultEmp?.role || 'OWNER',
        roleId: defaultEmp?.roleId || undefined,
        roleName: defaultEmp?.roleRecord?.name || 'Owner',
        isOwnerRole: true,
        restaurantId: defaultRest.id,
        firstName: defaultEmp?.firstName || 'Dev',
        lastName: defaultEmp?.lastName || 'Admin',
        permissions: [...ALL_PERMISSIONS],
        tokenUse: 'tenant',
      };
      return next();
    }

    req.user = await resolveTenantSession(token);
    next();
  } catch (error: any) {
    if (error instanceof SessionResolverError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    return res.status(401).json({ error: error.message || 'Authentication failed' });
  }
};

/**
 * Require Permission Middleware
 * Ensures the authenticated user possesses all specified permissions.
 * OWNER (or isOwnerRole) always passes unconditionally.
 */
export const requirePermission = (...requiredPermissions: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userPermissions = new Set(req.user.permissions || []);
    const missing = requiredPermissions.filter((p) => !userPermissions.has(p));

    if (missing.length > 0) {
      return res.status(403).json({
        error: `Insufficient permissions: missing ${missing.join(', ')}`,
        code: 'FORBIDDEN',
        missing,
      });
    }

    next();
  };
};

export const requireAnyPermission = (permissions: Permission[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userPermissions = new Set(req.user.permissions || []);
    if (permissions.some((permission) => userPermissions.has(permission))) {
      return next();
    }
    return res.status(403).json({
      error: `Insufficient permissions: requires one of ${permissions.join(', ')}`,
      code: 'FORBIDDEN',
      required: permissions,
    });
  };
};

export const requireFeature = (feature: FeatureKey) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (!(await hasFeature(req.user.restaurantId, feature))) {
        return res.status(403).json({
          error: 'Feature not enabled for this business',
          code: 'FEATURE_NOT_ENABLED',
          feature,
        });
      }
      next();
  };
};

const COST_FIELDS = new Set([
  'cost', 'costPerUnit', 'purchaseUnitCost', 'saleUnitCost', 'convertedCostPerSaleUnit',
  'unitCost', 'averageCost', 'totalCost', 'estimatedCost', 'costTotal',
]);

export const requireCostingWritePermission = () => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
      const containsCost = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(containsCost);
        return Object.entries(value).some(([key, child]) => COST_FIELDS.has(key) || containsCost(child));
      };
      if (!containsCost(req.body)) return next();
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      await requireFeature('costing')(req, res, () => {
        requirePermission('costing.manage')(req, res, next);
      });
  };
};

/**
 * Legacy authorize middleware without ADMIN bypass
 */
export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = (req.user.role || '').toUpperCase();
    const normalizedRoles = roles.map((r) => r.toUpperCase());

    if (!normalizedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions for this operation' });
    }

    next();
  };
};

/**
 * Helper to safely extract restaurantId strictly from authenticated token
 */
export const getAuthenticatedRestaurantId = (req: AuthRequest): string => {
  if (!req.user?.restaurantId) {
    throw new Error('Tenant restaurant ID not found in authenticated session');
  }
  return req.user.restaurantId;
};

// ============================================
// PLATFORM AUTHENTICATION & AUTHORIZATION
// ============================================

/**
 * Platform Authentication Middleware
 * Only accepts platform tokens signed with JWT_PLATFORM_SECRET.
 * Rejects tenant tokens and validates that the platform user is active.
 */
export const authenticatePlatform = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Platform authentication required' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Platform authentication required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_PLATFORM_SECRET);
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Platform token expired', code: 'PLATFORM_TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid platform token' });
    }

    if (decoded.tokenUse !== 'platform' || !decoded.isPlatform || !decoded.id) {
      return res.status(401).json({ error: 'Not a valid platform token' });
    }

    const platformUser = await prisma.platformUser.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!platformUser || !platformUser.isActive) {
      return res.status(401).json({ error: 'Platform account suspended or inactive' });
    }

    req.platformUser = {
      id: platformUser.id,
      name: platformUser.name,
      email: platformUser.email,
      role: platformUser.role,
      isPlatform: true,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Platform authentication failed' });
  }
};

/**
 * Platform Authorization Middleware (e.g. SUPER_ADMIN only)
 */
export const authorizePlatform = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.platformUser) {
      return res.status(401).json({ error: 'Platform authentication required' });
    }

    const role = (req.platformUser.role || '').toUpperCase();
    const normalized = roles.map((r) => r.toUpperCase());

    if (!normalized.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: Platform role unauthorized' });
    }

    next();
  };
};
