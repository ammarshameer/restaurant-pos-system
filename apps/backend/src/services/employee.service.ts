import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PERMISSIONS, ALL_PERMISSIONS, DEFAULT_SYSTEM_ROLES } from '../permissions';
import { attemptLockService } from './attempt-lock.service';
import { ValidationError } from '../lib/errors';

export type EmployeeRole = 'OWNER' | 'MANAGER' | 'CHEF' | 'WAITER' | 'CASHIER' | string;

const prisma = new PrismaClient();

const FORBIDDEN_STAFF_ROLE_KEYS = ['SUPER_ADMIN', 'SUPPORT'];

export class EmployeeService {
  async generateUniquePin(restaurantId: string, digits = 4): Promise<string> {
    const min = digits === 6 ? 100000 : 1000;
    const max = digits === 6 ? 1000000 : 10000;

    const activeStaff = await prisma.employee.findMany({
      where: { restaurantId, isActive: true },
      select: { pin: true },
    });

    for (let attempt = 0; attempt < 25; attempt++) {
      const candidate = crypto.randomInt(min, max).toString();
      let hasConflict = false;
      for (const staff of activeStaff) {
        if (!staff.pin) continue;
        const matches = (await bcrypt.compare(candidate, staff.pin).catch(() => false)) || staff.pin === candidate;
        if (matches) {
          hasConflict = true;
          break;
        }
      }
      if (!hasConflict) {
        return candidate;
      }
    }
    throw new Error('Unable to generate unique PIN after multiple attempts. Please provide a PIN.');
  }

  async checkPinConflict(restaurantId: string, candidatePin: string, excludeEmployeeId?: string): Promise<boolean> {
    const activeStaff = await prisma.employee.findMany({
      where: {
        restaurantId,
        isActive: true,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      },
      select: { pin: true },
    });

    for (const staff of activeStaff) {
      if (!staff.pin) continue;
      const matches = (await bcrypt.compare(candidatePin, staff.pin).catch(() => false)) || staff.pin === candidatePin;
      if (matches) return true;
    }
    return false;
  }

  /**
   * Ensure a non-owner requester cannot hand out permissions they do not have
   * themselves. Owners and platform support bypass the ceiling.
   */
  private assertPermissionCeiling(
    requester: { isOwnerRole?: boolean; isPlatform?: boolean; supportMode?: boolean; permissions?: string[] } | undefined,
    permissions: string[],
    action = 'assign'
  ) {
    if (!requester || requester.isOwnerRole || requester.isPlatform || requester.supportMode) {
      return;
    }
    const requesterPermissions = new Set(requester.permissions || []);
    for (const permission of permissions) {
      if (permission === 'backups.manage' || !requesterPermissions.has(permission)) {
        throw Object.assign(
          new Error(`Cannot ${action} permissions above your own: ${permission}`),
          { statusCode: 403 }
        );
      }
    }
  }

  async getEmployees(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      role?: string;
      roleId?: string;
      isActive?: boolean;
      search?: string;
      canManage?: boolean;
    }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = { restaurantId };

    if (options?.role && options.role !== 'ALL' && options.role !== 'All') {
      whereClause.role = options.role;
    }

    if (options?.roleId) {
      whereClause.roleId = options.roleId;
    }

    if (options?.isActive !== undefined) {
      whereClause.isActive = options.isActive;
    }

