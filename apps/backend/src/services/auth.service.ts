import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ALL_PERMISSIONS, DEFAULT_SYSTEM_ROLES, filterPermissionsByFeatures, FEATURES } from '../permissions';
import { REQUIRED_MODULES } from './feature.service';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../config/secrets';
import { getEnabledFeatures } from './feature.service';
import { attemptLockService } from './attempt-lock.service';
import { DEFAULT_EXPENSE_CATEGORIES } from './expenses.service';
import { ValidationError } from '../lib/errors';

export type EmployeeRole = 'OWNER' | 'MANAGER' | 'CHEF' | 'WAITER' | 'CASHIER' | string;

const prisma = new PrismaClient();

function capitalizeName(value: string): string {
  return value
    .trim()
    .toUpperCase();
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '') // Remove all non-word chars
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
}

export class AuthService {
  private JWT_SECRET = JWT_SECRET;
  private JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;
  private JWT_EXPIRES_IN = '24h';
  private JWT_REFRESH_EXPIRES_IN = '7d';

  /**
   * Generates a unique slug for a restaurant
   */
  async generateUniqueSlug(name: string): Promise<string> {
    const baseSlug = slugify(name) || 'restaurant';
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await prisma.restaurant.findUnique({
        where: { slug: candidate },
      });
      if (!existing) {
        return candidate;
      }
      counter++;
      candidate = `${baseSlug}-${counter}`;
    }
  }

  /**
   * Atomic tenant creation helper with system roles, starter categories, and floor plan.
   * Used by platform API and internal seeding.
   */
  async createTenantWithStarterData(data: {
    businessName: string;
    address?: string;
    phone?: string;
    businessEmail?: string;
    timezone?: string;
    logoUrl?: string;
    createdByPlatformUserId?: string;
    ownerFirstName: string;
    ownerLastName: string;
    ownerEmail: string;
    ownerPhone?: string;
    ownerPassword: string;
    ownerPin?: string;
    features?: Array<{ key: string; enabled: boolean; expiresAt?: string | Date | null }> | string[];
    featureExpiresAt?: string | Date | null;
  }) {
    const emailNormalized = data.ownerEmail.trim().toLowerCase();

    // Verify email uniqueness across both PlatformUser and Employee
    const [existingPlatformUser, existingEmployee] = await Promise.all([
      prisma.platformUser.findUnique({ where: { email: emailNormalized } }),
      prisma.employee.findUnique({ where: { email: emailNormalized } }),
    ]);

    if (existingPlatformUser || existingEmployee) {
      throw new Error('An account with this email address already exists.');
    }

    if (!data.address || !data.address.trim()) {
      throw new ValidationError('Restaurant address is required');
    }
    const businessPhone = data.phone?.trim() || data.ownerPhone?.trim();
    if (!businessPhone) {
      throw new ValidationError('Restaurant phone number is required');
    }

    let plainOwnerPin: string;
    if (data.ownerPin && data.ownerPin.trim()) {
      plainOwnerPin = data.ownerPin.trim();
      if (!/^\d{6}$/.test(plainOwnerPin)) {
        throw new ValidationError('Owner PIN must be exactly 6 digits');
      }
    } else {
      plainOwnerPin = crypto.randomInt(100000, 1000000).toString();
    }

    const hashedPassword = await bcrypt.hash(data.ownerPassword, 10);
    const hashedOwnerPin = await bcrypt.hash(plainOwnerPin, 10);
    const slug = await this.generateUniqueSlug(data.businessName);

    return prisma.$transaction(async (tx) => {
      // 1. Create Restaurant record
      const restaurant = await tx.restaurant.create({
        data: {
          name: data.businessName.trim(),
          slug,
          logoUrl: data.logoUrl || null,
          isActive: true,
          address: data.address.trim(),
          phone: businessPhone,
          email: data.businessEmail?.trim() || emailNormalized,
          timezone: data.timezone || 'Asia/Karachi',
          createdByPlatformUserId: data.createdByPlatformUserId || null,
        },
      });

      // 1b. Create module features for restaurant
      const featureRows = FEATURES.map((key) => {
        let enabled = false;
        let expiresAt: Date | null = data.featureExpiresAt ? new Date(data.featureExpiresAt) : null;

        if (Array.isArray(data.features)) {
          if (data.features.length > 0 && typeof data.features[0] === 'string') {
            enabled = (data.features as string[]).includes(key);
          } else {
            const match = (data.features as Array<{ key: string; enabled: boolean; expiresAt?: any }>).find(
              (f) => f.key === key
            );
            if (match) {
              enabled = Boolean(match.enabled);
              if (match.expiresAt) expiresAt = new Date(match.expiresAt);
            }
          }
        } else {
          // Default preset: all standard modules + costing enabled, expenses & payroll off
          if (key === 'expenses' || key === 'payroll') {
            enabled = false;
          } else {
            enabled = true;
          }
        }

        // Required modules are ALWAYS enabled
        if (REQUIRED_MODULES.includes(key)) {
          enabled = true;
        }

        return {
          restaurantId: restaurant.id,
          featureKey: key,
          enabled,
          expiresAt,
          grantedByPlatformUserId: data.createdByPlatformUserId || null,
        };
      });

      await tx.tenantFeature.createMany({
        data: featureRows,
      });

      if (data.createdByPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            platformUserId: data.createdByPlatformUserId,
            restaurantId: restaurant.id,
            action: 'TENANT_FEATURES_INITIALIZED',
            details: JSON.stringify({
              enabledFeatures: featureRows.filter((f) => f.enabled).map((f) => f.featureKey),
            }),
          },
        });
      }

      // 2. Create Default System Roles with Permissions
      let ownerRoleRecord: any = null;
      for (const roleDef of DEFAULT_SYSTEM_ROLES) {
        const createdRole = await tx.role.create({
          data: {
            restaurantId: restaurant.id,
            key: roleDef.key,
            name: roleDef.name,
            description: roleDef.description,
            isSystem: roleDef.isSystem,
            isOwnerRole: roleDef.isOwnerRole,
            permissions: {
              create: roleDef.permissions.map((p) => ({ permission: p })),
            },
          },
        });

        if (roleDef.isOwnerRole) {
          ownerRoleRecord = createdRole;
        }
      }

      // 3. Create initial Owner Employee linked to OWNER Role
      const ownerUser = await tx.employee.create({
        data: {
          email: emailNormalized,
          passwordHash: hashedPassword,
          firstName: capitalizeName(data.ownerFirstName),
          lastName: capitalizeName(data.ownerLastName),
          restaurantId: restaurant.id,
          role: 'OWNER',
          roleId: ownerRoleRecord?.id || null,
          pin: hashedOwnerPin,
          phone: data.ownerPhone || data.phone || null,
          hourlyRate: 0,
          isActive: true,
        },
      });

      // 4. Create starter menu categories
      const starterCategories = ['Burgers & Fast Food', 'Pizzas & Platters', 'Beverages & Drinks', 'Desserts'];
      for (let i = 0; i < starterCategories.length; i++) {
        await tx.category.create({
          data: {
            name: starterCategories[i],
            displayOrder: i + 1,
            restaurantId: restaurant.id,
          },
        });
      }

      // 5. Create default floor plan and starter tables
      const floorPlan = await tx.floorPlan.create({
        data: {
          name: 'Main Dining Hall',
          restaurantId: restaurant.id,
          layout: JSON.stringify({ grid: 12 }),
          isActive: true,
        },
      });

      for (let t = 1; t <= 4; t++) {
        await tx.table.create({
          data: {
            number: `T-${t}`,
            floorPlanId: floorPlan.id,
            capacity: 4,
            minCapacity: 1,
            x: (t - 1) * 120 + 20,
            y: 50,
            status: 'AVAILABLE',
          },
        });
      }

      // 6. Create default expense categories
      for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
        await tx.expenseCategory.create({
          data: {
            restaurantId: restaurant.id,
            name: cat.name,
            isSystem: cat.isSystem,
          },
        });
      }

      // 7. Create default payroll settings
      await tx.payrollSettings.create({
        data: {
          restaurantId: restaurant.id,
          workdayHours: 8,
          workdaysPerMonth: 26,
          overtimeMultiplier: 1.5,
          overtimeApprovalRequired: true,
        },
      });

      return {
        restaurant,
        owner: {
          id: ownerUser.id,
          email: ownerUser.email,
          firstName: ownerUser.firstName,
          lastName: ownerUser.lastName,
          role: ownerUser.role,
          roleId: ownerRoleRecord?.id,
          phone: ownerUser.phone,
          restaurantId: restaurant.id,
          pin: plainOwnerPin,
          createdAt: ownerUser.createdAt,
        },
      };
    });
  }

  /**
   * Self onboarding (only allowed if ALLOW_SELF_ONBOARDING === "true")
   */
  async onboardRestaurant(data: {
    restaurantName: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    adminEmail: string;
    adminPassword: string;
    adminFirstName: string;
    adminLastName: string;
    adminPin?: string;
    adminPhone?: string;
  }) {
    const { restaurant, owner } = await this.createTenantWithStarterData({
      businessName: data.restaurantName,
      address: data.address,
      phone: data.phone,
      businessEmail: data.email,
      timezone: data.timezone,
      ownerFirstName: data.adminFirstName,
      ownerLastName: data.adminLastName,
      ownerEmail: data.adminEmail,
      ownerPhone: data.adminPhone || data.phone,
      ownerPassword: data.adminPassword,
      ownerPin: data.adminPin,
    });

    const permissions = [...ALL_PERMISSIONS];
    const { accessToken, refreshToken } = this.generateTokens({
      id: owner.id,
      email: owner.email,
      role: owner.role,
      roleId: owner.roleId,
      restaurantId: restaurant.id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      permissions,
    });

    await this.saveRefreshToken(owner.id, refreshToken);

    return {
      message: 'Restaurant onboarded successfully',
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        phone: restaurant.phone,
        email: restaurant.email,
        logoUrl: restaurant.logoUrl,
      },
      user: {
        id: owner.id,
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        role: owner.role,
        roleId: owner.roleId,
        roleName: 'Owner',
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        restaurantLogoUrl: restaurant.logoUrl,
        permissions,
        features: await getEnabledFeatures(restaurant.id),
        isOwnerRole: true,
        isPlatform: false,
      },
      accessToken,
      refreshToken,
    };
  }

  async login(
    identifier: string,
    password: string,
    businessCode?: string,
    ip = '0.0.0.0'
  ) {
    if (!identifier || !password) {
      throw new Error('Email/username and password are required');
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const lockKey = (businessCode || cleanIdentifier).trim().toLowerCase();
    attemptLockService.assertNotLocked(lockKey, ip);

    let restaurant: any = null;
    if (businessCode && businessCode.trim()) {
      restaurant = await prisma.restaurant.findFirst({
        where: {
          OR: [
            { slug: businessCode.trim().toLowerCase() },
            { id: businessCode.trim() },
          ],
        },
      });
      if (!restaurant) {
        attemptLockService.recordFailure(lockKey, ip);
        throw new Error('Restaurant not found with the specified code');
      }
    }

    const whereClause: any = {
      isActive: true,
      OR: [
        { email: cleanIdentifier },
        { username: cleanIdentifier },
      ],
    };

    if (restaurant) {
      whereClause.restaurantId = restaurant.id;
    }

    const user = await prisma.employee.findFirst({
      where: whereClause,
      include: {
        restaurant: true,
        roleRecord: {
          include: {
            permissions: true,
          },
        },
        permissionOverrides: true,
      },
    });

    if (!user || !user.isActive) {
      attemptLockService.recordFailure(lockKey, ip);
      throw new Error('Invalid credentials');
    }

    if (!user.restaurant || !user.restaurant.isActive) {
      throw new Error('Business account suspended. Please contact platform support.');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      attemptLockService.recordFailure(lockKey, ip);
      throw new Error('Invalid credentials');
    }

    attemptLockService.recordSuccess(lockKey, ip);

    const isOwner = user.roleRecord
      ? user.roleRecord.isOwnerRole === true
      : user.role === 'OWNER';

    let permissions: string[];
    if (isOwner) {
      permissions = [...ALL_PERMISSIONS];
    } else {
      let basePerms: string[] = [];
      if (user.roleRecord) {
        basePerms = (user.roleRecord.permissions || []).map((p) => p.permission);
      } else {
        const sysRole = DEFAULT_SYSTEM_ROLES.find(
          (r) => r.key.toUpperCase() === (user.role || '').toUpperCase()
        );
        basePerms = sysRole ? [...sysRole.permissions] : [];
      }
      const permSet = new Set<string>(basePerms);
      for (const override of user.permissionOverrides || []) {
        if (override.granted) {
          permSet.add(override.permission);
        } else {
          permSet.delete(override.permission);
        }
      }
      permissions = Array.from(permSet);
    }

    const enabledFeatures = await getEnabledFeatures(user.restaurantId);
    const effectivePermissions = filterPermissionsByFeatures(permissions, enabledFeatures);

    const { accessToken, refreshToken } = this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      roleId: user.roleId || undefined,
      restaurantId: user.restaurantId,
      firstName: user.firstName,
      lastName: user.lastName,
      permissions: effectivePermissions,
    });

    await this.saveRefreshToken(user.id, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        roleId: user.roleId || undefined,
        roleName: user.roleRecord?.name || user.role,
        restaurantId: user.restaurantId,
        restaurantName: user.restaurant.name,
        restaurantSlug: user.restaurant.slug,
        restaurantLogoUrl: user.restaurant.logoUrl,
        themePalette: user.restaurant.themePalette || 'espresso',
        themeMode: user.restaurant.themeMode || 'dark',
        permissions: effectivePermissions,
        features: enabledFeatures,
        isOwnerRole: isOwner,
        isPlatform: false,
      },
      accessToken,
      refreshToken,
    };
  }

  async loginWithPin(
    pin: string,
    tenantIdentifier: { tenantSlug?: string; restaurantId?: string; businessCode?: string },
    ip = '0.0.0.0'
  ) {
    const { tenantSlug, restaurantId, businessCode } = tenantIdentifier;
    const identifier = tenantSlug || businessCode || restaurantId;

    if (!identifier || !identifier.trim()) {
      throw new Error('Tenant identifier (restaurant code or ID) is required for PIN login');
    }

    const cleanPin = pin ? pin.trim() : '';
    if (!cleanPin) {
      throw new Error('PIN is required');
    }

    const lockKey = identifier.trim().toLowerCase();
    attemptLockService.assertNotLocked(lockKey, ip);

    // Resolve tenant
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        OR: [
          { slug: identifier.trim().toLowerCase() },
          { id: identifier.trim() },
        ],
      },
    });

    if (!restaurant) {
      attemptLockService.recordFailure(lockKey, ip);
      throw new Error('Restaurant not found with the specified code');
    }

    if (!restaurant.isActive) {
      throw new Error('Business account suspended. Please contact platform support.');
    }

    // Find active employees within that tenant matching the PIN
    const candidates = await prisma.employee.findMany({
      where: {
        restaurantId: restaurant.id,
        isActive: true,
      },
      include: {
        roleRecord: {
          include: {
            permissions: true,
          },
        },
        permissionOverrides: true,
      },
    });

    let matchedUser: any = null;
    for (const cand of candidates) {
      if (!cand.pin) continue;
      const isMatch = (await bcrypt.compare(cleanPin, cand.pin).catch(() => false)) || cand.pin === cleanPin;
      if (isMatch) {
        matchedUser = cand;
        break;
      }
    }

    if (!matchedUser) {
      attemptLockService.recordFailure(lockKey, ip);
      throw new Error('Invalid PIN or staff account not found');
    }

    attemptLockService.recordSuccess(lockKey, ip);
    const user = matchedUser;

    const isOwner = user.roleRecord
      ? user.roleRecord.isOwnerRole === true
      : user.role === 'OWNER';

    let permissions: string[];
    if (isOwner) {
      permissions = [...ALL_PERMISSIONS];
    } else {
      let basePerms: string[] = [];
      if (user.roleRecord) {
        basePerms = (user.roleRecord.permissions || []).map((p) => p.permission);
      } else {
        const sysRole = DEFAULT_SYSTEM_ROLES.find(
          (r) => r.key.toUpperCase() === (user.role || '').toUpperCase()
        );
        basePerms = sysRole ? [...sysRole.permissions] : [];
      }
      const permSet = new Set<string>(basePerms);
      for (const override of user.permissionOverrides || []) {
        if (override.granted) {
          permSet.add(override.permission);
        } else {
          permSet.delete(override.permission);
        }
      }
      permissions = Array.from(permSet);
    }

    const enabledFeatures = await getEnabledFeatures(restaurant.id);
    const effectivePermissions = filterPermissionsByFeatures(permissions, enabledFeatures);

    const { accessToken, refreshToken } = this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      roleId: user.roleId || undefined,
      restaurantId: restaurant.id,
      firstName: user.firstName,
      lastName: user.lastName,
      permissions: effectivePermissions,
    });

    await this.saveRefreshToken(user.id, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        roleId: user.roleId || undefined,
        roleName: user.roleRecord?.name || user.role,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        restaurantLogoUrl: restaurant.logoUrl,
        themePalette: restaurant.themePalette || 'espresso',
        themeMode: restaurant.themeMode || 'dark',
        permissions: effectivePermissions,
        features: enabledFeatures,
        isOwnerRole: isOwner,
        isPlatform: false,
      },
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, this.JWT_REFRESH_SECRET) as any;

      if (!decoded || !decoded.id) {
        throw new Error('Invalid refresh token');
      }

      const storedToken = await prisma.refreshToken.findFirst({
        where: {
          token: refreshToken,
          employeeId: decoded.id,
          expiresAt: { gt: new Date() },
        },
      });

      if (!storedToken) {
        throw new Error('Invalid refresh token');
      }

      const user = await prisma.employee.findUnique({
        where: { id: decoded.id },
        include: {
          restaurant: true,
          roleRecord: {
            include: { permissions: true },
          },
          permissionOverrides: true,
        },
      });

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      if (!user.restaurant || !user.restaurant.isActive) {
        throw new Error('Business account suspended');
      }

      const isSupportActive = Boolean(decoded.supportMode);
      const isOwner = isSupportActive
        ? true
        : user.roleRecord
        ? user.roleRecord.isOwnerRole === true
        : user.role === 'OWNER';

      let permissions: string[];
      if (isOwner) {
        permissions = [...ALL_PERMISSIONS];
      } else {
        let basePerms: string[] = [];
        if (user.roleRecord) {
          basePerms = (user.roleRecord.permissions || []).map((p) => p.permission);
        } else {
          const sysRole = DEFAULT_SYSTEM_ROLES.find(
            (r) => r.key.toUpperCase() === (user.role || '').toUpperCase()
          );
          basePerms = sysRole ? [...sysRole.permissions] : [];
        }
        const permSet = new Set<string>(basePerms);
        for (const override of user.permissionOverrides || []) {
          if (override.granted) {
            permSet.add(override.permission);
          } else {
            permSet.delete(override.permission);
          }
        }
        permissions = Array.from(permSet);
      }

      const { accessToken } = this.generateTokens({
        id: user.id,
        email: user.email,
        role: user.role,
        roleId: user.roleId || undefined,
        restaurantId: user.restaurantId,
        firstName: user.firstName,
        lastName: user.lastName,
        permissions,
      });

      // Keep the refresh token stable. Rotating it from multiple browser tabs
      // can invalidate a reload while another tab is still using the old token.

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          roleId: user.roleId || undefined,
          roleName: user.roleRecord?.name || user.role,
          restaurantId: user.restaurantId,
          restaurantName: user.restaurant.name,
          restaurantSlug: user.restaurant.slug,
          restaurantLogoUrl: user.restaurant.logoUrl,
          themePalette: user.restaurant.themePalette || 'espresso',
          themeMode: user.restaurant.themeMode || 'dark',
          permissions,
          features: await getEnabledFeatures(user.restaurantId),
          isOwnerRole: isOwner,
          isPlatform: false,
        },
      };
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as any;
      if (decoded.tokenUse === 'platform' || decoded.isPlatform) {
        throw new Error('Platform token cannot be verified as tenant token');
      }

      const user = await prisma.employee.findUnique({
        where: { id: decoded.id },
        include: {
          restaurant: true,
          roleRecord: {
            include: { permissions: true },
          },
        },
      });

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      if (!user.restaurant || !user.restaurant.isActive) {
        throw new Error('Business account suspended');
      }

      if (decoded.supportMode) {
        if (!decoded.impersonatedBy) {
          throw new Error('Invalid support impersonation token');
        }
        const platformUser = await prisma.platformUser.findUnique({
          where: { id: decoded.impersonatedBy },
        });
        if (
          !platformUser ||
          !platformUser.isActive ||
          !['SUPPORT', 'SUPER_ADMIN'].includes(platformUser.role)
        ) {
          throw new Error('Support access revoked');
        }
      }

      const isSupportActive = Boolean(decoded.supportMode);
      const isOwner = isSupportActive
        ? true
        : user.roleRecord
        ? user.roleRecord.isOwnerRole === true
        : user.role === 'OWNER';

      let permissions: string[];
      if (isOwner) {
        permissions = [...ALL_PERMISSIONS];
      } else if (user.roleRecord) {
        permissions = (user.roleRecord.permissions || []).map((p) => p.permission);
      } else {
        const sysRole = DEFAULT_SYSTEM_ROLES.find(
          (r) => r.key.toUpperCase() === (user.role || '').toUpperCase()
        );
        permissions = sysRole ? [...sysRole.permissions] : [];
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        roleId: user.roleId || undefined,
        roleName: user.roleRecord?.name || user.role,
        restaurantId: user.restaurantId,
        restaurantName: user.restaurant?.name,
        restaurantSlug: user.restaurant?.slug,
        restaurantLogoUrl: user.restaurant?.logoUrl,
        permissions,
        supportMode: Boolean(decoded.supportMode),
        impersonatedBy: decoded.impersonatedBy,
        isPlatform: false,
      };
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  private generateTokens(payload: {
    id: string;
    email: string;
    role: string;
    roleId?: string;
    restaurantId: string;
    firstName?: string;
    lastName?: string;
    permissions?: string[];
  }) {
    const tokenPayload = {
      ...payload,
      tokenUse: 'tenant',
    };

    const accessToken = jwt.sign(tokenPayload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    } as jwt.SignOptions);

    const refreshToken = jwt.sign(
      { id: payload.id, tokenUse: 'tenant', jti: crypto.randomUUID() },
      this.JWT_REFRESH_SECRET,
      {
        expiresIn: this.JWT_REFRESH_EXPIRES_IN,
      } as jwt.SignOptions
    );

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(employeeId: string, token: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token,
        employeeId,
        expiresAt,
      },
    });
  }
}
