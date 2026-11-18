import { Prisma, PrismaClient } from '@prisma/client';
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

// Fields that must never appear in a tenant data export, even if a future
// schema change adds them to another table.
const EXPORT_EXCLUDED_FIELDS = new Set(['pin', 'passwordHash', 'token']);

// Platform tables and tenant refresh tokens are never exported.
const EXPORT_README_NOTICE = [
  'Excluded tables: PlatformUser, PlatformRefreshToken, PlatformAuditLog, RefreshToken.',
  'Excluded fields: Employee.pin, Employee.passwordHash, any field named token.',
].join('\n');

interface TenantExportTable {
  file: string;
  model: string;
  find: (db: any, restaurantId: string) => Promise<any[]>;
}

/**
 * Every entry is scoped to one restaurant. Tables without a restaurantId use
 * a relation filter so a row can only be exported through its tenant parent.
 */
const TENANT_EXPORT_TABLES: TenantExportTable[] = [
  { file: 'restaurants', model: 'Restaurant', find: (db, id) => db.restaurant.findMany({ where: { id } }) },
  { file: 'tenant_features', model: 'TenantFeature', find: (db, id) => db.tenantFeature.findMany({ where: { restaurantId: id } }) },
  { file: 'floor_plans', model: 'FloorPlan', find: (db, id) => db.floorPlan.findMany({ where: { restaurantId: id } }) },
  { file: 'tables', model: 'Table', find: (db, id) => db.table.findMany({ where: { floorPlan: { restaurantId: id } } }) },
  { file: 'employees', model: 'Employee', find: (db, id) => db.employee.findMany({ where: { restaurantId: id } }) },
  { file: 'employee_permissions', model: 'EmployeePermission', find: (db, id) => db.employeePermission.findMany({ where: { employee: { restaurantId: id } } }) },
  { file: 'time_entries', model: 'TimeEntry', find: (db, id) => db.timeEntry.findMany({ where: { restaurantId: id } }) },
  { file: 'categories', model: 'Category', find: (db, id) => db.category.findMany({ where: { restaurantId: id } }) },
  { file: 'menu_items', model: 'MenuItem', find: (db, id) => db.menuItem.findMany({ where: { restaurantId: id } }) },
  { file: 'modifier_groups', model: 'ModifierGroup', find: (db, id) => db.modifierGroup.findMany({ where: { menuItem: { restaurantId: id } } }) },
  { file: 'modifiers', model: 'Modifier', find: (db, id) => db.modifier.findMany({ where: { modifierGroup: { menuItem: { restaurantId: id } } } }) },
  { file: 'deals', model: 'Deal', find: (db, id) => db.deal.findMany({ where: { restaurantId: id } }) },
  { file: 'deal_items', model: 'DealItem', find: (db, id) => db.dealItem.findMany({ where: { deal: { restaurantId: id } } }) },
  { file: 'orders', model: 'Order', find: (db, id) => db.order.findMany({ where: { restaurantId: id } }) },
  { file: 'customers', model: 'Customer', find: (db, id) => db.customer.findMany({ where: { restaurantId: id } }) },
  { file: 'customer_ledger_entries', model: 'CustomerLedgerEntry', find: (db, id) => db.customerLedgerEntry.findMany({ where: { restaurantId: id } }) },
  { file: 'order_items', model: 'OrderItem', find: (db, id) => db.orderItem.findMany({ where: { order: { restaurantId: id } } }) },
  { file: 'order_item_modifiers', model: 'OrderItemModifier', find: (db, id) => db.orderItemModifier.findMany({ where: { orderItem: { order: { restaurantId: id } } } }) },
  { file: 'web_orders', model: 'WebOrder', find: (db, id) => db.webOrder.findMany({ where: { restaurantId: id } }) },
  { file: 'web_order_items', model: 'WebOrderItem', find: (db, id) => db.webOrderItem.findMany({ where: { webOrder: { restaurantId: id } } }) },
  { file: 'payments', model: 'Payment', find: (db, id) => db.payment.findMany({ where: { order: { restaurantId: id } } }) },
  { file: 'inventory_items', model: 'InventoryItem', find: (db, id) => db.inventoryItem.findMany({ where: { restaurantId: id } }) },
  { file: 'menu_item_ingredients', model: 'MenuItemIngredient', find: (db, id) => db.menuItemIngredient.findMany({ where: { menuItem: { restaurantId: id } } }) },
  { file: 'inventory_transactions', model: 'InventoryTransaction', find: (db, id) => db.inventoryTransaction.findMany({ where: { inventoryItem: { restaurantId: id } } }) },
  { file: 'order_modifications', model: 'OrderModification', find: (db, id) => db.orderModification.findMany({ where: { order: { restaurantId: id } } }) },
  { file: 'roles', model: 'Role', find: (db, id) => db.role.findMany({ where: { restaurantId: id } }) },
  { file: 'role_permissions', model: 'RolePermission', find: (db, id) => db.rolePermission.findMany({ where: { role: { restaurantId: id } } }) },
  { file: 'expense_categories', model: 'ExpenseCategory', find: (db, id) => db.expenseCategory.findMany({ where: { restaurantId: id } }) },
  { file: 'expenses', model: 'Expense', find: (db, id) => db.expense.findMany({ where: { restaurantId: id } }) },
  { file: 'recurring_expenses', model: 'RecurringExpense', find: (db, id) => db.recurringExpense.findMany({ where: { restaurantId: id } }) },
  { file: 'payroll_settings', model: 'PayrollSettings', find: (db, id) => db.payrollSettings.findMany({ where: { restaurantId: id } }) },
  { file: 'employee_advances', model: 'EmployeeAdvance', find: (db, id) => db.employeeAdvance.findMany({ where: { restaurantId: id } }) },
  { file: 'payroll_runs', model: 'PayrollRun', find: (db, id) => db.payrollRun.findMany({ where: { restaurantId: id } }) },
  { file: 'payroll_lines', model: 'PayrollLine', find: (db, id) => db.payrollLine.findMany({ where: { payrollRun: { restaurantId: id } } }) },
];

