import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AnalyticsService {
  async getSalesAnalytics(restaurantId: string, startDate: Date, endDate: Date) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
      totalOrders,
      averageOrderValue,
      itemsSold,
      dealsSold,
      standaloneItemsSold,
      dealRevenue: +dealRevenue.toFixed(2),
      standaloneRevenue: +standaloneRevenue.toFixed(2),
    };
  }

  /**
   * 1. SALES/REVENUE BREAKDOWN (Daily / Period Sales Breakdown):
   * Shows distinct sale line items for what was sold:
   *  - Each Deal sold appears as its own line item named by the Deal (e.g. "Pizza + Drink Combo")
   *  - Regular standalone menu items appear as their own line items
   */
  async getProductRevenueBreakdown(
    restaurantId: string,
    startDateOrOptions?: Date | string | { startDate?: Date | string; endDate?: Date | string; page?: number; limit?: number },
    endDateParam?: Date | string,
    optionsParam?: { page?: number; limit?: number } | number
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
      dealsByName.set(d.name.toLowerCase().trim(), d);
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

    const breakdownMap = new Map<
      string,
      {
        id: string;
        name: string;
        type: 'DEAL' | 'MENU_ITEM';
        category: string;
        quantity: number;
        revenue: number;
        unitPrice: number;
      }
    >();

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const matchedDeal =
          item.deal ||
          (item.dealId ? dealsById.get(item.dealId) : null) ||
          (item.name ? dealsByName.get(item.name.toLowerCase().trim()) : null);

        const isDeal = Boolean(item.dealId || matchedDeal);

        if (isDeal) {
          const dealName = matchedDeal?.name || item.name || 'Deal';
          const dealId = matchedDeal?.id || item.dealId || `deal-${dealName}`;
          const key = `deal_${dealId}`;
          const dealPrice = Number(item.unitPrice || item.price || matchedDeal?.price || 0);
          const rev = dealPrice * itemQty;

          const existing = breakdownMap.get(key);
          if (existing) {
            existing.quantity += itemQty;
            existing.revenue += rev;
          } else {
            breakdownMap.set(key, {
              id: dealId,
              name: dealName,
              type: 'DEAL',
              category: 'Deals & Combos',
              quantity: itemQty,
              revenue: rev,
              unitPrice: dealPrice,
            });
          }
        } else {
          const itemName = item.menuItem?.name || item.name || 'Menu Item';
          const itemId = item.menuItemId || `item-${itemName}`;
          const key = `item_${itemId}`;
          const itemPrice = Number(item.unitPrice || item.price || item.menuItem?.price || 0);
          const rev = itemPrice * itemQty;
          const categoryName = item.menuItem?.category?.name || 'General';

          const existing = breakdownMap.get(key);
          if (existing) {
            existing.quantity += itemQty;
            existing.revenue += rev;
          } else {
            breakdownMap.set(key, {
              id: itemId,
              name: itemName,
              type: 'MENU_ITEM',
              category: categoryName,
              quantity: itemQty,
              revenue: rev,
              unitPrice: itemPrice,
            });
          }
        }
      });
    });

    const allRecords = Array.from(breakdownMap.values())
      .map((r) => ({
        ...r,
        revenue: +r.revenue.toFixed(2),
        unitPrice: +r.unitPrice.toFixed(2),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const totalCount = allRecords.length;
    const pagedRecords = allRecords.slice(skip, skip + limit);
    const hasMore = page * limit < totalCount;

    return {
      data: pagedRecords,
      page,
      limit,
      totalCount,
      hasMore,
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
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
      dealsByName.set(d.name.toLowerCase().trim(), d);
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

    const popularityMap = new Map<
      string,
      {
        menuItemId: string;
        name: string;
        category: string;
        standaloneQuantity: number;
        dealQuantity: number;
        totalQuantity: number;
        revenue: number;
      }
    >();

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const matchedDeal =
          item.deal ||
          (item.dealId ? dealsById.get(item.dealId) : null) ||
          (item.name ? dealsByName.get(item.name.toLowerCase().trim()) : null);

        const isDeal = Boolean(item.dealId || matchedDeal);

        if (isDeal && matchedDeal && matchedDeal.items && matchedDeal.items.length > 0) {
          // Expand each deal component item
          matchedDeal.items.forEach((dItem: any) => {
            const componentMenuItem = dItem.menuItem;
            if (!componentMenuItem) return;

            const mId = componentMenuItem.id;
            const mName = componentMenuItem.name;
            const mCategory = componentMenuItem.category?.name || 'General';
            const componentUnits = (Number(dItem.quantity) || 1) * itemQty;

            const existing = popularityMap.get(mId);
            if (existing) {
              existing.dealQuantity += componentUnits;
              existing.totalQuantity += componentUnits;
            } else {
              popularityMap.set(mId, {
                menuItemId: mId,
                name: mName,
                category: mCategory,
                standaloneQuantity: 0,
                dealQuantity: componentUnits,
                totalQuantity: componentUnits,
                revenue: 0,
              });
            }
          });
        } else if (!isDeal) {
          // Standalone menu item
          const mId = item.menuItemId || item.menuItem?.id || item.name;
          const mName = item.menuItem?.name || item.name || 'Menu Item';
          const mCategory = item.menuItem?.category?.name || 'General';
          const itemPrice = Number(item.unitPrice || item.price || item.menuItem?.price || 0);
          const rev = itemPrice * itemQty;

          const existing = popularityMap.get(mId);
          if (existing) {
            existing.standaloneQuantity += itemQty;
            existing.totalQuantity += itemQty;
            existing.revenue += rev;
          } else {
            popularityMap.set(mId, {
              menuItemId: mId,
              name: mName,
              category: mCategory,
              standaloneQuantity: itemQty,
              dealQuantity: 0,
              totalQuantity: itemQty,
              revenue: rev,
            });
          }
        }
      });
    });

    const allItems = Array.from(popularityMap.values())
      .map((item) => ({
        ...item,
        revenue: +item.revenue.toFixed(2),
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    const totalCount = allItems.length;
    const pagedItems = allItems.slice(skip, skip + limit);
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
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
