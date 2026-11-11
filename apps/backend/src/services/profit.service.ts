import { PrismaClient } from '@prisma/client';
import { ValidationError } from '../lib/errors';
import { getOrderItemUnitCost } from '../lib/costing';

const prisma = new PrismaClient();

export class ProfitService {
  async getMonthlyProfitAndLoss(restaurantId: string, month: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const [yearStr, monthStr] = (month || '').split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    if (!y || !m || m < 1 || m > 12) {
      throw new ValidationError('Valid month is required (YYYY-MM)');
    }

    const startDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    // 1. Sales & COGS from Orders
    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        status: { not: 'cancelled' },
        createdAt: { gte: startDate, lte: endDate },
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                ingredients: {
                  include: {
                    inventoryItem: true,
                  },
                },
              },
            },
            deal: {
              include: {
                items: {
                  include: {
                    menuItem: {
                      include: {
                        ingredients: {
                          include: {
                            inventoryItem: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    let grossSales = 0;
    let discounts = 0;
    let refunds = 0;
    let cogs = 0;
    let missingCostItemsCount = 0;

    for (const order of orders) {
      const orderTotal = Number(order.total || 0);
      const computedGross = Number(order.subtotal || 0) + Number(order.tax || 0) + Number(order.serviceCharge || 0) + Number(order.deliveryCharge || 0);
      const orderDiscount = computedGross > orderTotal ? +(computedGross - orderTotal).toFixed(2) : 0;

      grossSales += computedGross > 0 ? computedGross : orderTotal;
      discounts += orderDiscount;

      for (const item of order.items) {
        let itemCost = getOrderItemUnitCost(item);

        if (itemCost === null || itemCost === undefined || itemCost <= 0) {
          missingCostItemsCount++;
          itemCost = 0;
        }

        cogs += itemCost * Number(item.quantity || 1);
      }
    }

    const netSales = Math.max(0, +(grossSales - discounts - refunds).toFixed(2));
    cogs = +cogs.toFixed(2);
    const grossProfit = +(netSales - cogs).toFixed(2);
    const grossMarginPercent = netSales > 0 ? +((grossProfit / netSales) * 100).toFixed(2) : 0;

    // 2. Expenses (excluding voided, status = PAID)
    const expenses = await prisma.expense.findMany({
      where: {
        restaurantId,
        status: 'PAID',
        voidedAt: null,
        expenseDate: { gte: startDate, lte: endDate },
      },
      include: {
        category: {
          select: { id: true, name: true, isSystem: true },
        },
      },
    });

    const categoryMap: Record<string, { categoryId: string; categoryName: string; isSystem: boolean; amount: number }> = {};
    let totalExpenses = 0;
    let payrollSalariesTotal = 0;

    for (const exp of expenses) {
      const amt = Number(exp.amount) || 0;
      totalExpenses += amt;

      const catId = exp.categoryId;
      const catName = exp.category?.name || 'Miscellaneous';
      const isSystem = Boolean(exp.category?.isSystem);

      if (!categoryMap[catId]) {
        categoryMap[catId] = { categoryId: catId, categoryName: catName, isSystem, amount: 0 };
      }
      categoryMap[catId].amount += amt;

      if (catName.toLowerCase() === 'salaries') {
        payrollSalariesTotal += amt;
      }
    }

    totalExpenses = +totalExpenses.toFixed(2);
    payrollSalariesTotal = +payrollSalariesTotal.toFixed(2);
    const expensesByCategory = Object.values(categoryMap)
      .map((c) => ({ ...c, amount: +c.amount.toFixed(2) }))
      .sort((a, b) => b.amount - a.amount);

    // 3. Net Profit
    const netProfit = +(grossProfit - totalExpenses).toFixed(2);
    const netMarginPercent = netSales > 0 ? +((netProfit / netSales) * 100).toFixed(2) : 0;

    // 4. Cash Collected vs Customer Dues Receivable
    const [regularPaymentsAgg, duesPaymentsAgg, chargesAgg, totalReceivableAgg] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          order: { restaurantId },
          status: 'COMPLETED',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      prisma.customerLedgerEntry.aggregate({
        where: {
          restaurantId,
          type: 'PAYMENT',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      prisma.customerLedgerEntry.aggregate({
        where: {
          restaurantId,
          type: 'CHARGE',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      prisma.customer.aggregate({
        where: { restaurantId },
        _sum: { balanceDue: true },
      }),
    ]);

    const regularPayments = Number(regularPaymentsAgg._sum.amount || 0);
    const duesPaymentsCollected = Number(duesPaymentsAgg._sum.amount || 0);
    const totalCashCollected = +(regularPayments + duesPaymentsCollected).toFixed(2);

    const newCreditCharges = Number(chargesAgg._sum.amount || 0);
    const totalOutstandingDues = Number(totalReceivableAgg._sum.balanceDue || 0);

    // 5. Real labor number from Payroll module
    const payrollRun = await prisma.payrollRun.findUnique({
      where: { restaurantId_month: { restaurantId, month } },
      select: { id: true, status: true, totalNet: true, totalGross: true, employeeCount: true },
    });

    let realLaborCost = 0;
    if (payrollRun) {
      realLaborCost = payrollRun.totalNet;
    } else {
      // Fallback: sum of monthly salaries of active staff if run not generated yet
      const staffSalaries = await prisma.employee.aggregate({
        where: { restaurantId, isActive: true },
        _sum: { monthlySalary: true },
      });
      realLaborCost = Number(staffSalaries._sum.monthlySalary || 0);
    }

    return {
      month,
      currency: 'PKR',
      summary: {
        grossSales: +grossSales.toFixed(2),
        discounts: +discounts.toFixed(2),
        refunds: +refunds.toFixed(2),
        netSales,
        cogs,
        grossProfit,
        grossMarginPercent,
        totalExpenses,
        netProfit,
        netMarginPercent,
        missingCostItemsCount,
      },
      expensesByCategory,
      cashFlowVsDues: {
        totalCashCollected,
        regularPayments: +regularPayments.toFixed(2),
        duesPaymentsCollected: +duesPaymentsCollected.toFixed(2),
        newCreditCharges: +newCreditCharges.toFixed(2),
        totalOutstandingDues: +totalOutstandingDues.toFixed(2),
      },
      payrollLabor: {
        recordedSalariesExpense: payrollSalariesTotal,
        payrollRunStatus: payrollRun?.status || 'NOT_GENERATED',
        realLaborCost: +realLaborCost.toFixed(2),
        payrollRunId: payrollRun?.id || null,
      },
    };
  }
}
