import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export type EmployeeRole = 'ADMIN' | 'MANAGER' | 'SERVER' | 'KITCHEN' | 'CASHIER' | string;

const prisma = new PrismaClient();

export class EmployeeService {
  async getEmployees(restaurantId: string) {
    return prisma.employee.findMany({
      where: { restaurantId },
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
      orderBy: { lastName: 'asc' },
    });
  }

  async getEmployee(id: string) {
    return prisma.employee.findUnique({
      where: { id },
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
    const existingEmployee = await prisma.employee.findUnique({
      where: { email: data.email },
    });

    if (existingEmployee) {
      throw new Error('Employee with this email already exists');
    }

    const defaultPassword = data.password || 'password123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const employee = await prisma.employee.create({
      data: {
        email: data.email,
        passwordHash: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        restaurantId: data.restaurantId,
        role: data.role || 'SERVER',
        pin: data.pin || '1234',
        hourlyRate: data.hourlyRate || 15.0,
        phone: data.phone,
        isActive: true,
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

  async updateEmployee(id: string, data: any) {
    const updateData = { ...data };
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

  async deactivateEmployee(id: string) {
    return prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async clockIn(employeeId: string) {
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

  async clockOut(employeeId: string) {
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

  async getEmployeeShifts(employeeId: string, startDate?: Date, endDate?: Date) {
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