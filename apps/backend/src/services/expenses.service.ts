import { PrismaClient } from '@prisma/client';
import { ValidationError, NotFoundError } from '../lib/errors';

const prisma = new PrismaClient();

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Electricity', isSystem: false },
  { name: 'Gas', isSystem: false },
  { name: 'Water', isSystem: false },
  { name: 'Rent', isSystem: false },
  { name: 'Internet & Phone', isSystem: false },
  { name: 'Salaries', isSystem: true }, // Locked system category
  { name: 'Maintenance & Repairs', isSystem: false },
  { name: 'Cleaning & Supplies', isSystem: false },
  { name: 'Packaging', isSystem: false },
  { name: 'Marketing', isSystem: false },
  { name: 'Transport & Fuel', isSystem: false },
  { name: 'Licences & Taxes', isSystem: false },
  { name: 'Miscellaneous', isSystem: false },
];

export class ExpensesService {
  async ensureDefaultCategories(restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const existing = await prisma.expenseCategory.findMany({
      where: { restaurantId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

    const toCreate = DEFAULT_EXPENSE_CATEGORIES.filter(
      (c) => !existingNames.has(c.name.toLowerCase())
    );

    if (toCreate.length > 0) {
      await prisma.expenseCategory.createMany({
        data: toCreate.map((c) => ({
          restaurantId,
          name: c.name,
          isSystem: c.isSystem,
        })),
      });
    }
  }

  async getCategories(restaurantId: string) {
    await this.ensureDefaultCategories(restaurantId);
    return prisma.expenseCategory.findMany({
      where: { restaurantId, deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  async createCategory(restaurantId: string, data: { name: string; description?: string }) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const trimmed = (data.name || '').trim();
    if (!trimmed) {
      throw new ValidationError('Category name is required');
    }
    if (trimmed.toLowerCase() === 'salaries') {
      throw new ValidationError('Salaries is a system category and cannot be created manually');
    }

    const existing = await prisma.expenseCategory.findUnique({
      where: { restaurantId_name: { restaurantId, name: trimmed } },
    });

    if (existing) {
      if (existing.deletedAt) {
        return prisma.expenseCategory.update({
          where: { id: existing.id },
          data: { deletedAt: null, description: data.description || existing.description },
        });
      }
      throw new ValidationError(`Category "${trimmed}" already exists`);
    }

    return prisma.expenseCategory.create({
      data: {
        restaurantId,
        name: trimmed,
        description: data.description?.trim() || null,
        isSystem: false,
      },
    });
  }

  async updateCategory(restaurantId: string, id: string, data: { name?: string; description?: string }) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id, restaurantId, deletedAt: null },
    });
    if (!category) {
      throw new NotFoundError('Category not found');
    }
    if (category.isSystem) {
      throw new ValidationError('System categories cannot be edited or renamed');
    }

    const trimmed = data.name !== undefined ? data.name.trim() : category.name;
    if (!trimmed) {
      throw new ValidationError('Category name cannot be empty');
    }
    if (trimmed.toLowerCase() === 'salaries') {
      throw new ValidationError('Cannot rename category to Salaries');
    }

    return prisma.expenseCategory.update({
      where: { id },
      data: {
        name: trimmed,
        description: data.description !== undefined ? data.description?.trim() || null : category.description,
      },
    });
  }

  async deleteCategory(restaurantId: string, id: string) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id, restaurantId, deletedAt: null },
    });
    if (!category) {
      throw new NotFoundError('Category not found');
    }
    if (category.isSystem) {
      throw new ValidationError('System categories cannot be deleted');
    }

    // Soft delete
    return prisma.expenseCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getExpenses(
    restaurantId: string,
    params: {
      page?: number;
      limit?: number;
      month?: string;
      startDate?: string;
      endDate?: string;
      categoryId?: string;
      status?: string;
      source?: string;
      search?: string;
      includeVoided?: boolean;
    }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    await this.ensureDefaultCategories(restaurantId);

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = { restaurantId };

    if (!params.includeVoided) {
      where.voidedAt = null;
    }

    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }

    if (params.status) {
      where.status = params.status.toUpperCase();
    }

    if (params.source) {
      where.source = params.source.toUpperCase();
    }

    if (params.month) {
      const [yearStr, monthStr] = params.month.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10) - 1;
      const start = new Date(Date.UTC(y, m, 1, 0, 0, 0));
      const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      where.expenseDate = { gte: start, lte: end };
    } else if (params.startDate || params.endDate) {
      where.expenseDate = {};
      if (params.startDate) where.expenseDate.gte = new Date(params.startDate);
      if (params.endDate) where.expenseDate.lte = new Date(params.endDate);
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { payee: { contains: q } },
        { referenceNo: { contains: q } },
        { note: { contains: q } },
      ];
    }

    const [total, expenses, allScopedExpenses] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expenseDate: 'desc' },
        include: {
          category: { select: { id: true, name: true, isSystem: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      // Query non-voided totals for the filtered range to power summary cards
      prisma.expense.findMany({
        where: { ...where, voidedAt: null },
        select: {
          amount: true,
          status: true,
          categoryId: true,
          category: { select: { name: true } },
        },
      }),
    ]);

    let totalAmount = 0;
    let paidAmount = 0;
    let unpaidAmount = 0;
    const categoryTotals: Record<string, { categoryId: string; name: string; amount: number }> = {};

    for (const exp of allScopedExpenses) {
      const amt = Number(exp.amount) || 0;
      totalAmount += amt;
      if (exp.status === 'PAID') {
        paidAmount += amt;
      } else {
        unpaidAmount += amt;
      }

      const catName = exp.category?.name || 'Uncategorized';
      if (!categoryTotals[exp.categoryId]) {
        categoryTotals[exp.categoryId] = { categoryId: exp.categoryId, name: catName, amount: 0 };
      }
      categoryTotals[exp.categoryId].amount += amt;
    }

    return {
      data: expenses,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalAmount: +totalAmount.toFixed(2),
        paidAmount: +paidAmount.toFixed(2),
        unpaidAmount: +unpaidAmount.toFixed(2),
        byCategory: Object.values(categoryTotals).sort((a, b) => b.amount - a.amount),
      },
    };
  }

  async getExpenseById(restaurantId: string, id: string) {
    const expense = await prisma.expense.findFirst({
      where: { id, restaurantId },
      include: {
        category: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        payrollLine: true,
        recurringExpense: true,
      },
    });
    if (!expense) {
      throw new NotFoundError('Expense not found');
    }
    return expense;
  }

  async createExpense(
    restaurantId: string,
    data: {
      categoryId: string;
      expenseDate: string | Date;
      amount: number;
      method?: string;
      payee?: string;
      referenceNo?: string;
      billingPeriod?: string;
      dueDate?: string | Date;
      status?: string;
      paidAt?: string | Date;
      note?: string;
      billPhotoUrl?: string;
      source?: string;
      clientRef?: string;
    },
    userId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    // ClientRef idempotency check
    if (data.clientRef && data.clientRef.trim()) {
      const existing = await prisma.expense.findFirst({
        where: { restaurantId, clientRef: data.clientRef.trim() },
        include: { category: true },
      });
      if (existing) {
        return existing;
      }
    }

    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new ValidationError('Expense amount must be greater than zero');
    }

    const category = await prisma.expenseCategory.findFirst({
      where: { id: data.categoryId, restaurantId, deletedAt: null },
    });
    if (!category) {
      throw new ValidationError('Invalid expense category');
    }

    const source = (data.source || 'MANUAL').toUpperCase();
    if (category.name.toLowerCase() === 'salaries' && source !== 'PAYROLL') {
      throw new ValidationError('Salaries expenses can only be generated through the Payroll module');
    }

    const status = (data.status || 'PAID').toUpperCase();
    const expenseDate = data.expenseDate ? new Date(data.expenseDate) : new Date();
    let paidAt: Date | null = null;
    if (status === 'PAID') {
      paidAt = data.paidAt ? new Date(data.paidAt) : expenseDate;
    }

    return prisma.expense.create({
      data: {
        restaurantId,
        categoryId: category.id,
        expenseDate,
        amount: +amount.toFixed(2),
        method: data.method || 'CASH',
        payee: data.payee?.trim() || null,
        referenceNo: data.referenceNo?.trim() || null,
        billingPeriod: data.billingPeriod?.trim() || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        status,
        paidAt,
        note: data.note?.trim() || null,
        billPhotoUrl: data.billPhotoUrl || null,
        source,
        clientRef: data.clientRef?.trim() || null,
        createdById: userId || null,
      },
      include: {
        category: true,
      },
    });
  }

  async markPaid(
    restaurantId: string,
    id: string,
    data: { method?: string; paidAt?: string | Date },
    _userId?: string
  ) {
    const expense = await prisma.expense.findFirst({
      where: { id, restaurantId },
    });
    if (!expense) {
      throw new NotFoundError('Expense not found');
    }
    if (expense.voidedAt) {
      throw new ValidationError('Cannot pay a voided expense');
    }
    if (expense.status === 'PAID') {
      return expense;
    }

    return prisma.expense.update({
      where: { id },
      data: {
        status: 'PAID',
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        method: data.method || expense.method,
      },
      include: { category: true },
    });
  }

  async voidExpense(restaurantId: string, id: string, voidReason: string, userId: string) {
    const expense = await prisma.expense.findFirst({
      where: { id, restaurantId },
    });
    if (!expense) {
      throw new NotFoundError('Expense not found');
    }
    if (expense.voidedAt) {
      throw new ValidationError('Expense is already voided');
    }
    if (expense.source === 'PAYROLL') {
      throw new ValidationError('Payroll expenses are locked and cannot be individually voided');
    }

    const reason = (voidReason || '').trim();
    if (!reason) {
      throw new ValidationError('A void reason is required');
    }

    return prisma.expense.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidReason: reason,
        voidedById: userId,
      },
      include: { category: true },
    });
  }

  // ============================================
  // RECURRING EXPENSES
  // ============================================

  async getRecurringExpenses(restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    return prisma.recurringExpense.findMany({
      where: { restaurantId, deletedAt: null },
      include: { category: true },
      orderBy: { dayOfMonth: 'asc' },
    });
  }

  async createRecurringExpense(
    restaurantId: string,
    data: {
      categoryId: string;
      name: string;
      amount: number;
      method?: string;
      payee?: string;
      dayOfMonth?: number;
      note?: string;
    }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const name = (data.name || '').trim();
    if (!name) {
      throw new ValidationError('Template name is required');
    }
    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new ValidationError('Amount must be greater than zero');
    }

    const category = await prisma.expenseCategory.findFirst({
      where: { id: data.categoryId, restaurantId, deletedAt: null },
    });
    if (!category) {
      throw new ValidationError('Invalid expense category');
    }
    if (category.name.toLowerCase() === 'salaries') {
      throw new ValidationError('Salaries cannot be set up as recurring expense templates');
    }

    const dayOfMonth = Math.max(1, Math.min(28, Number(data.dayOfMonth) || 1));

    return prisma.recurringExpense.create({
      data: {
        restaurantId,
        categoryId: category.id,
        name,
        amount: +amount.toFixed(2),
        method: data.method || 'BANK_TRANSFER',
        payee: data.payee?.trim() || null,
        dayOfMonth,
        note: data.note?.trim() || null,
        isActive: true,
      },
      include: { category: true },
    });
  }

  async updateRecurringExpense(
    restaurantId: string,
    id: string,
    data: Partial<{
      categoryId: string;
      name: string;
      amount: number;
      method: string;
      payee: string;
      dayOfMonth: number;
      note: string;
      isActive: boolean;
    }>
  ) {
    const template = await prisma.recurringExpense.findFirst({
      where: { id, restaurantId, deletedAt: null },
    });
    if (!template) {
      throw new NotFoundError('Recurring expense template not found');
    }

    const updateData: any = {};
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) throw new ValidationError('Name cannot be empty');
      updateData.name = name;
    }
    if (data.amount !== undefined) {
      const amount = Number(data.amount);
      if (isNaN(amount) || amount <= 0) throw new ValidationError('Amount must be greater than zero');
      updateData.amount = +amount.toFixed(2);
    }
    if (data.categoryId !== undefined) {
      const cat = await prisma.expenseCategory.findFirst({
        where: { id: data.categoryId, restaurantId, deletedAt: null },
      });
      if (!cat) throw new ValidationError('Invalid category');
      if (cat.name.toLowerCase() === 'salaries') {
        throw new ValidationError('Salaries cannot be set up as recurring templates');
      }
      updateData.categoryId = cat.id;
    }
    if (data.dayOfMonth !== undefined) {
      updateData.dayOfMonth = Math.max(1, Math.min(28, Number(data.dayOfMonth) || 1));
    }
    if (data.method !== undefined) updateData.method = data.method;
    if (data.payee !== undefined) updateData.payee = data.payee?.trim() || null;
    if (data.note !== undefined) updateData.note = data.note?.trim() || null;
    if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);

    return prisma.recurringExpense.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });
  }

  async deleteRecurringExpense(restaurantId: string, id: string) {
    const template = await prisma.recurringExpense.findFirst({
      where: { id, restaurantId, deletedAt: null },
    });
    if (!template) {
      throw new NotFoundError('Recurring expense template not found');
    }
    return prisma.recurringExpense.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async generateDueRecurring(restaurantId: string, month: string, userId?: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const [yearStr, monthStr] = (month || '').split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    if (!y || !m || m < 1 || m > 12) {
      throw new ValidationError('Valid month is required (YYYY-MM)');
    }

    const templates = await prisma.recurringExpense.findMany({
      where: {
        restaurantId,
        isActive: true,
        deletedAt: null,
        OR: [{ lastGeneratedMonth: null }, { lastGeneratedMonth: { not: month } }],
      },
      include: { category: true },
    });

    const createdExpenses: any[] = [];

    for (const t of templates) {
      const day = Math.min(t.dayOfMonth, 28);
      const dueDate = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
      const ref = `REC-${month}-${t.id.slice(-4)}`;

      // Check if already created
      const exists = await prisma.expense.findFirst({
        where: { restaurantId, recurringExpenseId: t.id, billingPeriod: month },
      });
      if (!exists) {
        const exp = await prisma.expense.create({
          data: {
            restaurantId,
            categoryId: t.categoryId,
            expenseDate: dueDate,
            dueDate,
            amount: t.amount,
            method: t.method,
            payee: t.payee,
            referenceNo: ref,
            billingPeriod: month,
            status: 'UNPAID',
            source: 'RECURRING',
            recurringExpenseId: t.id,
            note: t.note || `Monthly recurring: ${t.name}`,
            createdById: userId || null,
          },
        });
        createdExpenses.push(exp);
      }

      await prisma.recurringExpense.update({
        where: { id: t.id },
        data: { lastGeneratedMonth: month },
      });
    }

    return { generated: createdExpenses.length, expenses: createdExpenses };
  }

  async exportExpensesCSV(restaurantId: string, params: any) {
    const result = await this.getExpenses(restaurantId, {
      ...params,
      limit: 10000,
      includeVoided: true,
    });

    const headers = [
      'ID',
      'Date',
      'Category',
      'Amount (PKR)',
      'Status',
      'Method',
      'Payee',
      'Reference / Bill No',
      'Billing Period',
      'Due Date',
      'Source',
      'Voided',
      'Void Reason',
      'Notes',
    ];

    const escape = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = result.data.map((e) => [
      escape(e.id),
      escape(new Date(e.expenseDate).toISOString().split('T')[0]),
      escape(e.category?.name || ''),
      escape(e.amount),
      escape(e.status),
      escape(e.method),
      escape(e.payee || ''),
      escape(e.referenceNo || ''),
      escape(e.billingPeriod || ''),
      escape(e.dueDate ? new Date(e.dueDate).toISOString().split('T')[0] : ''),
      escape(e.source),
      escape(e.voidedAt ? 'YES' : 'NO'),
      escape(e.voidReason || ''),
      escape(e.note || ''),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
