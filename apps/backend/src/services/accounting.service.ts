import { PrismaClient } from '@prisma/client';
import { hasFeature } from './feature.service';

const prisma = new PrismaClient();

export class AccountingService {
  private whereDates(field: 'createdAt' | 'processedAt', restaurantId: string, startDate?: string, endDate?: string) {
    const where: any = { restaurantId };
    if (field === 'processedAt') {
      where.order = { restaurantId };
      where.processedAt = {};
      if (startDate) where.processedAt.gte = new Date(startDate);
      if (endDate) where.processedAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    } else {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    return where;
  }

  async summary(restaurantId: string, startDate?: string, endDate?: string) {
    const where = this.whereDates('createdAt', restaurantId, startDate, endDate);
    const orders = await prisma.order.findMany({ where, select: { id: true, subtotal: true, total: true, tax: true, serviceCharge: true, deliveryCharge: true, items: { include: { menuItem: true } } } });
    const paymentWhere = this.whereDates('processedAt', restaurantId, startDate, endDate);
    const payments = await prisma.payment.findMany({ where: paymentWhere, select: { method: true, amount: true, status: true } });
    const grossSales = orders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
    const discounts = orders.reduce((sum, order) => sum + Math.max(0, Number(order.subtotal || 0) - Number(order.total || 0) + Number(order.tax || 0) + Number(order.serviceCharge || 0) + Number(order.deliveryCharge || 0)), 0);
    const completedPayments = payments.filter((payment) => payment.status !== 'REFUNDED' && payment.status !== 'FAILED');
    const paymentsByMethodMap = new Map<string, { count: number; amount: number }>();
    for (const payment of completedPayments) {
      const current = paymentsByMethodMap.get(payment.method) || { count: 0, amount: 0 };
      current.count++;
      current.amount += Number(payment.amount || 0);
      paymentsByMethodMap.set(payment.method, current);
    }
    const refunds = payments.filter((payment) => payment.status === 'REFUNDED').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const result: any = {
      grossSales,
      netSales: grossSales - discounts - refunds,
      discounts,
      tax: orders.reduce((sum, order) => sum + Number(order.tax || 0), 0),
      serviceCharge: orders.reduce((sum, order) => sum + Number(order.serviceCharge || 0), 0),
      deliveryCharge: orders.reduce((sum, order) => sum + Number(order.deliveryCharge || 0), 0),
      refunds,
      paymentsByMethod: [...paymentsByMethodMap].map(([method, values]) => ({ method, ...values })),
      transactionCount: orders.length,
      averageTicket: orders.length ? orders.reduce((sum, order) => sum + Number(order.total || 0), 0) / orders.length : 0,
    };
    if (await hasFeature(restaurantId, 'costing')) {
      const cogs = orders.reduce((sum, order) => sum + order.items.reduce((itemSum: number, item: any) => itemSum + Number(item.quantity || 0) * Number(item.menuItem?.cost || 0), 0), 0);
      result.cogs = cogs;
      result.grossProfit = result.netSales - cogs;
      result.grossMarginPercent = result.netSales ? (result.grossProfit / result.netSales) * 100 : 0;
    }
    return result;
  }

  async transactions(restaurantId: string, page: number, limit: number, startDate?: string, endDate?: string, type?: string) {
    const where = this.whereDates('createdAt', restaurantId, startDate, endDate);
    if (type && type !== 'ALL') where.paymentStatus = type;
    const [totalCount, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { payments: true } }),
    ]);
    return { data: orders, page, limit, totalCount, hasMore: page * limit < totalCount };
  }
}
