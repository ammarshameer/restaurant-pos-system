import { Prisma, PrismaClient } from '@prisma/client';
import { getIO } from '../websocket';
import { InventoryService } from './inventory.service';
import { hasFeature } from './feature.service';
import { redactCosting } from './cost-redaction.service';
import { getRecipeUnitCost } from '../lib/costing';
import { ValidationError } from '../lib/errors';
import { CustomerService } from './customer.service';
import { CustomerCreditService } from './customer-credit.service';

const prisma = new PrismaClient();
const inventoryService = new InventoryService();
const customerService = new CustomerService();
const customerCreditService = new CustomerCreditService();

export class OrderService {
  private async resolveCostAtSale(
    restaurantId: string,
    menuItemId?: string | null,
    dealId?: string | null,
    client: PrismaClient | Prisma.TransactionClient = prisma
  ): Promise<number | null> {
    try {
      if (dealId) {
        const deal = await (client as any).deal.findFirst({
          where: { id: dealId, restaurantId },
          include: {
            items: {
              include: {
                menuItem: {
                  include: {
                    ingredients: {
                      include: { inventoryItem: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (deal && Array.isArray(deal.items)) {
          const dealCost = deal.items.reduce((sum: number, di: any) => {
            return sum + Number(di.quantity || 1) * getRecipeUnitCost(di.menuItem);
          }, 0);
          return +dealCost.toFixed(2);
        }
      } else if (menuItemId) {
        const item = await client.menuItem.findFirst({
          where: { id: menuItemId, restaurantId },
          include: {
            ingredients: {
              include: { inventoryItem: true },
            },
          },
        });
        if (item) {
          return +getRecipeUnitCost(item).toFixed(2);
        }
      }
    } catch (e) {
      console.warn('Failed to resolve costAtSale for order item:', e);
    }
    return null;
  }

  private async redactOrder<T>(restaurantId: string, payload: T): Promise<T> {
    return await hasFeature(restaurantId, 'costing') ? payload : redactCosting(payload);
  }
  // Shared include used when returning orders and for idempotency lookups.
  private orderInclude = {
    items: {
      include: {
        menuItem: true,
        deal: {
          include: {
            items: {
              include: {
                menuItem: true,
              },
            },
          },
        },
      },
    },
    server: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    },
    payments: true,
  };

  private isOrderNumberConflict(error: any): boolean {
    if (error?.code !== 'P2002') return false;
    const target = error?.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('restaurantId') && target.includes('orderNumber');
    }
    return typeof target === 'string' && target.includes('restaurantId') && target.includes('orderNumber');
  }

  /**
   * Serialise number allocation for one restaurant. The row lock is held until
   * the surrounding transaction commits, so no two orders can read the same
   * maximum order number and collide on the unique index.
   */
  private async allocateOrderNumber(
    db: PrismaClient | Prisma.TransactionClient,
    restaurantId: string,
    requested?: number
  ): Promise<number> {
    if (typeof (db as any).$queryRaw === 'function') {
      await (db as any).$queryRaw`SELECT "id" FROM "Restaurant" WHERE "id" = ${restaurantId} FOR UPDATE`;
    }

    if (requested && Number.isFinite(Number(requested))) {
      const requestedNumber = Number(requested);
      const clash = await db.order.findFirst({
        where: { restaurantId, orderNumber: requestedNumber },
        select: { id: true },
      });
      if (!clash) {
        return requestedNumber;
      }
    }

    const maxOrder = await db.order.findFirst({
      where: { restaurantId },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });
    return (maxOrder ? maxOrder.orderNumber : 100) + 1;
  }

  private emitOrderEvents(order: any, tableId?: string): void {
    const io = getIO();
    io?.to(`restaurant:${order.restaurantId}`).emit('order:created', order);
    io?.to(`restaurant:${order.restaurantId}:kitchen`).emit('kitchen:order:new', order);
    if (tableId) {
      io?.to(`restaurant:${order.restaurantId}`).emit('table:status', {
        tableId,
        status: 'OCCUPIED',
        currentOrder: order.id,
      });
    }
  }

  private emitLowStockAlerts(items: any[]): void {
    for (const item of items) {
      inventoryService.emitLowStockAlert(item);
    }
  }

  /**
   * Stock failures must survive the rollback that follows them, so this audit
   * row is written with the base client after the failed transaction unwinds.
   */
  private async recordStockFailureAudit(error: any): Promise<void> {
    if (error?.code !== 'STOCK_DEDUCTION_FAILED') return;
    try {
      await prisma.auditLog.create({
        data: {
          restaurantId: error.restaurantId,
          orderNumber: error.orderNumber,
          action: 'STOCK_DEDUCTION_FAILED',
          severity: 'ERROR',
          details: error.details || error.message || 'Stock deduction failed',
        },
      });
    } catch (auditError) {
      console.error('Failed to write stock-deduction audit log:', auditError);
    }
  }

  private async createOrderInTransaction(
    data: Parameters<OrderService['createOrder']>[0],
    db: PrismaClient | Prisma.TransactionClient
  ): Promise<{ order: any; lowStockAlerts: any[] }> {
    const restaurantId = data.restaurantId;
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to create an order');
    }

    // Verify restaurant exists
    const rest = await db.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!rest) {
      throw new Error(`Restaurant '${restaurantId}' not found.`);
    }

    // Idempotency guard: if this order was already created (matched by client
    // idempotency key or client-supplied id), return the existing record
    // instead of inserting a duplicate on retry.
    if (data.clientId || data.id) {
      const existing = await db.order.findFirst({
        where: {
          restaurantId,
          OR: [
            ...(data.clientId ? [{ clientId: data.clientId }] : []),
            ...(data.id ? [{ id: data.id }] : []),
          ],
        },
        include: this.orderInclude,
      });
      if (existing) {
        return { order: existing, lowStockAlerts: [] };
      }
    }

    const orderNum = await this.allocateOrderNumber(db, restaurantId, data.orderNumber);

    // Resolve server ID strictly within this restaurant. There is deliberately
    // no hard-coded fallback employee: a business without active staff must get
    // a clear validation error instead of a foreign-key failure.
    let serverId = data.serverId;
    if (serverId) {
      const empExists = await db.employee.findFirst({
        where: { id: serverId, restaurantId, isActive: true },
      });
      if (!empExists) {
        throw new ValidationError('Server not found in this business');
      }
    }

    if (!serverId) {
      const defaultEmployee = await db.employee.findFirst({
        where: { restaurantId, isActive: true },
      });
      if (!defaultEmployee) {
        throw new ValidationError(
          'Cannot create an order because this business has no active employee. Add an active staff member first.'
        );
      }
      serverId = defaultEmployee.id;
    }

    if (data.tableId) {
      const table = await db.table.findFirst({
        where: { id: data.tableId, floorPlan: { restaurantId } },
      });
      if (!table) throw new ValidationError('Table not found in this business');
    }

    // Process order items scoped strictly to this restaurant
    let subtotal = 0;
    const orderItemsData = await Promise.all(
      data.items.map(async (item) => {
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error('Item quantity must be a positive number');
        }
        let unitPrice: number | undefined;
        let resolvedName: string | undefined;

        let validMenuItemId: string | null = null;
        let validDealId: string | null = null;

        if (item.dealId) {
          const exists = await (db as any).deal.findFirst({
            where: { id: item.dealId, restaurantId },
          });
          if (!exists) throw new ValidationError('Deal not found in this business');
          validDealId = item.dealId;
          unitPrice = exists.price;
          resolvedName = exists.name;
        } else if (item.menuItemId) {
          const exists = await db.menuItem.findFirst({
            where: { id: item.menuItemId, restaurantId },
          });
          if (!exists) throw new ValidationError('Menu item not found in this business');
          validMenuItemId = item.menuItemId;
          unitPrice = exists.price;
          resolvedName = exists.name;
        } else if (item.name) {
          // Check if item is a Deal by name within restaurant
          const dealFound = await (db as any).deal.findFirst({
            where: { name: item.name, restaurantId },
          });
          if (dealFound) {
            validDealId = dealFound.id;
            unitPrice = dealFound.price;
            resolvedName = dealFound.name;
          } else {
            const exists = await db.menuItem.findFirst({
              where: { name: item.name, restaurantId },
            });
            if (exists) validMenuItemId = exists.id;
            if (exists) unitPrice = exists.price;
            if (exists) resolvedName = exists.name;
          }
        }
        if ((validMenuItemId || validDealId) && unitPrice !== undefined) {
          const total = unitPrice * quantity;
          subtotal += total;
          const costAtSale = await this.resolveCostAtSale(restaurantId, validMenuItemId, validDealId, db);
          return {
            menuItemId: validMenuItemId,
            dealId: validDealId,
            name: resolvedName || 'Custom Item',
            quantity,
            unitPrice,
            price: unitPrice,
            total,
            costAtSale,
            specialInstructions: item.notes || null,
            notes: item.notes || null,
            status: item.status || 'PENDING',
            inventoryDeducted: true,
          };
        }
        throw new Error('Custom order items require a valid catalog item or orders.discount permission');
      })
    );

    const nonNegative = (value: unknown, fallback = 0) => {
      if (value === undefined) return fallback;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error('Monetary values must be non-negative numbers');
      return number;
    };
    const calculatedSubtotal = subtotal;
    const taxRate = nonNegative(data.taxRate);
    const serviceCharge = nonNegative(data.serviceCharge);
    const serviceChargeRate = nonNegative(data.serviceChargeRate);
    const deliveryCharge = nonNegative(data.deliveryCharge);

    const requestedDiscountPercent = Number(data.discountPercent ?? 0);
    if (
      !Number.isFinite(requestedDiscountPercent) ||
      requestedDiscountPercent < 0 ||
      requestedDiscountPercent > 100
    ) {
      throw new Error('Discount percent must be a number between 0 and 100');
    }
    const discountPercent = +requestedDiscountPercent.toFixed(2);
    const discountAmount = +(calculatedSubtotal * discountPercent / 100).toFixed(2);

    const calculatedTax = +(calculatedSubtotal * taxRate).toFixed(2);
    const calculatedTotal = Math.max(
      0,
      +(calculatedSubtotal + calculatedTax + serviceCharge + deliveryCharge - discountAmount).toFixed(2)
    );

    let customerId: string | null = data.customerId || null;
    if (customerId) {
      const existing = await db.customer.findFirst({
        where: { id: customerId, restaurantId },
      });
      if (existing) {
        await db.customer.update({
          where: { id: customerId },
          data: {
            totalOrders: { increment: 1 },
            totalSpent: { increment: Number(calculatedTotal || 0) },
            lastOrderAt: new Date(),
          },
        });
      } else {
        customerId = null;
      }
    }
    if (!customerId && (data.customerName || data.customerPhone)) {
      customerId = await customerService.recordOrderCustomer(
        restaurantId,
        {
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          total: calculatedTotal,
        },
        db
      );
    }

    const order = await db.order.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        ...(data.clientId ? { clientId: data.clientId } : {}),
        ...(data.createdAt ? { createdAt: new Date(data.createdAt) } : {}),
        orderNumber: orderNum,
        orderType: (data.orderType || 'DINE_IN').toUpperCase(),
        orderTypeLabel: data.orderTypeLabel || data.orderType || 'Dine In',
        customerName: data.customerName || null,
        customerPhone: data.customerPhone || null,
        customerId,
        deliveryAddress: data.deliveryAddress || null,
        dineInTag: data.dineInTag || null,
        tableId: data.tableId || null,
        restaurantId,
        serverId,
        customerCount: data.customerCount || 1,
        subtotal: calculatedSubtotal,
        serviceCharge,
        serviceChargeRate,
        deliveryCharge,
        tax: calculatedTax,
        taxRate,
        discountPercent,
        discountAmount,
        total: calculatedTotal,
        totalPaid: 0,
        amountDue: calculatedTotal,
        settledToCredit: false,
        change: data.change || 0,
        status: data.status || 'OPEN',
        paymentStatus: 'UNPAID',
        source: (data.source as any) || 'POS',
        notes: data.notes || null,
        items: {
          create: orderItemsData,
        },
      },
      include: this.orderInclude,
    });

    if (data.tableId) {
      await db.table.update({
        where: { id: data.tableId },
        data: { status: 'OCCUPIED', currentOrder: order.id },
      }).catch((err) => console.warn('Could not mark table occupied:', err));
    }

    // Deduct stock with the caller's transaction client. Alerts are collected
    // and emitted only after the transaction commits.
    const lowStockAlerts: any[] = [];
    const stockFailures: Array<{ item: any; error: unknown }> = [];
    for (const item of data.items) {
      const orderReason = `Order #${order.orderNumber}: ${item.quantity}x ${item.name || 'Item'}`;
      try {
        if (item.dealId) {
          await inventoryService.deductForDeal(
            item.dealId,
            item.name || '',
            item.quantity,
            orderReason,
            restaurantId,
            db,
            false,
            (lowStockItem) => lowStockAlerts.push(lowStockItem)
          );
        } else {
          await inventoryService.deductForMenuItem(
            item.menuItemId || null,
            item.name || '',
            item.quantity,
            orderReason,
            restaurantId,
            db,
            false,
            (lowStockItem) => lowStockAlerts.push(lowStockItem)
          );
        }
      } catch (invErr) {
        stockFailures.push({ item, error: invErr });
      }
    }

    if (stockFailures.length > 0) {
      const details = stockFailures
        .map(({ item, error }) => `${item.name || item.menuItemId || item.dealId || 'Item'}: ${String(error)}`)
        .join('; ');
      throw Object.assign(new Error(`Stock deduction failed for order #${order.orderNumber}`), {
        code: 'STOCK_DEDUCTION_FAILED',
        orderNumber: order.orderNumber,
        restaurantId,
        details,
      });
    }

    return { order, lowStockAlerts };
  }

  async createOrder(
    data: {
      id?: string;
      clientId?: string;
      orderNumber?: number;
      orderType?: string;
      orderTypeLabel?: string;
      customerName?: string;
      customerPhone?: string;
      customerId?: string;
      deliveryAddress?: string;
      dineInTag?: string;
      tableId?: string;
      restaurantId: string;
      serverId?: string;
      customerCount?: number;
      subtotal?: number;
      serviceCharge?: number;
      serviceChargeRate?: number;
      deliveryCharge?: number;
      tax?: number;
      taxRate?: number;
      discountPercent?: number;
      discountAmount?: number;
      total?: number;
      totalPaid?: number;
      change?: number;
      status?: string;
      paymentStatus?: string;
      paymentMethod?: string;
      paymentClientId?: string;
      source?: string;
      createdAt?: string | Date;
      items: Array<{
        menuItemId?: string;
        dealId?: string;
        name?: string;
        quantity: number;
        price?: number;
        unitPrice?: number;
        notes?: string;
        status?: string;
      }>;
      notes?: string;
    },
    client: PrismaClient | Prisma.TransactionClient = prisma,
    notify = true,
    onCommitted?: (result: { order: any; lowStockAlerts: any[] }) => void
  ) {
    const usesCallerTransaction = client !== prisma;

    try {
      if (!usesCallerTransaction) {
        // Own the transaction so row locks cover number allocation, stock and
        // customer writes, and so notifications can wait until after commit.
        for (let attempt = 1; attempt <= 5; attempt++) {
          let order: any;
          let lowStockAlerts: any[] = [];
          try {
            order = await prisma.$transaction(async (tx) => {
              const result = await this.createOrderInTransaction(data, tx);
              lowStockAlerts = result.lowStockAlerts;
              return result.order;
            });
            if (notify) {
              this.emitOrderEvents(order, data.tableId);
            }
            this.emitLowStockAlerts(lowStockAlerts);
            onCommitted?.({ order, lowStockAlerts });
            return order;
          } catch (error) {
            if (this.isOrderNumberConflict(error) && attempt < 5) {
              console.warn(`Order number collision, retrying (${attempt}/5):`, (error as any)?.meta?.target);
              continue;
            }
            throw error;
          }
        }
      }

      // A caller-supplied transaction (web order acceptance) stays the unit of
      // work. Number allocation is serialised by the restaurant row lock, so a
      // P2002 retry inside this transaction is not needed.
      const result = await this.createOrderInTransaction(data, client);
      if (notify) {
        this.emitOrderEvents(result.order, data.tableId);
      }
      // Alerts must not be emitted here: this code is still inside the caller's
      // transaction and a later failure would roll it back. Hand the alerts to
      // the caller so it can emit them after its own commit.
      onCommitted?.({ order: result.order, lowStockAlerts: result.lowStockAlerts });
      return result.order;
    } catch (error) {
      await this.recordStockFailureAudit(error);
      throw error;
    }
  }

  async getOrderById(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve an order');
    }

    return prisma.order.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: {
        items: {
          include: {
            menuItem: true,
            deal: {
              include: {
                items: {
                  include: {
                    menuItem: true,
                  },
                },
              },
            },
          },
        },
        server: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        payments: true,
      },
    });
  }

  async getAllOrdersByRestaurant(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      orderType?: string;
      paymentStatus?: string;
      status?: string;
    }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve orders');
    }

    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = { restaurantId };

    if (options?.orderType && options.orderType !== 'ALL') {
      whereClause.orderType = options.orderType;
    }

    if (options?.paymentStatus && options.paymentStatus !== 'ALL') {
      const ps = options.paymentStatus.toUpperCase();
      if (ps === 'UDHAAR' || ps === 'CREDIT') {
        whereClause.settledToCredit = true;
      } else if (ps === 'PARTIAL') {
        whereClause.paymentStatus = 'PARTIAL';
      } else if (ps === 'PAID') {
        whereClause.paymentStatus = 'PAID';
      } else if (ps === 'UNPAID') {
        whereClause.paymentStatus = { in: ['UNPAID', 'PARTIAL'] };
        // Orders settled to customer credit are collected from the Dues page,
        // not from the cash register, so they must not appear here.
        whereClause.settledToCredit = false;
      } else if (options.paymentStatus.includes(',')) {
        whereClause.paymentStatus = { in: options.paymentStatus.split(',').map((s) => s.trim()) };
      } else {
        whereClause.paymentStatus = options.paymentStatus;
      }
    }

    if (options?.status && options.status !== 'ALL') {
      whereClause.status = options.status;
    }

    if (options?.search && options.search.trim()) {
      const q = options.search.trim();
      const orderNum = parseInt(q, 10);
      whereClause.OR = [
        ...(!isNaN(orderNum) ? [{ orderNumber: orderNum }] : []),
        { customerName: { contains: q } },
        { customerPhone: { contains: q } },
        { deliveryAddress: { contains: q } },
        { dineInTag: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    const [totalCount, orders] = await Promise.all([
      prisma.order.count({ where: whereClause }),
      prisma.order.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          items: {
            include: {
              menuItem: true,
              deal: {
                include: {
                  items: {
                    include: {
                      menuItem: true,
                    },
                  },
                },
              },
            },
          },
          server: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
      data: orders,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async getActiveOrders(restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve active orders');
    }

    return prisma.order.findMany({
      where: {
        restaurantId,
        status: { in: ['confirmed', 'preparing', 'ready', 'OPEN', 'IN_PROGRESS', 'READY'] },
      },
      include: {
        items: {
          include: {
            menuItem: true,
            deal: {
              include: {
                items: {
                  include: {
                    menuItem: true,
                  },
                },
              },
            },
          },
        },
        server: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateOrder(id: string, data: any, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to update an order');
    }

    const existingOrder = await prisma.order.findFirst({
      where: {
        id,
        restaurantId,
      },
    });

    if (!existingOrder) {
      throw new Error('Order not found or unauthorized');
    }

    const updateData: any = {};
    const allowedScalarFields = [
      'customerName', 'customerPhone', 'deliveryAddress', 'dineInTag', 'customerCount',
      'notes', 'serviceCharge', 'serviceChargeRate', 'deliveryCharge', 'tax', 'taxRate', 'status',
      'discountPercent', 'discountAmount',
      'subtotal', 'total', 'totalPaid', 'change', 'paymentStatus', 'paymentMethod',
    ];
    for (const field of allowedScalarFields) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }
    if (data.customerId !== undefined) {
      if (data.customerId === null || data.customerId === '') {
        updateData.customerId = null;
      } else {
        const customer = await prisma.customer.findFirst({
          where: { id: data.customerId, restaurantId },
        });
        if (!customer) throw new ValidationError('Customer not found in this business');
        updateData.customerId = customer.id;
      }
    }
    if (data.total !== undefined || data.totalPaid !== undefined) {
      const total = Number(data.total ?? existingOrder.total ?? 0);
      const totalPaid = Number(data.totalPaid ?? existingOrder.totalPaid ?? 0);
      updateData.amountDue = Math.max(0, +(total - totalPaid).toFixed(2));
    }
    if (data.tableId !== undefined) {
      const table = await prisma.table.findFirst({ where: { id: data.tableId, floorPlan: { restaurantId } } });
      if (!table) throw new ValidationError('Table not found in this business');
      updateData.tableId = table.id;
    }
    if (data.serverId !== undefined) {
      const server = await prisma.employee.findFirst({ where: { id: data.serverId, restaurantId, isActive: true } });
      if (!server) throw new ValidationError('Server not found in this business');
      updateData.serverId = server.id;
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      if (Array.isArray(data.items)) {
        const items = [];
        for (const item of data.items) {
          let unitPrice = 0;
          let name = item.name || 'Custom Item';
          if (item.menuItemId) {
            const menuItem = await tx.menuItem.findFirst({ where: { id: item.menuItemId, restaurantId } });
            if (!menuItem) throw new ValidationError('Menu item not found in this business');
            unitPrice = menuItem.price;
            name = menuItem.name;
          } else if (item.dealId) {
            const deal = await tx.deal.findFirst({ where: { id: item.dealId, restaurantId } });
            if (!deal) throw new ValidationError('Deal not found in this business');
            unitPrice = deal.price;
            name = deal.name;
          }
          const quantity = Number(item.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid item quantity');
          items.push({
            orderId: id,
            menuItemId: item.menuItemId || null,
            dealId: item.dealId || null,
            name,
            quantity,
            unitPrice,
            price: unitPrice,
            total: unitPrice * quantity,
            specialInstructions: item.notes || null,
            notes: item.notes || null,
            status: item.status || 'PENDING',
          });
        }
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({ data: items });
      }
      return tx.order.update({
        where: { id, restaurantId },
        data: updateData,
        include: {
        items: {
          include: {
            menuItem: true,
            deal: {
              include: {
                items: {
                  include: {
                    menuItem: true,
                  },
                },
              },
            },
          },
        },
        server: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        },
      });
    });

    const io = getIO();
    io?.to(`restaurant:${updatedOrder.restaurantId}`).emit('order:updated', updatedOrder);
    io?.to(`restaurant:${updatedOrder.restaurantId}:kitchen`).emit('kitchen:order:updated', updatedOrder);

    return updatedOrder;
  }

  async deleteOrder(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to delete an order');
    }

    const order = await prisma.order.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: { items: true },
    });

    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    if (order.status !== 'cancelled') {
      for (const item of order.items) {
        if (item.inventoryDeducted) {
          try {
            const restoreReason = `Order #${order.orderNumber} Deleted: Restored ${item.quantity}x ${item.name || 'Item'}`;
            if (item.dealId) {
              await inventoryService.restoreForDeal(
                item.dealId,
                item.name || '',
                item.quantity,
                restoreReason,
                order.restaurantId
              );
            } else {
              await inventoryService.restoreForMenuItem(
                item.menuItemId || null,
                item.name || '',
                item.quantity,
                restoreReason,
                order.restaurantId
              );
            }
          } catch (invErr) {
            console.error(`Failed to restore inventory on delete for item ${item.name}:`, invErr);
          }
        }
      }
    }

    await prisma.orderItem.deleteMany({
      where: { orderId: id },
    });
    await prisma.payment.deleteMany({
      where: { orderId: id },
    });
    return prisma.order.delete({
      where: { id },
    });
  }

  async updateOrderItemStatus(itemId: string, status: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to update order item status');
    }

    const item = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: {
        order: true,
        menuItem: true,
      },
    });

    if (!item || item.order.restaurantId !== restaurantId) {
      throw new Error('Order item not found or unauthorized');
    }

    const updatedItem = await prisma.orderItem.update({
      where: { id: itemId },
      data: {
        status,
        completedAt: status === 'READY' || status === 'SERVED' ? new Date() : item.completedAt,
      },
    });

    const io = getIO();
    io?.to(`restaurant:${item.order.restaurantId}`).emit('order:item:status:changed', {
      itemId,
      status,
      orderId: item.orderId,
    });

    return updatedItem;
  }

  async updateOrderStatus(orderId: string, status: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to update order status');
    }

    if (status.toLowerCase() === 'cancelled') {
      return this.cancelOrder(orderId, undefined, restaurantId);
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
      },
    });

    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        completedAt: status === 'COMPLETED' || status === 'paid' ? new Date() : order.completedAt,
      },
      include: {
        items: {
          include: {
            menuItem: true,
            deal: {
              include: {
                items: {
                  include: {
                    menuItem: true,
                  },
                },
              },
            },
          },
        },
        server: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const io = getIO();
    io?.to(`restaurant:${order.restaurantId}`).emit('order:updated', updatedOrder);

    return updatedOrder;
  }

  async addItemsToOrder(orderId: string, items: any[], restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to add items to an order');
    }

    const targetOrder = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
      },
    });

    if (!targetOrder) {
      throw new Error('Order not found or unauthorized');
    }

    const orderItemsData = await Promise.all(
      items.map(async (item) => {
        const costAtSale = await this.resolveCostAtSale(restaurantId, item.menuItemId || null, item.dealId || null);
        return {
          orderId,
          menuItemId: item.menuItemId || null,
          dealId: item.dealId || null,
          name: item.name || 'Custom Item',
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || item.price || 0,
          price: item.unitPrice || item.price || 0,
          total: (item.unitPrice || item.price || 0) * (item.quantity || 1),
          costAtSale,
          notes: item.notes || null,
          status: 'PENDING',
          inventoryDeducted: true,
        };
      })
    );

    await prisma.orderItem.createMany({
      data: orderItemsData,
    });

    for (const item of items) {
      const orderReason = `Order #${targetOrder.orderNumber} (Add-on): ${item.quantity || 1}x ${item.name || 'Item'}`;
      try {
        if (item.dealId) {
          await inventoryService.deductForDeal(
            item.dealId,
            item.name || '',
            item.quantity || 1,
            orderReason,
            targetOrder.restaurantId
          );
        } else {
          await inventoryService.deductForMenuItem(
            item.menuItemId || null,
            item.name || '',
            item.quantity || 1,
            orderReason,
            targetOrder.restaurantId
          );
        }
      } catch (invErr) {
        console.error(`Failed to deduct inventory for add-on ${item.name}:`, invErr);
      }
    }

    return this.getOrderById(orderId, targetOrder.restaurantId);
  }

  async completeOrder(orderId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to complete an order');
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, restaurantId },
    });
    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    // Mark items as SERVED so they leave the kitchen display
    await prisma.orderItem.updateMany({
      where: { orderId },
      data: { status: 'SERVED' },
    });

    // Free table if assigned
    if (order.tableId) {
      await prisma.table.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE', currentOrder: null },
      }).catch(() => {});
    }
    await prisma.table.updateMany({
      where: { currentOrder: orderId },
      data: { status: 'AVAILABLE', currentOrder: null },
    }).catch(() => {});

    const updated = await this.updateOrderStatus(orderId, 'paid', restaurantId);

    const io = getIO();
    if (order.tableId) {
      io?.to(`restaurant:${restaurantId}`).emit('table:status', {
        tableId: order.tableId,
        status: 'AVAILABLE',
        currentOrder: null,
      });
    }
    io?.to(`restaurant:${restaurantId}:kitchen`).emit('kitchen:order:updated', updated);

    return updated;
  }

  async cancelOrder(orderId: string, reason: string | undefined, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to cancel an order');
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
      },
      include: {
        items: {
          include: {
            menuItem: true,
            deal: {
              include: {
                items: {
                  include: {
                    menuItem: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    // Free table if assigned
    if (order.tableId) {
      await prisma.table.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE', currentOrder: null },
      }).catch(() => {});
    }
    await prisma.table.updateMany({
      where: { currentOrder: orderId },
      data: { status: 'AVAILABLE', currentOrder: null },
    }).catch(() => {});

    // Prevent restocking an order twice if cancelled more than once
    if (order.status === 'cancelled') {
      console.log(`[OrderService] Order #${order.orderNumber} is already cancelled; skipping inventory restock.`);
      return order;
    }

    // Restore inventory for items where stock was deducted
    for (const item of order.items) {
      if (item.inventoryDeducted) {
        const cancelReason = `Order #${order.orderNumber} Cancelled${reason ? ` (${reason})` : ''}: Restored ${item.quantity}x ${item.name || 'Item'}`;
        try {
          if (item.dealId) {
            await inventoryService.restoreForDeal(
              item.dealId,
              item.name || '',
              item.quantity,
              cancelReason,
              order.restaurantId
            );
          } else {
            await inventoryService.restoreForMenuItem(
              item.menuItemId || null,
              item.name || '',
              item.quantity,
              cancelReason,
              order.restaurantId
            );
          }
          // Mark item inventory as no longer deducted to prevent double-restock
          await prisma.orderItem.update({
            where: { id: item.id },
            data: { inventoryDeducted: false },
          });
        } catch (invErr) {
          console.error(`Failed to restore inventory for item ${item.name}:`, invErr);
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Reverse any credit that was settled to the customer's dues ledger so a
      // cancelled order does not leave a phantom balance behind.
      if (order.settledToCredit || order.customerId) {
        const [chargeEntry, alreadyReversed] = await Promise.all([
          tx.customerLedgerEntry.findFirst({
            where: { restaurantId: order.restaurantId, orderId, type: 'CHARGE' },
          }),
          tx.customerLedgerEntry.findFirst({
            where: { restaurantId: order.restaurantId, orderId, type: 'REFUND' },
          }),
        ]);
        if (chargeEntry && !alreadyReversed) {
          await customerCreditService.reverseCharge(
            order.restaurantId,
            orderId,
            undefined,
            `Order #${order.orderNumber} cancelled`,
            undefined,
            tx
          );
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: 'cancelled',
          notes: reason ? (order.notes ? `${order.notes} | Cancelled: ${reason}` : `Cancelled: ${reason}`) : order.notes,
        },
        include: {
          items: {
            include: {
              menuItem: true,
              deal: {
                include: {
                  items: {
                    include: {
                      menuItem: true,
                    },
                  },
                },
              },
            },
          },
          server: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    });

    // Notify kitchen and waitstaff via WebSocket
    const io = getIO();
    io?.to(`restaurant:${updated.restaurantId}`).emit('order:updated', updated);
    io?.to(`restaurant:${updated.restaurantId}:kitchen`).emit('kitchen:order:updated', updated);

    return updated;
  }

  async getOrderTotal(orderId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to get order total');
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
      },
      include: { items: true },
    });
    if (!order) throw new Error('Order not found or unauthorized');
    return {
      subtotal: order.subtotal,
      serviceCharge: order.serviceCharge,
      serviceChargeRate: order.serviceChargeRate,
      deliveryCharge: order.deliveryCharge,
      tax: order.tax,
      taxRate: order.taxRate,
      total: order.total,
    };
  }
}

export const orderService = new OrderService();