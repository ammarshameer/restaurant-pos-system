import { PrismaClient } from '@prisma/client';
import { getCostPerSaleUnit, getOrderItemUnitCost, getRecipeUnitCost } from '../lib/costing';

const prisma = new PrismaClient();

const menuItemCostInclude = {
  ingredients: {
    include: {
      inventoryItem: true,
    },
  },
};

const orderItemCostInclude = {
  menuItem: {
    include: menuItemCostInclude,
  },
  deal: {
    include: {
      items: {
        include: {
          menuItem: {
            include: menuItemCostInclude,
          },
        },
      },
    },
  },
};

export class CostingService {
  private whereDates(field: 'createdAt' | 'processedAt', restaurantId: string, startDate?: string, endDate?: string) {
    const where: any = {};
    if (field === 'processedAt') {
      where.order = { restaurantId };
      where.processedAt = {};
      if (startDate) where.processedAt.gte = new Date(startDate);
      if (endDate) where.processedAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    } else {
      where.restaurantId = restaurantId;
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    return where;
  }

  private orderCogs(items: any[]): number {
    let cogs = 0;
    for (const item of items) {
      const itemQty = Number(item.quantity || 1);
      cogs += itemQty * getOrderItemUnitCost(item);
    }
    return +cogs.toFixed(2);
  }

  async summary(restaurantId: string, startDate?: string, endDate?: string) {
    const where = this.whereDates('createdAt', restaurantId, startDate, endDate);
    where.status = { not: 'cancelled' };
    const orders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        subtotal: true,
        total: true,
        tax: true,
        serviceCharge: true,
        deliveryCharge: true,
        items: {
          include: orderItemCostInclude,
        },
      },
    });

    const paymentWhere = this.whereDates('processedAt', restaurantId, startDate, endDate);
    const payments = await prisma.payment.findMany({
      where: paymentWhere,
      select: { method: true, amount: true, status: true },
    });

    const grossSales = +orders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0).toFixed(2);
    const discounts = +orders.reduce(
      (sum, order) =>
        sum +
        Math.max(
          0,
          Number(order.subtotal || 0) -
            Number(order.total || 0) +
            Number(order.tax || 0) +
            Number(order.serviceCharge || 0) +
            Number(order.deliveryCharge || 0)
        ),
      0
    ).toFixed(2);
    const refunds = +payments
      .filter((payment) => payment.status === 'REFUNDED')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
      .toFixed(2);
    const netSales = +(grossSales - discounts - refunds).toFixed(2);
    const tax = +orders.reduce((sum, order) => sum + Number(order.tax || 0), 0).toFixed(2);
    const serviceCharge = +orders.reduce((sum, order) => sum + Number(order.serviceCharge || 0), 0).toFixed(2);
    const deliveryCharge = +orders.reduce((sum, order) => sum + Number(order.deliveryCharge || 0), 0).toFixed(2);

    const cogs = +orders.reduce((sum, order) => sum + this.orderCogs(order.items), 0).toFixed(2);
    const grossProfit = +(netSales - cogs).toFixed(2);
    const grossMarginPercent = netSales > 0 ? +((grossProfit / netSales) * 100).toFixed(1) : 0;
    const foodCostPercent = netSales > 0 ? +((cogs / netSales) * 100).toFixed(1) : 0;
    const transactionCount = orders.length;
    const averageTicket =
      transactionCount > 0
        ? +(orders.reduce((sum, order) => sum + Number(order.total || 0), 0) / transactionCount).toFixed(2)
        : 0;

    const missingCostMap = new Map<string, { id: string; name: string; type: 'DISH' | 'DEAL'; count: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const unitCost = getOrderItemUnitCost(item);
        if (!unitCost || unitCost <= 0) {
          const key = item.dealId ? `deal:${item.dealId}` : `item:${item.menuItemId || item.name}`;
          const existing = missingCostMap.get(key);
          if (existing) {
            existing.count += Number(item.quantity || 1);
          } else {
            missingCostMap.set(key, {
              id: item.dealId || item.menuItemId || key,
              name: item.name || (item.dealId ? 'Unnamed Deal' : 'Unnamed Item'),
              type: item.dealId ? 'DEAL' : 'DISH',
              count: Number(item.quantity || 1),
            });
          }
        }
      }
    }
    const missingCostItems = Array.from(missingCostMap.values());

    return {
      grossSales,
      netSales,
      discounts,
      tax,
      serviceCharge,
      deliveryCharge,
      refunds,
      cogs,
      grossProfit,
      grossMarginPercent,
      foodCostPercent,
      averageTicket,
      transactionCount,
      missingCostItems,
    };
  }

  async getMenuCosting(restaurantId: string) {
    const items = await prisma.menuItem.findMany({
      where: { restaurantId, isAvailable: true },
      include: {
        category: true,
        ingredients: {
          include: {
            inventoryItem: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return items.map((item) => {
      const recipeCost = +getRecipeUnitCost(item).toFixed(2);
      const price = Number(item.price || 0);
      const margin = +(price - recipeCost).toFixed(2);
      const marginPercent = price > 0 ? +((margin / price) * 100).toFixed(1) : 0;
      const costPercent = price > 0 ? +((recipeCost / price) * 100).toFixed(1) : 0;

      return {
        id: item.id,
        name: item.name,
        categoryName: item.category?.name || 'Uncategorized',
        price,
        recipeCost,
        margin,
        marginPercent,
        costPercent,
        ingredientsCount: item.ingredients?.length || 0,
      };
    });
  }

  async getInventoryValuation(restaurantId: string) {
    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId },
      orderBy: { name: 'asc' },
    });

    let totalInventoryValue = 0;
    let lowStockCount = 0;

    const data = items.map((item) => {
      const quantity = Number(item.quantity || 0);
      const costPerUnit = Number(item.costPerUnit || 0);
      // `quantity` is stored in the sale/usage unit, so value it with the cost
      // of one sale unit rather than the purchase-unit cost.
      const costPerSaleUnit = getCostPerSaleUnit(item);
      const stockValue = +(quantity * costPerSaleUnit).toFixed(2);
      totalInventoryValue += stockValue;
      if (quantity <= Number(item.reorderPoint || 0)) {
        lowStockCount++;
      }
      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        category: item.category,
        quantity,
        unit: item.unit,
        costPerUnit,
        costPerSaleUnit: +costPerSaleUnit.toFixed(4),
        stockValue,
        reorderPoint: Number(item.reorderPoint || 0),
        isLowStock: quantity <= Number(item.reorderPoint || 0),
      };
    });

    return {
      items: data,
      totalInventoryValue: +totalInventoryValue.toFixed(2),
      lowStockCount,
      totalItemsCount: items.length,
    };
  }

  async getCostingTransactions(
    restaurantId: string,
    options?: { page?: number; limit?: number; startDate?: string; endDate?: string }
  ) {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 20);
    const where = this.whereDates('createdAt', restaurantId, options?.startDate, options?.endDate);
    where.status = { not: 'cancelled' };

    const [totalCount, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: orderItemCostInclude,
          },
          payments: true,
        },
      }),
    ]);

    const data = orders.map((order) => {
      const orderCogs = this.orderCogs(order.items);
      const total = Number(order.total || 0);
      const margin = +(total - orderCogs).toFixed(2);
      const marginPercent = total > 0 ? +((margin / total) * 100).toFixed(1) : 0;

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        customerName: order.customerName,
        total,
        cogs: orderCogs,
        margin,
        marginPercent,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        itemCount: order.items.reduce((s, i) => s + (i.quantity || 1), 0),
      };
    });

    return {
      data,
      page,
      limit,
      totalCount,
      hasMore: page * limit < totalCount,
    };
  }
}