    if (options?.search && options.search.trim()) {
      const q = options.search.trim();
      whereClause.OR = [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { email: { contains: q } },
        { username: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const [totalCount, employees] = await Promise.all([
      prisma.employee.count({ where: whereClause }),
      prisma.employee.findMany({
        where: whereClause,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          roleId: true,
          isActive: true,
          hourlyRate: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
          roleRecord: {
            select: {
              id: true,
              name: true,
              key: true,
              isOwnerRole: true,
            },
          },
        },
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      }),
    ]);

    // Strip PIN completely: PIN is secret and never shown in employee lists
    const sanitized = employees.map((emp) => {
      const { roleRecord, ...rest } = emp;
      return {
        ...rest,
        roleName: roleRecord?.name || rest.role,
        isOwner: roleRecord ? roleRecord.isOwnerRole === true : rest.role === 'OWNER',
      };
    });

    const hasMore = page * limit < totalCount;

    return {
      data: sanitized,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async getEmployee(id: string, restaurantId: string, canManage = false) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve an employee');
    }

    const emp = await prisma.employee.findFirst({
      where: {
        id,
        restaurantId,
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        isActive: true,
        hourlyRate: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        roleRecord: {
          select: {
            id: true,
            name: true,
            key: true,
            isOwnerRole: true,
          },
        },
      },
    });

    if (!emp) return null;

    const { roleRecord, ...rest } = emp;
    return {
      ...rest,
      roleName: roleRecord?.name || rest.role,
      isOwner: roleRecord ? roleRecord.isOwnerRole === true : rest.role === 'OWNER',
    };
  }

  async createEmployee(
    data: {
      email?: string;
      username?: string;
      password?: string;
      firstName: string;
      lastName: string;
      restaurantId: string;
      role?: string;
      roleId?: string;
      pin?: string;
      hourlyRate?: number;
      phone?: string;
      permissionOverrides?: Array<{ permission: string; granted: boolean }>;
    },
    requester?: { id: string; isOwnerRole?: boolean; role?: string; permissions?: string[] }
  ) {
    if (!data.restaurantId || !data.restaurantId.trim()) {
      throw new Error('restaurantId is required to create an employee');
    }

    let emailNorm: string | null = null;
    if (data.email && data.email.trim()) {
      emailNorm = data.email.trim().toLowerCase();
      // Prevent collision across PlatformUser and Employee
      const [existingPlatform, existingEmployee] = await Promise.all([
        prisma.platformUser.findUnique({ where: { email: emailNorm } }),
        prisma.employee.findUnique({ where: { email: emailNorm } }),
      ]);

      if (existingPlatform || existingEmployee) {
        throw new Error('An account with this email address already exists');
      }
    }

    let usernameNorm: string | null = null;
    if (data.username && data.username.trim()) {
      usernameNorm = data.username.trim().toLowerCase();
      const existingUsername = await prisma.employee.findFirst({
        where: { restaurantId: data.restaurantId, username: usernameNorm },
      });
      if (existingUsername) {
        throw new Error('An employee with this username already exists in this restaurant');
      }
    }

    // Resolve and validate role
    let targetRole: any = null;
    if (data.roleId) {
      targetRole = await prisma.role.findFirst({
        where: { id: data.roleId, restaurantId: data.restaurantId },
        include: { permissions: true },
      });
      if (!targetRole) {
        throw new Error('Specified role does not belong to your restaurant');
      }

      const targetPermissions = targetRole.permissions?.map((permission: any) => permission.permission) || [];
      const requesterPermissions = new Set(requester?.permissions || []);
      const elevated = targetPermissions.find((permission: string) =>
        permission === 'backups.manage' ||
        (!requester?.isOwnerRole && !requesterPermissions.has(permission))
      );
      if (!requester?.isOwnerRole && elevated) {
        throw Object.assign(new Error('Cannot assign permissions above the requester permission ceiling'), { statusCode: 403 });
      }
    } else if (data.role) {
      const candidateKey = data.role.trim().toUpperCase();
      targetRole = await prisma.role.findFirst({
        where: {
          restaurantId: data.restaurantId,
          OR: [{ key: candidateKey }, { name: data.role.trim() }],
        },
        include: { permissions: true },
      });
    }

    if (!targetRole) {
      // Fallback: look up WAITER or SERVER role
      targetRole = await prisma.role.findFirst({
        where: {
          restaurantId: data.restaurantId,
          key: { in: ['WAITER', 'SERVER'] },
        },
      });
    }

    if (!targetRole) {
      throw new Error('No valid role found for assignment');
    }

    // Never allow tenant staff creation of OWNER, SUPER_ADMIN, or SUPPORT
    if (
      targetRole.isOwnerRole ||
      targetRole.key === 'OWNER' ||
      FORBIDDEN_STAFF_ROLE_KEYS.includes(targetRole.key.toUpperCase())
    ) {
      throw new Error('Cannot assign Owner or Platform roles to staff members');
    }

    // Enforce the requester's permission ceiling for both role assignment and
    // explicit overrides. This used to only run for the roleId path.
    const rolePermissions: string[] =
      targetRole.permissions?.map((permission: any) => permission.permission) ||
      DEFAULT_SYSTEM_ROLES.find((r) => r.key.toUpperCase() === String(targetRole.key).toUpperCase())
        ?.permissions ||
      [];
    this.assertPermissionCeiling(requester, rolePermissions, 'assign');

    if (data.permissionOverrides && data.permissionOverrides.length > 0) {
      const validPermissions = new Set<string>(PERMISSIONS);
      for (const override of data.permissionOverrides) {
        if (!validPermissions.has(override.permission)) {
          throw Object.assign(new Error(`Invalid permission: ${override.permission}`), { statusCode: 400 });
        }
      }
      this.assertPermissionCeiling(
        requester,
        data.permissionOverrides.filter((o) => o.granted).map((o) => o.permission),
        'grant'
      );
    }

    const isManagerOrOwner =
      targetRole.isOwnerRole ||
      targetRole.key.toUpperCase() === 'OWNER' ||
      targetRole.key.toUpperCase() === 'MANAGER' ||
      String(targetRole.name).toLowerCase().includes('manager') ||
      String(targetRole.name).toLowerCase().includes('owner');

    // Resolve PIN: validate provided PIN or auto-generate unique PIN
    // Owner and Manager PINs must be 6 digits!
    let finalPin: string;
    if (data.pin && data.pin.trim()) {
      finalPin = data.pin.trim();
      if (isManagerOrOwner) {
        if (!/^\d{6}$/.test(finalPin)) {
          throw Object.assign(new Error('Owner and Manager PINs must be exactly 6 digits'), { statusCode: 400 });
        }
      } else {
        if (!/^\d{4,6}$/.test(finalPin)) {
          throw Object.assign(new Error('PIN must be 4 to 6 digits'), { statusCode: 400 });
        }
      }
      const pinConflict = await this.checkPinConflict(data.restaurantId, finalPin);
      if (pinConflict) {
        throw new Error('This PIN is already assigned to another staff member in your restaurant');
      }
    } else {
      finalPin = await this.generateUniquePin(data.restaurantId, isManagerOrOwner ? 6 : 4);
    }

    const hashedPin = await bcrypt.hash(finalPin, 10);

    // Set password hash: if omitted, generate an unguessable disabled hash
    const passwordHash =
      data.password && data.password.trim()
        ? await bcrypt.hash(data.password.trim(), 10)
        : await bcrypt.hash(`!NO_PASSWORD_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('hex')}`, 10);

    const employee = await prisma.employee.create({
      data: {
        email: emailNorm,
        username: usernameNorm,
        passwordHash,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        restaurantId: data.restaurantId,
        role: targetRole.key,
        roleId: targetRole.id,
        pin: hashedPin,
        hourlyRate: data.hourlyRate || null,
        phone: data.phone?.trim() || null,
        isActive: true,
        ...(data.permissionOverrides && data.permissionOverrides.length > 0
          ? {
              permissionOverrides: {
                create: data.permissionOverrides.map((o) => ({
                  permission: o.permission,
                  granted: Boolean(o.granted),
                })),
              },
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        isActive: true,
        hourlyRate: true,
        phone: true,
        createdAt: true,
      },
    });

    return {
      ...employee,
      pin: finalPin, // Plain PIN shown only when created or reset
    };
  }

  async updateEmployee(
    id: string,
    data: any,
    restaurantId: string,
    requester?: {
      id: string;
      isOwnerRole?: boolean;
      role?: string;
      isPlatform?: boolean;
      supportMode?: boolean;
      permissions?: string[];
    },
    isPlatformAdmin = false
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to update an employee');
    }

    const existing = await prisma.employee.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: {
        roleRecord: true,
      },
    });

    if (!existing) {
      throw new Error('Employee not found or unauthorized');
    }

    // R7: When roleRecord is linked, it is authoritative; only fall back to role string when null
    const isTargetOwner = existing.roleRecord
      ? existing.roleRecord.isOwnerRole === true
      : existing.role === 'OWNER' || existing.role === 'ADMIN';

    const isAuthorizedForOwner =
      Boolean(requester && requester.id === existing.id) ||
      requester?.isPlatform === true ||
      requester?.supportMode === true ||
      isPlatformAdmin === true;

    if (isTargetOwner && !isAuthorizedForOwner) {
      throw new Error('The Owner account can only be modified by the Owner or platform support');
    }

    const isRequesterTarget = requester?.id === id;

    const updateData: any = {};

    if (data.firstName !== undefined) updateData.firstName = data.firstName.trim();
    if (data.lastName !== undefined) updateData.lastName = data.lastName.trim();
    if (data.phone !== undefined) updateData.phone = data.phone?.trim() || null;
    if (data.hourlyRate !== undefined) updateData.hourlyRate = Number(data.hourlyRate) || null;

    if (data.username !== undefined) {
      if (data.username && data.username.trim()) {
        const usernameNorm = data.username.trim().toLowerCase();
        const conflict = await prisma.employee.findFirst({
          where: {
            restaurantId,
            username: usernameNorm,
            id: { not: id },
          },
        });
        if (conflict) {
          throw new Error('An employee with this username already exists in this restaurant');
        }
        updateData.username = usernameNorm;
      } else {
        updateData.username = null;
      }
    }

    if (data.email !== undefined) {
      if (data.email && data.email.trim()) {
        const emailNorm = data.email.trim().toLowerCase();
        if (emailNorm !== existing.email) {
          const [platformConflict, employeeConflict] = await Promise.all([
            prisma.platformUser.findUnique({ where: { email: emailNorm } }),
            prisma.employee.findFirst({
              where: { email: emailNorm, id: { not: id } },
            }),
          ]);
          if (platformConflict || employeeConflict) {
            throw new Error('An account with this email address already exists');
          }
          updateData.email = emailNorm;
        }
      } else {
        if (isTargetOwner) {
          throw new Error('Owner account must have an email address');
        }
        updateData.email = null;
      }
    }

    let plainPinToReturn: string | undefined = undefined;
    if (data.pin && data.pin.trim()) {
      const pinNorm = data.pin.trim();
      const isManagerOrOwner =
        isTargetOwner ||
        existing.role === 'MANAGER' ||
        (existing.roleRecord && (
          existing.roleRecord.key.toUpperCase() === 'OWNER' ||
          existing.roleRecord.key.toUpperCase() === 'MANAGER' ||
          String(existing.roleRecord.name).toLowerCase().includes('manager') ||
          String(existing.roleRecord.name).toLowerCase().includes('owner')
        ));

      if (isManagerOrOwner) {
        if (!/^\d{6}$/.test(pinNorm)) {
          throw Object.assign(new Error('Owner and Manager PINs must be exactly 6 digits'), { statusCode: 400 });
        }
      } else {
        if (!/^\d{4,6}$/.test(pinNorm)) {
          throw Object.assign(new Error('PIN must be 4 to 6 digits'), { statusCode: 400 });
        }
      }

      const conflict = await this.checkPinConflict(restaurantId, pinNorm, id);
      if (conflict) {
        throw new Error('This PIN is already assigned to another staff member');
      }
      updateData.pin = await bcrypt.hash(pinNorm, 10);
      plainPinToReturn = pinNorm;
    }

    if (data.password && data.password.trim()) {
      updateData.passwordHash = await bcrypt.hash(data.password.trim(), 10);
    }

    // Role assignment logic
    if (data.roleId || data.role) {
      if (isTargetOwner) {
        // Disallow changing the role of the Owner account
        if (data.roleId !== existing.roleId || (data.role && data.role !== existing.role)) {
          throw new Error('The Owner account role cannot be changed');
        }
      } else {
        let newRoleRecord: any = null;
        if (data.roleId) {
          newRoleRecord = await prisma.role.findFirst({
            where: { id: data.roleId, restaurantId },
            include: { permissions: true },
          });
          if (!newRoleRecord) {
            throw new Error('Specified role does not belong to your restaurant');
          }
        } else if (data.role) {
          const candKey = data.role.trim().toUpperCase();
          newRoleRecord = await prisma.role.findFirst({
            where: {
              restaurantId,
              OR: [{ key: candKey }, { name: data.role.trim() }],
            },
            include: { permissions: true },
          });
        }

        if (newRoleRecord) {
          if (
            newRoleRecord.isOwnerRole ||
            newRoleRecord.key === 'OWNER' ||
            FORBIDDEN_STAFF_ROLE_KEYS.includes(newRoleRecord.key.toUpperCase())
          ) {
            throw new Error('Cannot assign Owner or Platform roles to staff members');
          }

          // R3: Privilege ceiling check when non-owner/non-support assigns a role
          const isRequesterOwner = requester?.isOwnerRole === true;
          const isRequesterSupport =
            requester?.supportMode === true ||
            requester?.isPlatform === true ||
            isPlatformAdmin === true;

          if (!isRequesterOwner && !isRequesterSupport) {
            const requesterPerms = new Set(requester?.permissions || []);
            const targetPerms = (newRoleRecord.permissions || []).map((p: any) => p.permission);
            const exceeding = targetPerms.filter((p: string) => !requesterPerms.has(p));
            if (exceeding.length > 0) {
              throw new Error(
                `Cannot assign a role with permissions exceeding your own: ${exceeding.join(', ')}`
              );
            }
          }

          updateData.roleId = newRoleRecord.id;
          updateData.role = newRoleRecord.key;
        }
      }
    }

    // Prevent deactivating own owner account
    if (data.isActive !== undefined) {
      if (isTargetOwner && data.isActive === false) {
        throw new Error('The Owner account cannot be deactivated');
      }
      updateData.isActive = Boolean(data.isActive);
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        isActive: true,
        hourlyRate: true,
        phone: true,
        updatedAt: true,
        roleRecord: {
          select: {
            id: true,
            name: true,
            key: true,
            isOwnerRole: true,
          },
        },
      },
    });

    const { roleRecord, ...rest } = updated;
    return {
      ...rest,
      roleName: roleRecord?.name || rest.role,
      isOwner: roleRecord ? roleRecord.isOwnerRole === true : rest.role === 'OWNER',
      ...(plainPinToReturn ? { pin: plainPinToReturn } : {}),
    };
  }

  async deactivateEmployee(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to deactivate an employee');
    }

    const existing = await prisma.employee.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: { roleRecord: true },
    });

    if (!existing) {
      throw new Error('Employee not found or unauthorized');
    }

    const isOwner = existing.roleRecord
      ? existing.roleRecord.isOwnerRole === true
      : existing.role === 'OWNER' || existing.role === 'ADMIN';

    if (isOwner) {
      throw new Error('The Owner account cannot be deactivated');
    }

    const deactivated = await prisma.employee.update({
      where: { id },
      data: { isActive: false },
      include: { roleRecord: true },
    });
    return {
      id: deactivated.id,
      email: deactivated.email,
      firstName: deactivated.firstName,
      lastName: deactivated.lastName,
      role: deactivated.roleRecord?.name || deactivated.role,
      roleId: deactivated.roleId,
      isActive: deactivated.isActive,
      updatedAt: deactivated.updatedAt,
    };
  }

  async clockIn(
    employeeId: string,
    restaurantId: string,
    requester?: { id?: string; isOwnerRole?: boolean; permissions?: string[] }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to clock in');
    }

    if (requester) {
      const isSelf = requester.id === employeeId;
      const canManage =
        requester.isOwnerRole === true ||
        (requester.permissions || []).includes('employees.manage');
      if (!isSelf && !canManage) {
        throw new Error('You are only authorized to clock in for yourself');
      }
    }

    const emp = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        restaurantId,
      },
    });

    if (!emp) {
      throw new Error('Employee not found or unauthorized');
    }

    const activeShift = await prisma.timeEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
      },
    });

    if (activeShift) {
      throw new Error('Employee is already clocked in');
    }

    return prisma.timeEntry.create({
      data: {
        employeeId,
        clockIn: new Date(),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  async clockOut(
    employeeId: string,
    restaurantId: string,
    requester?: { id?: string; isOwnerRole?: boolean; permissions?: string[] }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to clock out');
    }

    if (requester) {
      const isSelf = requester.id === employeeId;
      const canManage =
        requester.isOwnerRole === true ||
        (requester.permissions || []).includes('employees.manage');
      if (!isSelf && !canManage) {
        throw new Error('You are only authorized to clock out for yourself');
      }
    }

    const emp = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        restaurantId,
      },
    });

    if (!emp) {
      throw new Error('Employee not found or unauthorized');
    }

    const activeShift = await prisma.timeEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
      },
    });

    if (!activeShift) {
      throw new Error('No active clocked-in shift found');
    }

    const clockOut = new Date();
    const hoursWorked = +(
      (clockOut.getTime() - activeShift.clockIn.getTime()) /
      (1000 * 60 * 60)
    ).toFixed(2);

    return prisma.timeEntry.update({
      where: { id: activeShift.id },
      data: {
        clockOut,
        hoursWorked,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  async resetPin(employeeId: string, restaurantId: string, customPin?: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, restaurantId },
      include: { roleRecord: true },
    });
    if (!employee) {
      throw new Error('Employee not found or unauthorized');
    }

    const isManagerOrOwner =
      employee.roleRecord?.isOwnerRole ||
      employee.role === 'OWNER' ||
      employee.role === 'MANAGER' ||
      (employee.roleRecord && (
        employee.roleRecord.key.toUpperCase() === 'OWNER' ||
        employee.roleRecord.key.toUpperCase() === 'MANAGER' ||
        String(employee.roleRecord.name).toLowerCase().includes('manager') ||
        String(employee.roleRecord.name).toLowerCase().includes('owner')
      ));

    let finalPin: string;
    if (customPin && customPin.trim()) {
      finalPin = customPin.trim();
      if (isManagerOrOwner) {
        if (!/^\d{6}$/.test(finalPin)) {
          throw Object.assign(new Error('Owner and Manager PINs must be exactly 6 digits'), { statusCode: 400 });
        }
      } else {
        if (!/^\d{4,6}$/.test(finalPin)) {
          throw Object.assign(new Error('PIN must be 4 to 6 digits'), { statusCode: 400 });
        }
      }
      const conflict = await this.checkPinConflict(restaurantId, finalPin, employeeId);
      if (conflict) {
        throw new Error('This PIN is already assigned to another staff member');
      }
    } else {
      finalPin = await this.generateUniquePin(restaurantId, isManagerOrOwner ? 6 : 4);
    }

    const hashedPin = await bcrypt.hash(finalPin, 10);
    await prisma.employee.update({
      where: { id: employeeId },
      data: { pin: hashedPin },
    });

    return {
      success: true,
      pin: finalPin,
    };
  }

  async punchTimeClock(pin: string, restaurantId: string, ip = '0.0.0.0') {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to punch time clock');
    }
    if (!pin || !pin.trim()) {
      throw Object.assign(new Error('PIN is required'), { statusCode: 400 });
    }

    attemptLockService.assertNotLocked(restaurantId, ip);

    const activeStaff = await prisma.employee.findMany({
      where: { restaurantId, isActive: true },
      include: { roleRecord: true },
    });

    let matchedEmployee: any = null;
    const cleanPin = pin.trim();
    for (const staff of activeStaff) {
      if (!staff.pin) continue;
      const isMatch = (await bcrypt.compare(cleanPin, staff.pin).catch(() => false)) || staff.pin === cleanPin;
      if (isMatch) {
        matchedEmployee = staff;
        break;
      }
    }

    if (!matchedEmployee) {
      attemptLockService.recordFailure(restaurantId, ip);
      throw Object.assign(new Error('Invalid PIN or inactive employee'), { statusCode: 401 });
    }

    attemptLockService.recordSuccess(restaurantId, ip);

    const activeShift = await prisma.timeEntry.findFirst({
      where: {
        employeeId: matchedEmployee.id,
        clockOut: null,
      },
    });

    let action: 'clockIn' | 'clockOut';
    let shift: any;

    if (activeShift) {
      action = 'clockOut';
      const clockOut = new Date();
      const hoursWorked = +(
        (clockOut.getTime() - activeShift.clockIn.getTime()) /
        (1000 * 60 * 60)
      ).toFixed(2);
      shift = await prisma.timeEntry.update({
        where: { id: activeShift.id },
        data: {
          clockOut,
          hoursWorked,
        },
      });
    } else {
      action = 'clockIn';
      shift = await prisma.timeEntry.create({
        data: {
          employeeId: matchedEmployee.id,
          clockIn: new Date(),
        },
      });
    }

    return {
      action,
      shift,
      employee: {
        id: matchedEmployee.id,
        firstName: matchedEmployee.firstName,
        lastName: matchedEmployee.lastName,
        role: matchedEmployee.roleRecord?.name || matchedEmployee.role,
      },
    };
  }

  async getEmployeeShifts(employeeId: string, startDate: Date | undefined, endDate: Date | undefined, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to get employee shifts');
    }

    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, restaurantId },
    });
    if (!emp) {
      throw new Error('Employee not found or unauthorized');
    }

    const where: any = { employeeId };
    if (startDate || endDate) {
      where.clockIn = {};
      if (startDate) where.clockIn.gte = startDate;
      if (endDate) where.clockIn.lte = endDate;
    }

    return prisma.timeEntry.findMany({
      where,
      orderBy: { clockIn: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  async getActiveShifts(restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to get active shifts');
    }

    return prisma.timeEntry.findMany({
      where: {
        employee: { restaurantId },
        clockOut: null,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            hourlyRate: true,
          },
        },
      },
      orderBy: { clockIn: 'desc' },
    });
  }
  async getEmployeePermissions(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const employee = await prisma.employee.findFirst({
      where: { id, restaurantId },
      include: {
        roleRecord: {
          include: {
            permissions: true,
          },
        },
        permissionOverrides: true,
      },
    });

    if (!employee) {
      throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
    }

    const isOwner = employee.roleRecord ? employee.roleRecord.isOwnerRole : employee.role === 'OWNER';

    let rolePermissions: string[] = [];
    if (isOwner) {
      rolePermissions = [...ALL_PERMISSIONS];
    } else if (employee.roleRecord) {
      rolePermissions = employee.roleRecord.permissions.map((p) => p.permission);
    } else {
      const sysRole = DEFAULT_SYSTEM_ROLES.find(
        (r) => r.key.toUpperCase() === (employee.role || '').toUpperCase()
      );
      rolePermissions = sysRole ? [...sysRole.permissions] : [];
    }

    const overrides = employee.permissionOverrides.map((o) => ({
      permission: o.permission,
      granted: o.granted,
    }));

    let effectivePermissions: string[] = [];
    if (isOwner) {
      effectivePermissions = [...ALL_PERMISSIONS];
    } else {
      const permSet = new Set<string>(rolePermissions);
      for (const ov of overrides) {
        if (ov.granted) permSet.add(ov.permission);
        else permSet.delete(ov.permission);
      }
      effectivePermissions = Array.from(permSet);
    }

    return {
      rolePermissions,
      overrides,
      effectivePermissions,
      isOwner,
    };
  }

  async updateEmployeePermissions(
    id: string,
    overrides: Array<{ permission: string; granted: boolean }>,
    restaurantId: string,
    requester?: any
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const employee = await prisma.employee.findFirst({
      where: { id, restaurantId },
      include: { roleRecord: true },
    });

    if (!employee) {
      throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
    }

    const isOwner = employee.roleRecord ? employee.roleRecord.isOwnerRole : employee.role === 'OWNER';
    if (isOwner) {
      throw Object.assign(new Error('Cannot override permissions on the Owner account'), { statusCode: 400 });
    }

    const validPermsSet = new Set<string>(PERMISSIONS);
    for (const ov of overrides) {
      if (!validPermsSet.has(ov.permission)) {
        throw Object.assign(new Error(`Invalid permission: ${ov.permission}`), { statusCode: 400 });
      }
    }

    // Privilege ceiling for non-owner requesters
    const isRequesterOwner = requester?.isOwnerRole === true || requester?.role === 'OWNER';
    if (!isRequesterOwner) {
      const requesterPerms = new Set<string>(requester?.permissions || []);
      for (const ov of overrides) {
        const isGranted = Boolean((ov as any).granted ?? (ov as any).effect === 'GRANT');
        if (isGranted) {
          if (ov.permission === 'backups.manage') {
            throw Object.assign(new Error('Non-owner cannot grant backups.manage'), { statusCode: 403 });
          }
          if (!requesterPerms.has(ov.permission)) {
            throw Object.assign(
              new Error(`Cannot grant permissions you do not possess: ${ov.permission}`),
              { statusCode: 403 }
            );
          }
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.employeePermission.deleteMany({
        where: { employeeId: id },
      });

      if (overrides.length > 0) {
        await tx.employeePermission.createMany({
          data: overrides.map((o) => ({
            employeeId: id,
            permission: o.permission,
            granted: Boolean((o as any).granted ?? (o as any).effect === 'GRANT'),
          })),
        });
      }
    });

    return this.getEmployeePermissions(id, restaurantId);
  }

  async resetPassword(
    id: string,
    restaurantId: string,
    temporaryPassword?: string,
    requester?: any
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const employee = await prisma.employee.findFirst({
      where: { id, restaurantId },
      include: { roleRecord: true },
    });

    if (!employee) {
      throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
    }

    const isTargetOwner = employee.roleRecord ? employee.roleRecord.isOwnerRole : employee.role === 'OWNER';
    const isSelf = requester?.id === employee.id;
    const isPlatform = requester?.isPlatform || requester?.supportMode;

    if (isTargetOwner && !isSelf && !isPlatform) {
      throw Object.assign(
        new Error('The Owner account can only be modified by the Owner or platform support'),
        { statusCode: 400 }
      );
    }

    // Non-owners may only reset passwords for employees whose permissions they
    // fully possess.
    const isRequesterOwner = requester?.isOwnerRole === true || requester?.role === 'OWNER';
    if (!isSelf && !isPlatform && !isRequesterOwner) {
      const targetPermissions = await this.getEmployeePermissions(id, restaurantId);
      this.assertPermissionCeiling(requester, targetPermissions.effectivePermissions, 'reset');
    }

    const tempPassword = temporaryPassword && temporaryPassword.trim()
      ? temporaryPassword.trim()
      : `Temp@${crypto.randomBytes(3).toString('hex')}${Math.floor(100 + Math.random() * 900)}`;

    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await prisma.employee.update({
      where: { id },
      data: { passwordHash },
    });

    return {
      temporaryPassword: tempPassword,
      message: 'Password successfully reset',
    };
  }
}

export const employeeService = new EmployeeService();
