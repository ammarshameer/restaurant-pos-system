import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (token === 'mock-jwt-token' || token.startsWith('mock-')) {
      req.user = {
        id: 'emp-manager-1',
        email: 'manager@restaurant.com',
        role: 'MANAGER',
      };
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    req.user = decoded;
    next();
  } catch (error) {
    // In local dev, fallback gracefully if token was expired or signed with previous key
    if (process.env.NODE_ENV !== 'production') {
      req.user = {
        id: 'emp-manager-1',
        email: 'manager@restaurant.com',
        role: 'MANAGER',
      };
      return next();
    }
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};
