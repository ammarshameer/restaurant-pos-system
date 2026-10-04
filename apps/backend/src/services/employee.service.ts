import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export type EmployeeRole = 'ADMIN' | 'MANAGER' | 'SERVER' | 'KITCHEN' | 'CASHIER' | string;

const prisma = new PrismaClient();

export class EmployeeService {
  async getEmployees(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      role?: string;
      isActive?: boolean;
      search?: string;
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
          isActive: true,
          pin: true,
          hourlyRate: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
      data: employees,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async getEmployee(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve an employee');
    }

    return prisma.employee.findFirst({
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
        isActive: true,
        pin: true,
        hourlyRate: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createEmployee(data: {
    email: string;
    password?: string;
    firstName: string;
    lastName: string;
    restaurantId: string;
    role: EmployeeRole;
    pin?: string;
    hourlyRate?: number;
    phone?: string;
  }) {
    if (!data.restaurantId || !data.restaurantId.trim()) {
      throw new Error('restaurantId is required to create an employee');
    }

    const existingEmployee = await prisma.employee.findUnique({
      where: { email: data.email },
    });

    if (existingEmployee) {
      throw new Error('Employee with this email already exists');
    }

    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null;

    const employee = await prisma.employee.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        restaurantId: data.restaurantId,
        role: data.role,
        pin: data.pin || null,
        hourlyRate: data.hourlyRate || null,
        phone: data.phone || null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        pin: true,
        hourlyRate: true,
        phone: true,
        createdAt: true,
      },
    });

    return employee;
  }

  async updateEmployee(id: string, data: any, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to update an employee');
    }

    const existing = await prisma.employee.findFirst({
      where: {
        id,
        restaurantId,
      },
    });

    if (!existing) {
      throw new Error('Employee not found or unauthorized');
    }

    const updateData = { ...data };
    delete updateData.restaurantId;
    if (updateData.password) {
      updateData.passwordHash = await bcrypt.hash(updateData.password, 10);
      delete updateData.password;
    }

    return prisma.employee.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        pin: true,
        hourlyRate: true,
        phone: true,
        updatedAt: true,
      },
    });
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
    });

    if (!existing) {
      throw new Error('Employee not found or unauthorized');
    }

    return prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async clockIn(employeeId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to clock in');
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

  async clockOut(employeeId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to clock out');
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