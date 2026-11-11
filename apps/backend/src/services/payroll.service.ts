import { PrismaClient } from '@prisma/client';
import { ValidationError, NotFoundError } from '../lib/errors';
import { ExpensesService } from './expenses.service';

const prisma = new PrismaClient();

const expensesService = new ExpensesService();

export class PayrollService {
  // ============================================
  // SETTINGS
  // ============================================

  async getSettings(restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    let settings = await prisma.payrollSettings.findUnique({
      where: { restaurantId },
    });

    if (!settings) {
      settings = await prisma.payrollSettings.create({
        data: {
          restaurantId,
          workdayHours: 8,
          workdaysPerMonth: 26,
          overtimeMultiplier: 1.5,
          overtimeApprovalRequired: true,
        },
      });
    }

    return settings;
  }

  async updateSettings(
    restaurantId: string,
    data: {
      workdayHours?: number;
      workdaysPerMonth?: number;
      overtimeMultiplier?: number;
      overtimeApprovalRequired?: boolean;
    }
  ) {
    await this.getSettings(restaurantId);

    const updateData: any = {};
    if (data.workdayHours !== undefined) {
      const val = Number(data.workdayHours);
      if (val <= 0 || val > 24) throw new ValidationError('Workday hours must be between 1 and 24');
      updateData.workdayHours = val;
    }
    if (data.workdaysPerMonth !== undefined) {
      const val = Number(data.workdaysPerMonth);
      if (val <= 0 || val > 31) throw new ValidationError('Workdays per month must be between 1 and 31');
      updateData.workdaysPerMonth = Math.round(val);
    }
    if (data.overtimeMultiplier !== undefined) {
      const val = Number(data.overtimeMultiplier);
      if (val < 1) throw new ValidationError('Overtime multiplier must be at least 1.0');
      updateData.overtimeMultiplier = val;
    }
    if (data.overtimeApprovalRequired !== undefined) {
      updateData.overtimeApprovalRequired = Boolean(data.overtimeApprovalRequired);
    }

    return prisma.payrollSettings.update({
      where: { restaurantId },
      data: updateData,
    });
  }

  // ============================================
  // EMPLOYEE ADVANCES
  // ============================================

  async getAdvances(restaurantId: string, params: { employeeId?: string; status?: string; page?: number; limit?: number }) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = { restaurantId };
    if (params.employeeId) where.employeeId = params.employeeId;
    if (params.status) where.status = params.status.toUpperCase();

