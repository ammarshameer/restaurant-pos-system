import { PrismaClient } from '@prisma/client';
import { getIO } from '../websocket';
import { InventoryService } from './inventory.service';
import { hasFeature } from './feature.service';
import { redactCosting } from './cost-redaction.service';
import { ValidationError } from '../lib/errors';
import { CustomerService } from './customer.service';

const prisma = new PrismaClient();
const inventoryService = new InventoryService();
const customerService = new CustomerService();

export class OrderService {
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

  async createOrder(data: {
    id?: string;
    clientId?: string;
    orderNumber?: number;
    orderType?: string;
    orderTypeLabel?: string;
    customerName?: string;
    customerPhone?: string;
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
    total?: number;
    totalPaid?: number;
    change?: number;
    status?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    paymentClientId?: string;
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
  }) {
    const restaurantId = data.restaurantId;
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to create an order');
    }

    // Verify restaurant exists
    const rest = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!rest) {
      throw new Error(`Restaurant '${restaurantId}' not found.`);
    }

    // Idempotency guard for offline-first sync: if this order was already
    // created (matched by client idempotency key or client-supplied id),
    // return the existing record instead of inserting a duplicate.
    if (data.clientId || data.id) {
      const existing = await prisma.order.findFirst({
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
        return existing;
      }
    }

    // Resolve the order number scoped strictly to this restaurant. If the
    // client supplied one that already exists (offline collision), reassign
    // to the next available number so the server stays authoritative.
    let orderNum: number;
    if (data.orderNumber && Number.isFinite(Number(data.orderNumber))) {
      const clash = await prisma.order.findFirst({
        where: { restaurantId, orderNumber: Number(data.orderNumber) },
        select: { id: true },
      });
      if (!clash) {
        orderNum = Number(data.orderNumber);
      } else {
        const maxOrder = await prisma.order.findFirst({
          where: { restaurantId },
          orderBy: { orderNumber: 'desc' },
          select: { orderNumber: true },
        });
        orderNum = (maxOrder ? maxOrder.orderNumber : 100) + 1;
      }
    } else {
      const maxOrder = await prisma.order.findFirst({
        where: { restaurantId },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      });
      orderNum = maxOrder ? maxOrder.orderNumber + 1 : 101;
    }

    // Resolve server ID strictly within this restaurant
    let serverId = data.serverId;
    if (serverId) {
      const empExists = await prisma.employee.findFirst({
        where: { id: serverId, restaurantId, isActive: true },
      });
      if (!empExists) {
        throw new ValidationError('Server not found in this business');
      }
    }

    if (!serverId) {
      const defaultEmployee = await prisma.employee.findFirst({
        where: { restaurantId, isActive: true },
      });
      serverId = defaultEmployee?.id || 'emp-manager-1';
    }

    if (data.tableId) {
      const table = await prisma.table.findFirst({
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
          const exists = await (prisma as any).deal.findFirst({
            where: { id: item.dealId, restaurantId },
          });
          if (!exists) throw new ValidationError('Deal not found in this business');
          validDealId = item.dealId;
          unitPrice = exists.price;
          resolvedName = exists.name;
        } else if (item.menuItemId) {
          const exists = await prisma.menuItem.findFirst({
            where: { id: item.menuItemId, restaurantId },
          });
          if (!exists) throw new ValidationError('Menu item not found in this business');
          validMenuItemId = item.menuItemId;
          unitPrice = exists.price;
          resolvedName = exists.name;
        } else if (item.name) {
          // Check if item is a Deal by name within restaurant
          const dealFound = await (prisma as any).deal.findFirst({
            where: { name: item.name, restaurantId },
          });
          if (dealFound) {
            validDealId = dealFound.id;
            unitPrice = dealFound.price;
            resolvedName = dealFound.name;
          } else {
            const exists = await prisma.menuItem.findFirst({
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
          return {
            menuItemId: validMenuItemId,
            dealId: validDealId,
            name: resolvedName || 'Custom Item',
            quantity,
            unitPrice,
            price: unitPrice,
            total,
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
    const calculatedTax = +(calculatedSubtotal * taxRate).toFixed(2);
    const calculatedTotal =
      +(calculatedSubtotal + calculatedTax + serviceCharge + deliveryCharge).toFixed(2);

    let initialStatus = data.status || 'OPEN';
    const initialPaymentStatus = 'UNPAID';
    let customerId: string | null = null;
    try {
      customerId = await customerService.recordOrderCustomer(restaurantId, {
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        total: calculatedTotal,
      });
    } catch (error) {
      console.error('Failed to resolve order customer:', error);
    }

    const order = await prisma.order.create({
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
        total: calculatedTotal,
        totalPaid: 0,
        change: data.change || 0,
        status: initialStatus,
        paymentStatus: initialPaymentStatus,
        notes: data.notes || null,
        items: {
          create: orderItemsData,
        },
      },
      include: this.orderInclude,
    });

    // Notify connected kitchen & client WebSockets
    const io = getIO();
    io?.to(`restaurant:${restaurantId}`).emit('order:created', order);
    io?.to(`restaurant:${restaurantId}:kitchen`).emit('kitchen:order:new', order);

    // Deduct stock for each ordered item or deal
    for (const item of data.items) {
      const orderReason = `Order #${order.orderNumber}: ${item.quantity}x ${item.name || 'Item'}`;
      try {
        if (item.dealId) {
          await inventoryService.deductForDeal(
            item.dealId,
            item.name || '',
            item.quantity,
            orderReason,
            restaurantId
          );
        } else {
          await inventoryService.deductForMenuItem(
            item.menuItemId || null,
            item.name || '',
            item.quantity,
            orderReason,
            restaurantId
          );
        }
      } catch (invErr) {
        console.error(`Failed to deduct inventory for item ${item.name}:`, invErr);
      }
    }

    return order;
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
      whereClause.paymentStatus = options.paymentStatus;
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
    ];
    for (const field of allowedScalarFields) {
      if (data[field] !== undefined) updateData[field] = data[field];
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

    const orderItemsData = items.map((item) => ({
      orderId,
      menuItemId: item.menuItemId || null,
      dealId: item.dealId || null,
      name: item.name || 'Custom Item',
      quantity: item.quantity || 1,
      unitPrice: item.unitPrice || item.price || 0,
      price: item.unitPrice || item.price || 0,
      total: (item.unitPrice || item.price || 0) * (item.quantity || 1),
      notes: item.notes || null,
      status: 'PENDING',
      inventoryDeducted: true,
    }));

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
    return this.updateOrderStatus(orderId, 'paid', restaurantId);
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

    const updated = await prisma.order.update({
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