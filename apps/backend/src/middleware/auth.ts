import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  restaurantId: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : (req.headers['x-auth-token'] as string) || (req.query.token as string);

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const isProduction = process.env.NODE_ENV === 'production';

    // Allow mock token ONLY in non-production local offline development
    if (!isProduction && (token === 'mock-jwt-token' || token.startsWith('mock-'))) {
      const defaultRest = await prisma.restaurant.findFirst();
      const defaultEmp = await prisma.employee.findFirst({
        where: defaultRest ? { restaurantId: defaultRest.id } : undefined,
      });

      req.user = {
        id: defaultEmp?.id || 'emp-manager-1',
        email: defaultEmp?.email || 'manager@restaurant.com',
        role: defaultEmp?.role || 'MANAGER',
        restaurantId: defaultRest?.id || 'rest-default-1',
        firstName: defaultEmp?.firstName || 'Manager',
        lastName: defaultEmp?.lastName || 'User',
      };
      return next();
    }

    const secret = process.env.JWT_SECRET || 'secret';
    const decoded = jwt.verify(token, secret) as any;

    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    let restaurantId = decoded.restaurantId;

    // If token didn't contain restaurantId (legacy/fallback), resolve from database
    if (!restaurantId) {
      const dbEmp = await prisma.employee.findUnique({
        where: { id: decoded.id },
        select: { id: true, restaurantId: true, role: true, email: true, firstName: true, lastName: true },
      });

      if (!dbEmp) {
        return res.status(401).json({ error: 'User account not found or deactivated' });
      }
      restaurantId = dbEmp.restaurantId;
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role || 'SERVER',
      restaurantId,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or malformed token' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = (req.user.role || '').toUpperCase();
    const normalizedRoles = roles.map((r) => r.toUpperCase());

    if (!normalizedRoles.includes(userRole) && userRole !== 'ADMIN') {
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