function exportFieldsForModel(model: string): string[] {
  const datamodel: any = (Prisma as any).dmmf?.datamodel;
  const definition = datamodel?.models?.find((entry: any) => entry.name === model);
  const fields: string[] = (definition?.fields || [])
    .filter((field: any) => field.kind === 'scalar' || field.kind === 'enum')
    .map((field: any) => field.name as string);
  return fields.filter((field) => !EXPORT_EXCLUDED_FIELDS.has(field));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else if (typeof value === 'string') {
    // Neutralise spreadsheet formula injection for user-supplied text.
    text = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  } else {
    return String(value);
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildTenantCsv(model: string, rows: any[]): string {
  const fields = exportFieldsForModel(model);
  const lines = [fields.join(',')];
  for (const row of rows) {
    lines.push(fields.map((field) => csvCell(row?.[field])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export interface TenantExportFile {
  name: string;
  content: string;
}

export async function collectTenantExportData(
  restaurantId: string,
  db: any = prisma
): Promise<{ files: TenantExportFile[]; counts: Record<string, number>; totalRows: number }> {
  const files: TenantExportFile[] = [];
  const counts: Record<string, number> = {};
  let totalRows = 0;

  for (const table of TENANT_EXPORT_TABLES) {
    const rows = await table.find(db, restaurantId);
    counts[table.file] = rows.length;
    totalRows += rows.length;
    files.push({ name: `${table.file}.csv`, content: buildTenantCsv(table.model, rows) });
  }

  files.unshift({
    name: 'README.txt',
    content: [
      'Tenant business-data export',
      `Restaurant ID: ${restaurantId}`,
      `Generated (UTC): ${new Date().toISOString()}`,
      `Tables: ${TENANT_EXPORT_TABLES.length}`,
      `Total rows: ${totalRows}`,
      '',
      EXPORT_README_NOTICE,
      '',
      'Row counts:',
      ...Object.entries(counts).map(([name, count]) => `  ${name}.csv: ${count}`),
      '',
    ].join('\r\n'),
  });

  return { files, counts, totalRows };
}

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

  /** Writes a sensitive-action audit record and fails closed if it cannot be saved. */
  async recordSensitiveAudit(data: {
    platformUserId: string;
    restaurantId?: string;
    action: string;
    details?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
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
  }

  async verifyPlatformPassword(platformUserId: string, password: string): Promise<boolean> {
    const user = await prisma.platformUser.findUnique({
      where: { id: platformUserId },
      select: { isActive: true, passwordHash: true },
    });
    if (!user || !user.isActive) return false;
    return bcrypt.compare(password, user.passwordHash);
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
        tenantFeatures: true,
      },
    });

    const now = new Date();
    return restaurants.map((r) => {
      // Find owner employee
      const owner =
        r.employees.find((e) => e.role === 'OWNER' || e.role === 'ADMIN') ||
        r.employees[0] ||
        null;

      const enabledFeatures = ((r as any).tenantFeatures || [])
        .filter((f: any) => f.enabled && (!f.expiresAt || new Date(f.expiresAt) > now))
        .map((f: any) => f.featureKey);

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
        enabledFeatures,
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
      features?: Array<{ key: string; enabled: boolean; expiresAt?: string | Date | null }> | string[];
      featureExpiresAt?: string | Date | null;
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
