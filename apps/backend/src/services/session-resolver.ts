import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets';
import { ALL_PERMISSIONS, DEFAULT_SYSTEM_ROLES } from '../permissions';

const prisma = new PrismaClient();

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  roleId?: string;
  roleName?: string;
  isOwnerRole?: boolean;
  restaurantId: string;
  firstName?: string;
  lastName?: string;
  permissions?: string[];
  supportMode?: boolean;
  impersonatedBy?: string;
  tokenUse?: 'tenant';
}

export class SessionResolverError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 401, code?: string) {
    super(message);
    this.name = 'SessionResolverError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Resolves and validates a tenant session token against live DB state.
 * Enforces employee/restaurant active status, support impersonation revalidation,
 * and authoritative DB-derived role/permissions.
 */
export async function resolveTenantSession(token: string): Promise<AuthenticatedUser> {
  if (!token || typeof token !== 'string') {
    throw new SessionResolverError('Authentication required. Please log in.', 401);
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw new SessionResolverError('Token expired', 401, 'TOKEN_EXPIRED');
    }
    throw new SessionResolverError('Invalid or malformed token', 401);
  }

  // Platform tokens must never be accepted by tenant endpoints or tenant sockets
  if (decoded.tokenUse === 'platform' || decoded.isPlatform) {
    throw new SessionResolverError('Platform token not authorized for tenant operations', 401);
  }

  if (!decoded || !decoded.id) {
    throw new SessionResolverError('Invalid authentication token payload', 401);
  }

  // Verify employee and tenant exist and are active in database
  const dbEmp = await prisma.employee.findUnique({
    where: { id: decoded.id },
    include: {
      restaurant: true,
      roleRecord: {
        include: {
          permissions: true,
        },
      },
    },
  });

  if (!dbEmp || !dbEmp.isActive) {
    throw new SessionResolverError('User account not found or deactivated', 401);
  }

  if (!dbEmp.restaurant || !dbEmp.restaurant.isActive) {
    throw new SessionResolverError('Business account suspended', 403, 'BUSINESS_SUSPENDED');
  }

  // Revalidate support impersonation on every request / socket connection
  let isSupportActive = false;
  if (decoded.supportMode) {
    if (!decoded.impersonatedBy) {
      throw new SessionResolverError('Invalid support impersonation token', 401);
    }
    const platformUser = await prisma.platformUser.findUnique({
      where: { id: decoded.impersonatedBy },
    });
    if (
      !platformUser ||
      !platformUser.isActive ||
      !['SUPPORT', 'SUPER_ADMIN'].includes(platformUser.role)
    ) {
      throw new SessionResolverError('Support access revoked', 401);
    }
    isSupportActive = true;
  }

  let isOwnerRole: boolean;
  let permissions: string[];

  if (isSupportActive) {
    // R4: Guarantee support gets full access in every tenant regardless of DB role
    isOwnerRole = true;
    permissions = [...ALL_PERMISSIONS];
  } else {
    // R7: When roleRecord is linked, it is authoritative; only fall back to role string when null
    isOwnerRole = dbEmp.roleRecord
      ? dbEmp.roleRecord.isOwnerRole === true
      : dbEmp.role === 'OWNER';

    if (isOwnerRole) {
      permissions = [...ALL_PERMISSIONS];
    } else if (dbEmp.roleRecord) {
      permissions = (dbEmp.roleRecord.permissions || []).map((p) => p.permission);
    } else {
      const matchedSystemRole = DEFAULT_SYSTEM_ROLES.find(
        (r) => r.key.toUpperCase() === (dbEmp.role || '').toUpperCase()
      );
      permissions = matchedSystemRole ? [...matchedSystemRole.permissions] : [];
    }
  }

  return {
    id: dbEmp.id,
    email: dbEmp.email,
    role: isSupportActive ? 'OWNER' : dbEmp.role,
    roleId: dbEmp.roleId || undefined,
    roleName: isSupportActive ? 'Platform Support' : (dbEmp.roleRecord?.name || dbEmp.role),
    isOwnerRole,
    restaurantId: dbEmp.restaurantId, // Derived strictly from DB employee row
    firstName: dbEmp.firstName,
    lastName: dbEmp.lastName,
    permissions,
    supportMode: isSupportActive,
    impersonatedBy: decoded.impersonatedBy,
    tokenUse: 'tenant',
  };
}

