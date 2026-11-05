import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthService } from './auth.service';
import { ALL_PERMISSIONS, slugify } from '../permissions';
import { getEnabledFeatures } from './feature.service';
import { JWT_SECRET, JWT_PLATFORM_SECRET, JWT_REFRESH_SECRET } from '../config/secrets';
import { validateLogo } from '../utils/validateLogo';

const prisma = new PrismaClient();
const authService = new AuthService();

export class PlatformService {
  async logPlatformAction(data: {
    platformUserId: string;
    restaurantId?: string;
    action: string;
    details?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      await prisma.platformAuditLog.create({
        data: {
          platformUserId: data.platformUserId,
          restaurantId: data.restaurantId || null,
          action: data.action,
          details: data.details || null,
          ipAddress: data.ipAddress || null,
          userAgent: data.userAgent || null,
        },
      });
    } catch (e) {
      console.error('[PlatformAuditLog Error]', e);
    }
  }

  async login(email: string, password: string, reqContext?: { ip?: string; userAgent?: string }) {
    const emailNorm = email.trim().toLowerCase();
    const platformUser = await prisma.platformUser.findUnique({
      where: { email: emailNorm },
    });

    if (!platformUser || !platformUser.isActive) {
      throw new Error('Invalid platform credentials');
    }

    const validPassword = await bcrypt.compare(password, platformUser.passwordHash);
    if (!validPassword) {
      throw new Error('Invalid platform credentials');
    }

    const secret = JWT_PLATFORM_SECRET;
    const tokenPayload = {
      id: platformUser.id,
      name: platformUser.name,
      email: platformUser.email,
      role: platformUser.role,
      isPlatform: true,
      tokenUse: 'platform',
    };

    const accessToken = jwt.sign(tokenPayload, secret, { expiresIn: '12h' });

    // Refresh token
    const refreshTokenSecret = JWT_REFRESH_SECRET;
    const refreshToken = jwt.sign(
      { id: platformUser.id, isPlatform: true, tokenUse: 'platform', jti: crypto.randomUUID() },
      refreshTokenSecret,
      { expiresIn: '30d' }
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.platformRefreshToken.create({
      data: {
        token: refreshToken,
        platformUserId: platformUser.id,
        expiresAt,
      },
    });

    await this.logPlatformAction({
      platformUserId: platformUser.id,
      action: 'PLATFORM_LOGIN',
      details: `Successful login as ${platformUser.role}`,
      ipAddress: reqContext?.ip,
      userAgent: reqContext?.userAgent,
    });

    return {
      user: {
        id: platformUser.id,
        name: platformUser.name,
        email: platformUser.email,
        role: platformUser.role,
        isPlatform: true,
      },
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const refreshTokenSecret = JWT_REFRESH_SECRET;
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, refreshTokenSecret);
    } catch {
      throw new Error('Invalid platform refresh token');
    }

    if (!decoded || !decoded.id || decoded.tokenUse !== 'platform') {
      throw new Error('Invalid platform refresh token payload');
    }

    const stored = await prisma.platformRefreshToken.findFirst({
      where: {
        token: refreshToken,
        platformUserId: decoded.id,
        expiresAt: { gt: new Date() },
      },
    });

    if (!stored) {
      throw new Error('Platform refresh token expired or revoked');
    }

    const platformUser = await prisma.platformUser.findUnique({
      where: { id: decoded.id },
    });

    if (!platformUser || !platformUser.isActive) {
      throw new Error('Platform account suspended');
    }

    const secret = JWT_PLATFORM_SECRET;
    const accessToken = jwt.sign(
      {
        id: platformUser.id,
        name: platformUser.name,
        email: platformUser.email,
        role: platformUser.role,
        isPlatform: true,
        tokenUse: 'platform',
      },
      secret,
      { expiresIn: '12h' }
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: platformUser.id,
        name: platformUser.name,
        email: platformUser.email,
        role: platformUser.role,
        isPlatform: true,
      },
    };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    await prisma.platformRefreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async listRestaurants() {
    const restaurants = await prisma.restaurant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        employees: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    });

    return restaurants.map((r) => {
      // Find owner employee
      const owner =
        r.employees.find((e) => e.role === 'OWNER' || e.role === 'ADMIN') ||
        r.employees[0] ||
        null;

      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        logoUrl: r.logoUrl,
        isActive: r.isActive,
        address: r.address,
        phone: r.phone,
        email: r.email,
        timezone: r.timezone,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        userCount: r.employees.length,
        owner: owner
          ? {
              id: owner.id,
              name: `${owner.firstName} ${owner.lastName}`,
              firstName: owner.firstName,
              lastName: owner.lastName,
              email: owner.email,
              phone: owner.phone,
              role: owner.role,
            }
          : null,
      };
    });
  }

  async createRestaurant(
    data: {
      businessName: string;
      address?: string;
      phone?: string;
      businessEmail?: string;
      timezone?: string;
      logoUrl?: string;
      ownerFirstName: string;
      ownerLastName: string;
      ownerEmail: string;
      ownerPhone?: string;
      ownerPassword: string;
      ownerPin?: string;
    },
    platformUserId: string,
    reqContext?: { ip?: string; userAgent?: string }
  ) {
    if (data.logoUrl) {
      const check = validateLogo(data.logoUrl);
      if (!check.valid) {
        throw new Error(check.error || 'Invalid logo image');
      }
    }

    const result = await authService.createTenantWithStarterData({
      ...data,
      createdByPlatformUserId: platformUserId,
    });

    await this.logPlatformAction({
      platformUserId,
      restaurantId: result.restaurant.id,
      action: 'TENANT_CREATED',
      details: `Created tenant "${result.restaurant.name}" (slug: ${result.restaurant.slug}) with owner ${result.owner.email}`,
      ipAddress: reqContext?.ip,
      userAgent: reqContext?.userAgent,
    });

    return result;
  }

  async updateRestaurant(
    id: string,
    data: {
      name?: string;
      slug?: string;
      address?: string;
      phone?: string;
      email?: string;
      timezone?: string;
      logoUrl?: string;
      isActive?: boolean;
    },
    platformUserId: string,
    reqContext?: { ip?: string; userAgent?: string }
  ) {
    const existing = await prisma.restaurant.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error('Restaurant not found');
    }

    if (data.logoUrl !== undefined && data.logoUrl !== null && data.logoUrl !== '') {
      const check = validateLogo(data.logoUrl);
      if (!check.valid) {
        throw new Error(check.error || 'Invalid logo image');
      }
    }

    const updatePayload: any = {};
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.address !== undefined) updatePayload.address = data.address.trim();
    if (data.phone !== undefined) updatePayload.phone = data.phone.trim();
    if (data.email !== undefined) updatePayload.email = data.email.trim();
    if (data.timezone !== undefined) updatePayload.timezone = data.timezone.trim();
    if (data.logoUrl !== undefined) updatePayload.logoUrl = data.logoUrl;
    if (data.isActive !== undefined) updatePayload.isActive = Boolean(data.isActive);

    if (data.slug !== undefined && data.slug.trim() && data.slug !== existing.slug) {
      const slugCandidate = slugify(data.slug);
      const conflict = await prisma.restaurant.findFirst({
        where: { slug: slugCandidate, id: { not: id } },
      });
      if (conflict) {
        throw new Error('Slug is already taken by another restaurant');
      }
      updatePayload.slug = slugCandidate;
    }

    const updated = await prisma.restaurant.update({
      where: { id },
      data: updatePayload,
    });

    let action = 'TENANT_UPDATED';
    if (data.isActive !== undefined && data.isActive !== existing.isActive) {
      action = data.isActive ? 'TENANT_ACTIVATED' : 'TENANT_SUSPENDED';
    }

    await this.logPlatformAction({
      platformUserId,
      restaurantId: id,
      action,
      details: `Updated restaurant ${updated.name}. Status: ${updated.isActive ? 'ACTIVE' : 'SUSPENDED'}`,
      ipAddress: reqContext?.ip,
      userAgent: reqContext?.userAgent,
    });

    return updated;
  }

  async resetOwnerPassword(
    restaurantId: string,
    newPassword: string,
    platformUserId: string,
    reqContext?: { ip?: string; userAgent?: string }
  ) {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }

    const owner = await prisma.employee.findFirst({
      where: {
        restaurantId,
        OR: [{ role: 'OWNER' }, { role: 'ADMIN' }],
      },
    });

    if (!owner) {
      throw new Error('No owner employee found for this restaurant');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.employee.update({
      where: { id: owner.id },
      data: { passwordHash },
    });

    await this.logPlatformAction({
      platformUserId,
      restaurantId,
      action: 'OWNER_PASSWORD_RESET',
      details: `Reset password for owner account ${owner.email}`,
      ipAddress: reqContext?.ip,
      userAgent: reqContext?.userAgent,
    });

    return { message: 'Owner password reset successfully' };
  }

  async enterTenant(
    restaurantId: string,
    platformUser: { id: string; name: string; role: string },
    reason?: string,
    reqContext?: { ip?: string; userAgent?: string }
  ) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        roles: true,
      },
    });

    if (!restaurant) {
      throw new Error('Tenant restaurant not found');
    }

    if (!restaurant.isActive) {
      throw new Error('Cannot enter suspended tenant');
    }

    // Find OWNER employee
    const owner =
      (await prisma.employee.findFirst({
        where: {
          restaurantId,
          role: 'OWNER',
        },
        include: { roleRecord: true },
      })) ||
      (await prisma.employee.findFirst({
        where: {
          restaurantId,
        },
        include: { roleRecord: true },
      }));

    if (!owner) {
      throw new Error('No employee account exists to impersonate in this tenant');
    }

    const ownerRoleId =
      owner.roleId ||
      restaurant.roles.find((r) => r.isOwnerRole || r.key === 'OWNER')?.id;

    // Issue short-lived 2h tenant impersonation token
    const impersonationPayload = {
      id: owner.id,
      email: owner.email,
      role: 'OWNER',
      roleId: ownerRoleId,
      restaurantId: restaurant.id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      permissions: [...ALL_PERMISSIONS],
      impersonatedBy: platformUser.id,
      supportMode: true,
      tokenUse: 'tenant',
    };

    const accessToken = jwt.sign(impersonationPayload, JWT_SECRET, {
      expiresIn: '2h',
    });

    await this.logPlatformAction({
      platformUserId: platformUser.id,
      restaurantId: restaurant.id,
      action: 'TENANT_ENTER',
      details: `Platform user ${platformUser.name} (${platformUser.role}) entered tenant "${restaurant.name}". Reason: ${reason || 'Technical support / inspection'}`,
      ipAddress: reqContext?.ip,
      userAgent: reqContext?.userAgent,
    });

    return {
      accessToken,
      user: {
        id: owner.id,
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        role: 'OWNER',
        roleId: ownerRoleId,
        roleName: 'Owner',
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        restaurantLogoUrl: restaurant.logoUrl,
        permissions: [...ALL_PERMISSIONS],
        features: await getEnabledFeatures(restaurant.id),
        isOwnerRole: true,
        supportMode: true,
        impersonatedBy: platformUser.id,
        isPlatform: false,
      },
      tenant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        logoUrl: restaurant.logoUrl,
      },
    };
  }

  async upsertSupportAccount(
    data: {
      name?: string;
      email: string;
      password?: string;
      isActive?: boolean;
    },
    platformUserId: string,
    reqContext?: { ip?: string; userAgent?: string }
  ) {
    const emailNorm = data.email.trim().toLowerCase();

    // Check existing support accounts
    const existingSupport = await prisma.platformUser.findFirst({
      where: { role: 'SUPPORT' },
    });

    let updatedOrCreated: any;

    if (existingSupport) {
      const updateData: any = {};
      if (data.name) updateData.name = data.name.trim();
      if (data.email) updateData.email = emailNorm;
      if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);
      if (data.password && data.password.trim()) {
        updateData.passwordHash = await bcrypt.hash(data.password.trim(), 10);
      }

      updatedOrCreated = await prisma.platformUser.update({
        where: { id: existingSupport.id },
        data: updateData,
        select: { id: true, name: true, email: true, role: true, isActive: true, updatedAt: true },
      });
    } else {
      if (!data.password || data.password.length < 6) {
        throw new Error('Password of at least 6 characters required when creating support account');
      }
      const passwordHash = await bcrypt.hash(data.password.trim(), 10);
      updatedOrCreated = await prisma.platformUser.create({
        data: {
          name: data.name?.trim() || 'Global Support',
          email: emailNorm,
          passwordHash,
          role: 'SUPPORT',
          isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
        },
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      });
    }

    await this.logPlatformAction({
      platformUserId,
      action: 'SUPPORT_ACCOUNT_UPDATED',
      details: `Support account configured: ${updatedOrCreated.email} (active: ${updatedOrCreated.isActive})`,
      ipAddress: reqContext?.ip,
      userAgent: reqContext?.userAgent,
    });

    return updatedOrCreated;
  }

  async getAuditLogs(options?: { page?: number; limit?: number; restaurantId?: string; action?: string }) {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options?.restaurantId) where.restaurantId = options.restaurantId;
    if (options?.action) where.action = options.action;

    const [totalCount, logs] = await Promise.all([
      prisma.platformAuditLog.count({ where }),
      prisma.platformAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          platformUser: {
            select: { id: true, name: true, email: true, role: true },
          },
          restaurant: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
    ]);

    return {
      data: logs,
      page,
      limit,
      totalCount,
      hasMore: page * limit < totalCount,
    };
  }
}