    const [total, advances] = await Promise.all([
      prisma.employeeAdvance.count({ where }),
      prisma.employeeAdvance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, email: true, username: true },
          },
        },
      }),
    ]);

    return {
      data: advances,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async createAdvance(
    restaurantId: string,
    data: {
      employeeId: string;
      amount: number;
      monthlyInstalment?: number;
      reason?: string;
      advanceDate?: string | Date;
      clientRef?: string;
    },
    userId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    // ClientRef idempotency check
    if (data.clientRef && data.clientRef.trim()) {
      const existing = await prisma.employeeAdvance.findFirst({
        where: { restaurantId, clientRef: data.clientRef.trim() },
        include: { employee: true },
      });
      if (existing) return existing;
    }

    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, restaurantId, isActive: true },
    });
    if (!employee) {
      throw new NotFoundError('Employee not found or inactive');
    }

    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new ValidationError('Advance amount must be greater than zero');
    }

    const monthlyInstalment =
      data.monthlyInstalment !== undefined && Number(data.monthlyInstalment) > 0
        ? Number(data.monthlyInstalment)
        : null;

    return prisma.employeeAdvance.create({
      data: {
        restaurantId,
        employeeId: employee.id,
        amount: +amount.toFixed(2),
        remainingAmount: +amount.toFixed(2),
        monthlyInstalment: monthlyInstalment ? +monthlyInstalment.toFixed(2) : null,
        reason: data.reason?.trim() || null,
        advanceDate: data.advanceDate ? new Date(data.advanceDate) : new Date(),
        status: 'ACTIVE',
        clientRef: data.clientRef?.trim() || null,
        createdById: userId || null,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async cancelAdvance(restaurantId: string, id: string) {
    const advance = await prisma.employeeAdvance.findFirst({
      where: { id, restaurantId },
    });
    if (!advance) throw new NotFoundError('Advance not found');
    if (advance.status !== 'ACTIVE') {
      throw new ValidationError(`Advance cannot be cancelled (status: ${advance.status})`);
    }
    if (advance.remainingAmount < advance.amount) {
      throw new ValidationError('Cannot cancel advance after partial recovery has begun');
    }

    return prisma.employeeAdvance.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  // ============================================
  // TIME ENTRIES & CORRECTION
  // ============================================

  async getTimeEntries(
    restaurantId: string,
    params: { month?: string; employeeId?: string; page?: number; limit?: number }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = {
      employee: { restaurantId },
    };

    if (params.employeeId) {
      where.employeeId = params.employeeId;
    }

    if (params.month) {
      const [y, m] = params.month.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
      where.clockIn = { gte: start, lte: end };
    }

    const [total, entries] = await Promise.all([
      prisma.timeEntry.count({ where }),
      prisma.timeEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { clockIn: 'desc' },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salaryType: true,
              overtimeEligible: true,
            },
          },
        },
      }),
    ]);

    return {
      data: entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async correctTimeEntry(
    restaurantId: string,
    id: string,
    data: { clockIn?: string | Date; clockOut?: string | Date; reason: string },
    userId: string
  ) {
    const entry = await prisma.timeEntry.findFirst({
      where: { id, employee: { restaurantId } },
      include: { employee: true },
    });
    if (!entry) throw new NotFoundError('Time entry not found');

    const reason = (data.reason || '').trim();
    if (!reason) {
      throw new ValidationError('A reason is required when correcting a time entry');
    }

    const settings = await this.getSettings(restaurantId);

    const clockIn = data.clockIn ? new Date(data.clockIn) : entry.clockIn;
    const clockOut = data.clockOut !== undefined ? (data.clockOut ? new Date(data.clockOut) : null) : entry.clockOut;

    let hoursWorked: number | null = null;
    let overtimeHours = 0;

    if (clockOut) {
      if (clockOut.getTime() <= clockIn.getTime()) {
        throw new ValidationError('Clock-out must be after clock-in');
      }
      hoursWorked = +( (clockOut.getTime() - clockIn.getTime()) / 3600000 ).toFixed(2);
      if (entry.employee.overtimeEligible && hoursWorked > settings.workdayHours) {
        overtimeHours = +(hoursWorked - settings.workdayHours).toFixed(2);
      }
    }

    return prisma.timeEntry.update({
      where: { id },
      data: {
        clockIn,
        clockOut,
        hoursWorked,
        overtimeHours,
        isCorrected: true,
        correctionReason: reason,
        correctedById: userId,
        correctedAt: new Date(),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async approveOvertime(restaurantId: string, id: string, approved: boolean, userId: string) {
    const entry = await prisma.timeEntry.findFirst({
      where: { id, employee: { restaurantId } },
    });
    if (!entry) throw new NotFoundError('Time entry not found');

    return prisma.timeEntry.update({
      where: { id },
      data: {
        overtimeApproved: approved,
        overtimeApprovedById: userId,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ============================================
  // PAYROLL RUNS & MATH
  // ============================================

  async getRuns(restaurantId: string, params: { page?: number; limit?: number } = {}) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, runs] = await Promise.all([
      prisma.payrollRun.count({ where: { restaurantId } }),
      prisma.payrollRun.findMany({
        where: { restaurantId },
        skip,
        take: limit,
        orderBy: { month: 'desc' },
        include: {
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return {
      data: runs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getRunDetails(restaurantId: string, idOrMonth: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const run = await prisma.payrollRun.findFirst({
      where: {
        restaurantId,
        OR: [{ id: idOrMonth }, { month: idOrMonth }],
      },
      include: {
        lines: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                username: true,
                role: true,
                salaryType: true,
                monthlySalary: true,
                dailyRate: true,
                hourlyRate: true,
              },
            },
            expense: {
              select: { id: true, status: true, amount: true, paidAt: true },
            },
          },
          orderBy: { employee: { firstName: 'asc' } },
        },
      },
    });

    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    return run;
  }

  async createOrCalculateDraft(restaurantId: string, month: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const [yearStr, monthStr] = (month || '').split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    if (!y || !m || m < 1 || m > 12) {
      throw new ValidationError('Valid month is required (YYYY-MM)');
    }

    // Check existing run
    const existingRun = await prisma.payrollRun.findUnique({
      where: { restaurantId_month: { restaurantId, month } },
      include: { lines: true },
    });

    if (existingRun && existingRun.status === 'PAID') {
      throw new ValidationError('A paid month cannot be changed or recalculated');
    }

    const settings = await this.getSettings(restaurantId);

    // Month boundary
    const startOfMonth = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    // Fetch active employees
    const employees = await prisma.employee.findMany({
      where: { restaurantId, isActive: true },
      include: {
        timeEntries: {
          where: { clockIn: { gte: startOfMonth, lte: endOfMonth } },
        },
        employeeAdvances: {
          where: { status: 'ACTIVE', remainingAmount: { gt: 0 } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const calculatedLines: any[] = [];

    for (const emp of employees) {
      const salaryType = emp.salaryType || 'MONTHLY';
      let regularHours = 0;
      let overtimeHours = 0;

      // Calculate hours from time entries
      for (const entry of emp.timeEntries) {
        let hrs = entry.hoursWorked;
        if (hrs === null && entry.clockOut) {
          hrs = Math.max(0, (entry.clockOut.getTime() - entry.clockIn.getTime()) / 3600000);
        }
        if (hrs && hrs > 0) {
          const dayReg = Math.min(hrs, settings.workdayHours);
          regularHours += dayReg;

          if (emp.overtimeEligible) {
            const rawOt = Math.max(0, hrs - settings.workdayHours);
            const isApproved = settings.overtimeApprovalRequired ? entry.overtimeApproved === true : true;
            if (isApproved && rawOt > 0) {
              overtimeHours += rawOt;
            }
          }
        }
      }

      regularHours = +regularHours.toFixed(2);
      overtimeHours = +overtimeHours.toFixed(2);

      let base = 0;
      let overtimePay = 0;

      if (salaryType === 'MONTHLY') {
        base = Number(emp.monthlySalary || 0);
        const totalWorkHours = settings.workdaysPerMonth * settings.workdayHours;
        const hourlyEquivalent = totalWorkHours > 0 ? base / totalWorkHours : 0;
        overtimePay = +(overtimeHours * hourlyEquivalent * settings.overtimeMultiplier).toFixed(2);
      } else if (salaryType === 'HOURLY') {
        const rate = Number(emp.hourlyRate || 0);
        base = +(regularHours * rate).toFixed(2);
        overtimePay = +(overtimeHours * rate * settings.overtimeMultiplier).toFixed(2);
      } else if (salaryType === 'DAILY') {
        const rate = Number(emp.dailyRate || 0);
        const daysWorked = new Set(
          emp.timeEntries.map((e) => new Date(e.clockIn).toISOString().slice(0, 10))
        ).size;
        base = +(daysWorked * rate).toFixed(2);
        const hourlyEquivalent = settings.workdayHours > 0 ? rate / settings.workdayHours : 0;
        overtimePay = +(overtimeHours * hourlyEquivalent * settings.overtimeMultiplier).toFixed(2);
      }

      // Check advance recovery
      let advanceRecovered = 0;
      let advanceId: string | null = null;
      const activeAdvance = emp.employeeAdvances[0]; // oldest active advance

      const grossBeforeDeductions = base + overtimePay;

      if (activeAdvance) {
        advanceId = activeAdvance.id;
        let recoverable = Number(activeAdvance.remainingAmount);
        if (activeAdvance.monthlyInstalment && Number(activeAdvance.monthlyInstalment) > 0) {
          recoverable = Math.min(recoverable, Number(activeAdvance.monthlyInstalment));
        }
        advanceRecovered = +Math.min(recoverable, Math.max(0, grossBeforeDeductions)).toFixed(2);
      }

      const netPay = +Math.max(0, grossBeforeDeductions - advanceRecovered).toFixed(2);

      calculatedLines.push({
        employeeId: emp.id,
        salaryType,
        base: +base.toFixed(2),
        regularHours,
        overtimeHours,
        overtimePay,
        allowances: 0,
        bonus: 0,
        deductions: 0,
        advanceRecovered,
        advanceId,
        absentDays: 0,
        absenceDeduction: 0,
        netPay,
      });
    }

    const totalGross = calculatedLines.reduce((sum, l) => sum + l.base + l.overtimePay + l.allowances + l.bonus, 0);
    const totalNet = calculatedLines.reduce((sum, l) => sum + l.netPay, 0);
    const totalOvertime = calculatedLines.reduce((sum, l) => sum + l.overtimePay, 0);
    const totalDeductions = calculatedLines.reduce((sum, l) => sum + l.deductions + l.absenceDeduction, 0);
    const totalAdvances = calculatedLines.reduce((sum, l) => sum + l.advanceRecovered, 0);

    const savedRun = await prisma.$transaction(async (tx) => {
      let run: any;
      if (existingRun) {
        // If already draft or finalized, clean previous lines and repopulate
        await tx.payrollLine.deleteMany({ where: { payrollRunId: existingRun.id } });
        run = await tx.payrollRun.update({
          where: { id: existingRun.id },
          data: {
            status: 'DRAFT',
            totalGross: +totalGross.toFixed(2),
            totalNet: +totalNet.toFixed(2),
            totalOvertime: +totalOvertime.toFixed(2),
            totalDeductions: +totalDeductions.toFixed(2),
            totalAdvances: +totalAdvances.toFixed(2),
            employeeCount: calculatedLines.length,
            finalizedAt: null,
            finalizedById: null,
          },
        });
      } else {
        run = await tx.payrollRun.create({
          data: {
            restaurantId,
            month,
            status: 'DRAFT',
            totalGross: +totalGross.toFixed(2),
            totalNet: +totalNet.toFixed(2),
            totalOvertime: +totalOvertime.toFixed(2),
            totalDeductions: +totalDeductions.toFixed(2),
            totalAdvances: +totalAdvances.toFixed(2),
            employeeCount: calculatedLines.length,
          },
        });
      }

      await tx.payrollLine.createMany({
        data: calculatedLines.map((l) => ({
          ...l,
          payrollRunId: run.id,
        })),
      });

      return run;
    });

    return this.getRunDetails(restaurantId, savedRun.id);
  }

  async updateLine(
    restaurantId: string,
    lineId: string,
    data: {
      base?: number;
      overtimeHours?: number;
      overtimePay?: number;
      allowances?: number;
      bonus?: number;
      deductions?: number;
      absentDays?: number;
      absenceDeduction?: number;
      advanceRecovered?: number;
      note?: string;
    }
  ) {
    const line = await prisma.payrollLine.findFirst({
      where: { id: lineId, payrollRun: { restaurantId } },
      include: { payrollRun: true },
    });
    if (!line) throw new NotFoundError('Payroll line not found');

    if (line.payrollRun.status === 'PAID') {
      throw new ValidationError('A paid month cannot be changed');
    }
    if (line.payrollRun.status === 'FINALIZED') {
      throw new ValidationError('Finalized payroll run must be reverted to draft before editing');
    }

    const base = data.base !== undefined ? Math.max(0, Number(data.base)) : line.base;
    const overtimeHours = data.overtimeHours !== undefined ? Math.max(0, Number(data.overtimeHours)) : line.overtimeHours;
    const overtimePay = data.overtimePay !== undefined ? Math.max(0, Number(data.overtimePay)) : line.overtimePay;
    const allowances = data.allowances !== undefined ? Math.max(0, Number(data.allowances)) : line.allowances;
    const bonus = data.bonus !== undefined ? Math.max(0, Number(data.bonus)) : line.bonus;
    const deductions = data.deductions !== undefined ? Math.max(0, Number(data.deductions)) : line.deductions;
    const absentDays = data.absentDays !== undefined ? Math.max(0, Number(data.absentDays)) : line.absentDays;
    const absenceDeduction = data.absenceDeduction !== undefined ? Math.max(0, Number(data.absenceDeduction)) : line.absenceDeduction;
    const advanceRecovered = data.advanceRecovered !== undefined ? Math.max(0, Number(data.advanceRecovered)) : line.advanceRecovered;

    const netPay = +Math.max(
      0,
      base + overtimePay + allowances + bonus - deductions - absenceDeduction - advanceRecovered
    ).toFixed(2);

    await prisma.payrollLine.update({
      where: { id: lineId },
      data: {
        base: +base.toFixed(2),
        overtimeHours: +overtimeHours.toFixed(2),
        overtimePay: +overtimePay.toFixed(2),
        allowances: +allowances.toFixed(2),
        bonus: +bonus.toFixed(2),
        deductions: +deductions.toFixed(2),
        absentDays: +absentDays.toFixed(2),
        absenceDeduction: +absenceDeduction.toFixed(2),
        advanceRecovered: +advanceRecovered.toFixed(2),
        netPay,
        note: data.note !== undefined ? data.note?.trim() || null : line.note,
      },
    });

    // Recalculate run totals
    const allLines = await prisma.payrollLine.findMany({
      where: { payrollRunId: line.payrollRunId },
    });

    const totalGross = allLines.reduce((sum, l) => sum + l.base + l.overtimePay + l.allowances + l.bonus, 0);
    const totalNet = allLines.reduce((sum, l) => sum + l.netPay, 0);
    const totalOvertime = allLines.reduce((sum, l) => sum + l.overtimePay, 0);
    const totalDeductions = allLines.reduce((sum, l) => sum + l.deductions + l.absenceDeduction, 0);
    const totalAdvances = allLines.reduce((sum, l) => sum + l.advanceRecovered, 0);

    await prisma.payrollRun.update({
      where: { id: line.payrollRunId },
      data: {
        totalGross: +totalGross.toFixed(2),
        totalNet: +totalNet.toFixed(2),
        totalOvertime: +totalOvertime.toFixed(2),
        totalDeductions: +totalDeductions.toFixed(2),
        totalAdvances: +totalAdvances.toFixed(2),
      },
    });

    return this.getRunDetails(restaurantId, line.payrollRunId);
  }

  async finalizeRun(restaurantId: string, runId: string, userId: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, restaurantId },
      include: { lines: true },
    });
    if (!run) throw new NotFoundError('Payroll run not found');
    if (run.status === 'PAID') throw new ValidationError('Payroll run is already paid and locked');

    return prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'FINALIZED',
        finalizedAt: new Date(),
        finalizedById: userId,
      },
      include: { lines: true },
    });
  }

  async payRun(restaurantId: string, runId: string, paymentMethod = 'BANK_TRANSFER', userId: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, restaurantId },
      include: {
        lines: {
          include: {
            employee: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundError('Payroll run not found');
    if (run.status === 'PAID') {
      throw new ValidationError('A paid month cannot be changed or paid again');
    }

    // Ensure system Salaries category exists
    await expensesService.ensureDefaultCategories(restaurantId);
    const salariesCategory = await prisma.expenseCategory.findFirst({
      where: { restaurantId, name: 'Salaries', deletedAt: null },
    });
    if (!salariesCategory) {
      throw new Error('Salaries expense category is missing');
    }

    return prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Mark run as PAID
      const updatedRun = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'PAID',
          paidAt: now,
          paidById: userId,
          paymentMethod,
        },
      });

      // 2. Process each line: deduct advance & create locked Expense
      for (const line of run.lines) {
        // Recover advance if applicable
        if (line.advanceRecovered > 0 && line.advanceId) {
          const adv = await tx.employeeAdvance.findUnique({ where: { id: line.advanceId } });
          if (adv) {
            const newRemaining = Math.max(0, +(adv.remainingAmount - line.advanceRecovered).toFixed(2));
            await tx.employeeAdvance.update({
              where: { id: adv.id },
              data: {
                remainingAmount: newRemaining,
                status: newRemaining <= 0.01 ? 'FULLY_RECOVERED' : 'ACTIVE',
              },
            });
          }
        }

        // Create one locked Expense per line under Salaries (source = PAYROLL)
        const refNo = `PAYROLL-${run.month}-${line.employee.id.slice(-4)}`;
        await tx.expense.create({
          data: {
            restaurantId,
            categoryId: salariesCategory.id,
            expenseDate: now,
            amount: line.netPay,
            method: paymentMethod,
            payee: `${line.employee.firstName} ${line.employee.lastName}`,
            referenceNo: refNo,
            billingPeriod: run.month,
            status: 'PAID',
            paidAt: now,
            source: 'PAYROLL',
            payrollLineId: line.id,
            note: `Salary payout for ${line.employee.firstName} ${line.employee.lastName} (${run.month})`,
            createdById: userId,
          },
        });
      }

      return updatedRun;
    });
  }

  async getPayslip(restaurantId: string, lineId: string) {
    const line = await prisma.payrollLine.findFirst({
      where: { id: lineId, payrollRun: { restaurantId } },
      include: {
        payrollRun: true,
        employee: {
          include: {
            roleRecord: true,
          },
        },
      },
    });
    if (!line) throw new NotFoundError('Payslip line not found');

    const business = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        name: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
      },
    });

    return {
      payslipNumber: `PS-${line.payrollRun.month}-${line.id.slice(-5)}`,
      month: line.payrollRun.month,
      runStatus: line.payrollRun.status,
      paymentMethod: line.payrollRun.paymentMethod || 'BANK_TRANSFER',
      paidAt: line.payrollRun.paidAt,
      business,
      employee: {
        id: line.employee.id,
        name: `${line.employee.firstName} ${line.employee.lastName}`,
        email: line.employee.email,
        phone: line.employee.phone,
        role: line.employee.roleRecord?.name || line.employee.role,
        salaryType: line.salaryType,
      },
      earnings: {
        base: line.base,
        regularHours: line.regularHours,
        overtimeHours: line.overtimeHours,
        overtimePay: line.overtimePay,
        allowances: line.allowances,
        bonus: line.bonus,
        totalGross: +(line.base + line.overtimePay + line.allowances + line.bonus).toFixed(2),
      },
      deductions: {
        absentDays: line.absentDays,
        absenceDeduction: line.absenceDeduction,
        deductions: line.deductions,
        advanceRecovered: line.advanceRecovered,
        totalDeductions: +(line.deductions + line.absenceDeduction + line.advanceRecovered).toFixed(2),
      },
      netPay: line.netPay,
      currency: 'PKR',
    };
  }
}
