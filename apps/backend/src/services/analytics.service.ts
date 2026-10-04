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
        status: { notIn: ['cancelled', 'CANCELLED'] },
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
            deal: {
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
            },
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

    let itemsSold = 0;
    let dealsSold = 0;
    let standaloneItemsSold = 0;
    let dealRevenue = 0;
    let standaloneRevenue = 0;

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const price = Number(item.unitPrice || item.price || item.deal?.price || item.menuItem?.price || 0);
        const rev = price * itemQty;
        itemsSold += itemQty;
        if (item.dealId || item.deal) {
          dealsSold += itemQty;
          dealRevenue += rev;
        } else {
          standaloneItemsSold += itemQty;
          standaloneRevenue += rev;
        }
      });
    });

    return {
      totalRevenue: +totalRevenue.toFixed(2),
      dealRevenue: +dealRevenue.toFixed(2),
      standaloneRevenue: +standaloneRevenue.toFixed(2),
      totalOrders,
      averageOrderValue,
      itemsSold,
      dealsSold,
      standaloneItemsSold,
      orders,
    };
  }

  /**
   * 1. SALES / REVENUE BREAKDOWN (Commercial Sales View):
   * Each sold Deal appears as its own line item at the deal's bundled price.
   * Deals are NOT split into components here.
   * Standalone (non-deal) menu items show at their regular prices.
   */
  async getProductRevenueBreakdown(
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

    // Pre-fetch all deals for the restaurant to build a lookup fallback
    const allDeals = await (prisma as any).deal.findMany({
      where: { restaurantId },
    }).catch(() => []);
    const dealsById = new Map<string, any>();
    const dealsByName = new Map<string, any>();
    allDeals.forEach((d: any) => {
      dealsById.set(d.id, d);
      dealsByName.set((d.name || '').trim().toLowerCase(), d);
    });

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { notIn: ['cancelled', 'CANCELLED'] },
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
            deal: true,
          },
        },
      },
    });

    const productStats = new Map<
      string,
      {
        id: string;
        name: string;
        type: 'DEAL' | 'MENU_ITEM';
        category: string;
        quantity: number;
        unitPrice: number;
        revenue: number;
        dealId?: string | null;
        menuItemId?: string | null;
      }
    >();

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const normalizedName = (item.name || '').trim().toLowerCase();
        const matchedDeal = item.deal || (item.dealId ? dealsById.get(item.dealId) : null) || dealsByName.get(normalizedName);

        if (item.dealId || matchedDeal) {
          // It's a Deal sale
          const dealId = item.dealId || matchedDeal?.id || item.name;
          const dealName = matchedDeal?.name || item.name || 'Combo Deal';
          const unitPrice = Number(item.unitPrice || item.price || matchedDeal?.price || 0);
          const revenue = unitPrice * itemQty;
          const key = `deal:${dealId}`;

          const existing = productStats.get(key);
          if (existing) {
            existing.quantity += itemQty;
            existing.revenue += revenue;
            existing.unitPrice = existing.quantity > 0 ? +(existing.revenue / existing.quantity).toFixed(2) : unitPrice;
          } else {
            productStats.set(key, {
              id: dealId,
              dealId: matchedDeal?.id || item.dealId || null,
              menuItemId: null,
              name: dealName,
              type: 'DEAL',
              category: 'Combo Deals',
              quantity: itemQty,
              unitPrice: +unitPrice.toFixed(2),
              revenue,
            });
          }
        } else {
          // Regular Menu Item sale
          const menuItem = item.menuItem;
          const mId = item.menuItemId || menuItem?.id || item.name;
          const mName = menuItem?.name || item.name || 'Dish';
          const catName = menuItem?.category?.name || 'General';
          const unitPrice = Number(item.unitPrice || item.price || menuItem?.price || 0);
          const revenue = unitPrice * itemQty;
          const key = `menu:${mId}`;

          const existing = productStats.get(key);
          if (existing) {
            existing.quantity += itemQty;
            existing.revenue += revenue;
            existing.unitPrice = existing.quantity > 0 ? +(existing.revenue / existing.quantity).toFixed(2) : unitPrice;
            if (menuItem?.name) existing.name = menuItem.name;
            if (catName !== 'General') existing.category = catName;
          } else {
            productStats.set(key, {
              id: mId,
              dealId: null,
              menuItemId: menuItem?.id || item.menuItemId || null,
              name: mName,
              type: 'MENU_ITEM',
              category: catName,
              quantity: itemQty,
              unitPrice: +unitPrice.toFixed(2),
              revenue,
            });
          }
        }
      });
    });

    const allSortedProducts = Array.from(productStats.values())
      .map((item) => ({
        ...item,
        revenue: +item.revenue.toFixed(2),
      }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
      .map((item, idx) => ({
        ...item,
        rank: idx + 1,
      }));

    const totalCount = allSortedProducts.length;
    const pagedItems = allSortedProducts.slice(skip, skip + limit);
    const hasMore = page * limit < totalCount;

    const totalRevenue = allSortedProducts.reduce((sum, item) => sum + item.revenue, 0);
    const totalQuantity = allSortedProducts.reduce((sum, item) => sum + item.quantity, 0);

    return {
      data: pagedItems,
      page,
      limit,
      totalCount,
      hasMore,
      totalRevenue: +totalRevenue.toFixed(2),
      totalQuantity,
    };
  }

  /**
   * 2. ITEM POPULARITY / "TOP SELLING ITEMS" (True Consumption & Kitchen Usage View):
   * For each MenuItem, combines:
   *  a) direct quantity sold as standalone order item
   *  b) expanded quantity sold as component of DealItem (deal component qty × deals sold)
   */
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

    // Pre-fetch all deals with their component dealItems & menuItems
    const allDeals = await (prisma as any).deal.findMany({
      where: { restaurantId },
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
    }).catch(() => []);

    const dealsById = new Map<string, any>();
    const dealsByName = new Map<string, any>();
    allDeals.forEach((d: any) => {
      dealsById.set(d.id, d);
      dealsByName.set((d.name || '').trim().toLowerCase(), d);
    });

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { notIn: ['cancelled', 'CANCELLED'] },
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
            deal: {
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
            },
          },
        },
      },
    });

    const itemStats = new Map<
      string,
      {
        id: string;
        name: string;
        category: string;
        directQuantity: number;
        comboQuantity: number;
        quantity: number; // total consumed = directQuantity + comboQuantity
        revenue: number;
      }
    >();

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const normalizedName = (item.name || '').trim().toLowerCase();
        const matchedDeal = item.deal || (item.dealId ? dealsById.get(item.dealId) : null) || dealsByName.get(normalizedName);

        if (item.dealId || matchedDeal) {
          // DEAL SALE: Expand into component menu items (DealItems)
          const dealComponents = matchedDeal?.items || item.deal?.items || [];
          dealComponents.forEach((dealItem: any) => {
            const menuItem = dealItem.menuItem;
            const mId = dealItem.menuItemId || menuItem?.id;
            if (!mId) return;

            const componentMultiplier = Number(dealItem.quantity) || 1;
            const expandedComboQty = componentMultiplier * itemQty;
            const mName = menuItem?.name || 'Dish';
            const catName = menuItem?.category?.name || 'General';

            const existing = itemStats.get(mId);
            if (existing) {
              existing.comboQuantity += expandedComboQty;
              existing.quantity += expandedComboQty;
              if (menuItem?.name) existing.name = menuItem.name;
              if (catName !== 'General') existing.category = catName;
            } else {
              itemStats.set(mId, {
                id: mId,
                name: mName,
                category: catName,
                directQuantity: 0,
                comboQuantity: expandedComboQty,
                quantity: expandedComboQty,
                revenue: 0,
              });
            }
          });
        } else {
          // STANDALONE MENU ITEM SALE
          const menuItem = item.menuItem;
          const mId = item.menuItemId || menuItem?.id || item.name;
          if (!mId) return;

          const mName = menuItem?.name || item.name || 'Dish';
          const catName = menuItem?.category?.name || 'General';
          const price = Number(item.unitPrice || item.price || menuItem?.price || 0);
          const revenue = price * itemQty;

          const existing = itemStats.get(mId);
          if (existing) {
            existing.directQuantity += itemQty;
            existing.quantity += itemQty;
            existing.revenue += revenue;
            if (menuItem?.name) existing.name = menuItem.name;
            if (catName !== 'General') existing.category = catName;
          } else {
            itemStats.set(mId, {
              id: mId,
              name: mName,
              category: catName,
              directQuantity: itemQty,
              comboQuantity: 0,
              quantity: itemQty,
              revenue,
            });
          }
        }
      });
    });

    const allSortedItems = Array.from(itemStats.values())
      .map((item) => ({
        ...item,
        revenue: +item.revenue.toFixed(2),
      }))
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
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
