import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export type EmployeeRole = 'OWNER' | 'MANAGER' | 'CHEF' | 'WAITER' | 'CASHIER' | string;

const prisma = new PrismaClient();

const FORBIDDEN_STAFF_ROLE_KEYS = ['SUPER_ADMIN', 'SUPPORT'];

export class EmployeeService {
  async generateUniquePin(restaurantId: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomInt(1000, 10000).toString();
      const conflict = await prisma.employee.findFirst({
        where: {
          restaurantId,
          pin: candidate,
          isActive: true,
        },
      });
      if (!conflict) {
        return candidate;
      }
    }
    throw new Error('Unable to generate unique PIN after multiple attempts. Please provide a PIN.');
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
          firstName: true,
          lastName: true,
          role: true,
          roleId: true,
          isActive: true,
          pin: true,
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

    // Strip PIN if requester lacks employees.manage permission
    const sanitized = employees.map((emp) => {
      const { pin, roleRecord, ...rest } = emp;
      return {
        ...rest,
        roleName: roleRecord?.name || rest.role,
        isOwner: roleRecord ? roleRecord.isOwnerRole === true : rest.role === 'OWNER',
        ...(options?.canManage ? { pin } : {}),
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
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        isActive: true,
        pin: true,
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

    const { pin, roleRecord, ...rest } = emp;
    return {
      ...rest,
      roleName: roleRecord?.name || rest.role,
      isOwner: roleRecord ? roleRecord.isOwnerRole === true : rest.role === 'OWNER',
      ...(canManage ? { pin } : {}),
    };
  }

  async createEmployee(
    data: {
      email: string;
      password?: string;
      firstName: string;
      lastName: string;
      restaurantId: string;
      role?: string;
      roleId?: string;
      pin?: string;
      hourlyRate?: number;
      phone?: string;
    },
    requester?: { id: string; isOwnerRole?: boolean; role?: string }
  ) {
    if (!data.restaurantId || !data.restaurantId.trim()) {
      throw new Error('restaurantId is required to create an employee');
    }

    const emailNorm = data.email.trim().toLowerCase();

    // Prevent collision across PlatformUser and Employee
    const [existingPlatform, existingEmployee] = await Promise.all([
      prisma.platformUser.findUnique({ where: { email: emailNorm } }),
      prisma.employee.findUnique({ where: { email: emailNorm } }),
    ]);

    if (existingPlatform || existingEmployee) {
      throw new Error('An account with this email address already exists');
    }

    // Resolve and validate role
    let targetRole: any = null;
    if (data.roleId) {
      targetRole = await prisma.role.findFirst({
        where: { id: data.roleId, restaurantId: data.restaurantId },
      });
      if (!targetRole) {
        throw new Error('Specified role does not belong to your restaurant');
      }
    } else if (data.role) {
      const candidateKey = data.role.trim().toUpperCase();
      targetRole = await prisma.role.findFirst({
        where: {
          restaurantId: data.restaurantId,
          OR: [{ key: candidateKey }, { name: data.role.trim() }],
        },
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

    // Resolve PIN: validate provided PIN or auto-generate unique 4-digit PIN
    let finalPin: string;
    if (data.pin && data.pin.trim()) {
      finalPin = data.pin.trim();
      const pinConflict = await prisma.employee.findFirst({
        where: {
          restaurantId: data.restaurantId,
          pin: finalPin,
          isActive: true,
        },
      });
      if (pinConflict) {
        throw new Error('This PIN is already assigned to another staff member in your restaurant');
      }
    } else {
      finalPin = await this.generateUniquePin(data.restaurantId);
    }

    // Set password hash: if omitted, generate an unguessable disabled hash
    const passwordHash =
      data.password && data.password.trim()
        ? await bcrypt.hash(data.password.trim(), 10)
        : await bcrypt.hash(`!NO_PASSWORD_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('hex')}`, 10);

    const employee = await prisma.employee.create({
      data: {
        email: emailNorm,
        passwordHash,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        restaurantId: data.restaurantId,
        role: targetRole.key,
        roleId: targetRole.id,
        pin: finalPin,
        hourlyRate: data.hourlyRate || null,
        phone: data.phone?.trim() || null,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        isActive: true,
        pin: true,
        hourlyRate: true,
        phone: true,
        createdAt: true,
      },
    });

    return employee;
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

    if (data.email && data.email.trim().toLowerCase() !== existing.email) {
      const emailNorm = data.email.trim().toLowerCase();
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

    if (data.pin && data.pin.trim() && data.pin.trim() !== existing.pin) {
      const pinNorm = data.pin.trim();
      const conflict = await prisma.employee.findFirst({
        where: {
          restaurantId,
          pin: pinNorm,
          id: { not: id },
          isActive: true,
        },
      });
      if (conflict) {
        throw new Error('This PIN is already assigned to another staff member');
      }
      updateData.pin = pinNorm;
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
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        isActive: true,
        pin: true,
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

    const { pin, roleRecord, ...rest } = updated;
    return {
      ...rest,
      roleName: roleRecord?.name || rest.role,
      isOwner: roleRecord ? roleRecord.isOwnerRole === true : rest.role === 'OWNER',
      pin,
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

    return prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });
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
}

export const employeeService = new EmployeeService();
