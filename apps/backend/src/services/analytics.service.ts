import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AnalyticsService {
  async getSalesAnalytics(restaurantId: string, startDate: Date, endDate: Date) {
    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { in: ['COMPLETED', 'completed', 'paid'] },
      },
      include: {
        items: {
          include: {
            menuItem: true,
          },
        },
        payments: {
          where: {
            status: 'COMPLETED',
          },
        },
      },
    });

    const totalRevenue = orders.reduce((sum, order) => {
      const orderPaid = order.payments.reduce((pSum, payment) => pSum + Number(payment.amount), 0);
      return sum + (orderPaid > 0 ? orderPaid : Number(order.total));
    }, 0);

    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? +(totalRevenue / totalOrders).toFixed(2) : 0;

    const itemsSold = orders.reduce((sum, order) => {
      return sum + order.items.reduce((iSum, item) => iSum + item.quantity, 0);
    }, 0);

    return {
      totalRevenue: +totalRevenue.toFixed(2),
      totalOrders,
      averageOrderValue,
      itemsSold,
      orders,
    };
  }

  async getTopSellingItems(
    restaurantId: string,
    startDateOrOptions?: Date | string | { startDate?: Date | string; endDate?: Date | string; page?: number; limit?: number },
    endDateParam?: Date | string,
    optionsParam?: { page?: number; limit?: number } | number
  ) {
    let startDate: Date;
    let endDate: Date;
    let page = 1;
    let limit = 50;

    if (startDateOrOptions && typeof startDateOrOptions === 'object' && !(startDateOrOptions instanceof Date)) {
      startDate = startDateOrOptions.startDate ? new Date(startDateOrOptions.startDate) : new Date(0);
      endDate = startDateOrOptions.endDate ? new Date(startDateOrOptions.endDate) : new Date();
      page = Math.max(1, Number(startDateOrOptions.page) || 1);
      limit = Math.max(1, Number(startDateOrOptions.limit) || 50);
    } else {
      startDate = typeof startDateOrOptions === 'string' || startDateOrOptions instanceof Date ? new Date(startDateOrOptions) : new Date(0);
      endDate = endDateParam ? new Date(endDateParam) : new Date();
      if (typeof optionsParam === 'number') {
        limit = optionsParam;
      } else if (optionsParam && typeof optionsParam === 'object') {
        page = Math.max(1, Number(optionsParam.page) || 1);
        limit = Math.max(1, Number(optionsParam.limit) || 50);
      }
    }

    const skip = (page - 1) * limit;

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { in: ['COMPLETED', 'completed', 'paid'] },
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    const itemStats = new Map<string, { id: string; name: string; category: string; quantity: number; revenue: number }>();

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const menuItem = item.menuItem;
        if (!menuItem) return;

        const price = Number(item.unitPrice || menuItem.price);
        const revenue = price * item.quantity;
        const catName = menuItem.category?.name || 'General';

        const existing = itemStats.get(item.menuItemId || menuItem.id);
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue += revenue;
        } else {
          itemStats.set(item.menuItemId || menuItem.id, {
            id: item.menuItemId || menuItem.id,
            name: menuItem.name || item.name || 'Dish',
            category: catName,
            quantity: item.quantity,
            revenue,
          });
        }
      });
    });

    const allSortedItems = Array.from(itemStats.values())
      .map((item) => ({
        ...item,
        revenue: +item.revenue.toFixed(2),
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .map((item, idx) => ({
        ...item,
        rank: idx + 1,
      }));

    const totalCount = allSortedItems.length;
    const pagedItems = allSortedItems.slice(skip, skip + limit);
    const hasMore = page * limit < totalCount;

    return {
      data: pagedItems,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async getRevenueByHour(restaurantId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: { in: ['COMPLETED', 'completed', 'paid'] },
      },
      include: {
        payments: {
          where: {
            status: 'COMPLETED',
          },
        },
      },
    });

    const hourlyRevenue = Array(24).fill(0);
    const hourlyOrders = Array(24).fill(0);

    orders.forEach((order) => {
      const hour = new Date(order.createdAt).getHours();
      const revenue = order.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      hourlyRevenue[hour] += revenue > 0 ? revenue : Number(order.total);
      hourlyOrders[hour] += 1;
    });

    return hourlyRevenue.map((revenue, hour) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      revenue: +revenue.toFixed(2),
      orders: hourlyOrders[hour],
    }));
  }

  async getTablePerformance(restaurantId: string, startDate: Date, endDate: Date) {
    const tables = await prisma.table.findMany({
      where: {
        floorPlan: {
          restaurantId,
        },
      },
      include: {
        orders: {
          where: {
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
            status: { in: ['COMPLETED', 'completed', 'paid'] },
          },
          include: {
            payments: {
              where: {
                status: 'COMPLETED',
              },
            },
          },
        },
      },
    });

    return tables.map((table) => {
      const totalRevenue = table.orders.reduce((sum, order) => {
        const paid = order.payments.reduce((pSum, payment) => pSum + Number(payment.amount), 0);
        return sum + (paid > 0 ? paid : Number(order.total));
      }, 0);

      const totalOrders = table.orders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        tableId: table.id,
        tableNumber: table.number,
        capacity: table.capacity,
        totalOrders,
        totalRevenue: +totalRevenue.toFixed(2),
        averageOrderValue: +averageOrderValue.toFixed(2),
      };
    });
  }

  async getEmployeePerformance(restaurantId: string, startDate: Date, endDate: Date) {
    const timeEntries = await prisma.timeEntry.findMany({
      where: {
        employee: {
          restaurantId,
        },
        clockIn: {
          gte: startDate,
          lte: endDate,
        },
        clockOut: {
          not: null,
        },
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
    });

    const employeeStats = new Map<string, any>();

    timeEntries.forEach((entry) => {
      const key = entry.employeeId;
      const hoursWorked = Number(entry.hoursWorked) || 0;
      const hourlyRate = Number(entry.employee.hourlyRate) || 15.0;
      const laborCost = hoursWorked * hourlyRate;

      const existing = employeeStats.get(key);
      if (existing) {
        existing.totalHours += hoursWorked;
        existing.totalShifts += 1;
        existing.totalLaborCost += laborCost;
      } else {
        employeeStats.set(key, {
          id: entry.employee.id,
          name: `${entry.employee.firstName} ${entry.employee.lastName}`,
          role: entry.employee.role,
          hourlyRate,
          totalHours: hoursWorked,
          totalShifts: 1,
          totalLaborCost: laborCost,
        });
      }
    });

    return Array.from(employeeStats.values()).map((emp) => ({
      ...emp,
      totalHours: +emp.totalHours.toFixed(1),
      totalLaborCost: +emp.totalLaborCost.toFixed(2),
    }));
  }

  async getDashboardSummary(restaurantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todaySales, activeOrders, allInventoryItems, activeTimeEntries] = await Promise.all([
      this.getSalesAnalytics(restaurantId, today, tomorrow),
      prisma.order.count({
        where: {
          restaurantId,
          status: {
            in: ['OPEN', 'IN_PROGRESS', 'READY', 'confirmed', 'preparing', 'ready'],
          },
        },
      }),
      prisma.inventoryItem.findMany({
        where: { restaurantId },
        select: { quantity: true, reorderPoint: true },
      }),
      prisma.timeEntry.count({
        where: {
          employee: {
            restaurantId,
          },
          clockOut: null,
        },
      }),
    ]);

    const lowStockCount = allInventoryItems.filter(
      (item) => Number(item.quantity) <= Number(item.reorderPoint)
    ).length;

    return {
      todayRevenue: todaySales.totalRevenue,
      todayOrders: todaySales.totalOrders,
      averageOrderValue: todaySales.averageOrderValue,
      itemsSold: todaySales.itemsSold,
      activeOrders,
      lowStockItems: lowStockCount,
      activeEmployees: activeTimeEntries,
    };
  }
}
