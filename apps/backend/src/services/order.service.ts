import { PrismaClient } from '@prisma/client';
import { io } from '../index';
import { InventoryService } from './inventory.service';

const prisma = new PrismaClient();
const inventoryService = new InventoryService();

export class OrderService {
  async createOrder(data: {
    id?: string;
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
    items: Array<{
      menuItemId: string;
      name?: string;
      quantity: number;
      price?: number;
      unitPrice?: number;
      notes?: string;
    }>;
    notes?: string;
  }) {
    // Generate order number if missing
    let orderNum = data.orderNumber;
    if (!orderNum) {
      const maxOrder = await prisma.order.findFirst({
        orderBy: { orderNumber: 'desc' },
      });
      orderNum = maxOrder ? maxOrder.orderNumber + 1 : 101;
    }

    // Resolve restaurant ID
    let restaurantId = data.restaurantId;
    const rest = await prisma.restaurant.findFirst();
    if (!restaurantId || restaurantId === 'rest-default-1') {
      restaurantId = rest?.id || 'rest-default-1';
    }

    // Resolve server ID
    let serverId = data.serverId;
    const defaultEmployee = await prisma.employee.findFirst({
      where: { restaurantId },
    });
    if (!serverId || !defaultEmployee) {
      const anyEmployee = await prisma.employee.findFirst();
      serverId = anyEmployee?.id || 'emp-manager-1';
    } else {
      serverId = defaultEmployee.id;
    }

    // Process order items
    let subtotal = 0;
    const orderItemsData = await Promise.all(
      data.items.map(async (item) => {
        const unitPrice = item.unitPrice || item.price || 0;
        const total = unitPrice * item.quantity;
        subtotal += total;

        let validMenuItemId: string | null = null;
        if (item.menuItemId) {
          const exists = await prisma.menuItem.findUnique({ where: { id: item.menuItemId } });
          if (exists) validMenuItemId = item.menuItemId;
        }

        return {
          menuItemId: validMenuItemId,
          name: item.name || 'Custom Item',
          quantity: item.quantity,
          unitPrice,
          price: unitPrice,
          total,
          specialInstructions: item.notes || null,
          notes: item.notes || null,
          status: 'PENDING',
          inventoryDeducted: false,
        };
      })
    );

    const finalSubtotal = data.subtotal !== undefined ? data.subtotal : subtotal;
    const isDelivery = (data.orderType || '').toUpperCase() === 'DELIVERY';
    const isDineIn = (data.orderType || '').toUpperCase() === 'DINE_IN';

    let serviceChargeRate = 0;
    let serviceCharge = 0;
    let deliveryCharge = 0;
    let taxRate = 0;
    let tax = 0;

    if (isDineIn) {
      taxRate = data.taxRate !== undefined ? data.taxRate : 0;
      tax = data.tax !== undefined ? data.tax : +(finalSubtotal * (taxRate / 100)).toFixed(2);
      serviceCharge = data.serviceCharge !== undefined ? data.serviceCharge : 0;
      serviceChargeRate = data.serviceChargeRate || 0;
    } else if (isDelivery) {
      deliveryCharge = data.deliveryCharge !== undefined ? data.deliveryCharge : 0;
    }

    const total = data.total !== undefined ? data.total : +(finalSubtotal + tax + serviceCharge + deliveryCharge).toFixed(2);

    const order = await prisma.order.create({
      data: {
        id: data.id,
        orderNumber: orderNum,
        orderType: data.orderType || 'DINE_IN',
        orderTypeLabel: data.orderTypeLabel || (data.orderType === 'TAKE_AWAY' ? 'Take Away' : data.orderType === 'DELIVERY' ? 'Delivery' : 'Dine In'),
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        deliveryAddress: data.deliveryAddress,
        dineInTag: data.dineInTag,
        tableId: data.tableId || null,
        restaurantId,
        serverId,
        customerCount: data.customerCount || 1,
        status: data.status || (data.paymentStatus === 'PAID' ? 'paid' : 'confirmed'),
        paymentStatus: data.paymentStatus || 'UNPAID',
        paymentMethod: data.paymentMethod || 'CASH',
        subtotal: finalSubtotal,
        serviceCharge,
        serviceChargeRate,
        deliveryCharge,
        tax,
        taxRate,
        total,
        totalPaid: data.totalPaid || (data.paymentStatus === 'PAID' ? total : 0),
        change: data.change || 0,
        notes: data.notes,
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: {
          include: {
            menuItem: true,
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
    io?.to(`restaurant:${restaurantId}`).emit('order:new', order);
    io?.to(`restaurant:${restaurantId}:kitchen`).emit('kitchen:order:new', order);

    return order;
  }

  async getOrderById(id: string) {
    return prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            menuItem: true,
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

  async getAllOrdersByRestaurant(restaurantId: string) {
    return prisma.order.findMany({
      where: { restaurantId },
      include: {
        items: {
          include: {
            menuItem: true,
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

  async getActiveOrders(restaurantId: string) {
    return prisma.order.findMany({
      where: {
        restaurantId,
        status: { in: ['confirmed', 'preparing', 'ready', 'OPEN', 'IN_PROGRESS', 'READY'] },
      },
      include: {
        items: {
          include: {
            menuItem: true,
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

  async updateOrder(id: string, data: any) {
    // If items are provided, replace existing items
    if (data.items && Array.isArray(data.items)) {
      await prisma.orderItem.deleteMany({
        where: { orderId: id },
      });

      const orderItemsData = data.items.map((item: any) => ({
        orderId: id,
        menuItemId: item.menuItemId || null,
        name: item.name || 'Custom Item',
        quantity: item.quantity,
        unitPrice: item.unitPrice || item.price || 0,
        price: item.unitPrice || item.price || 0,
        total: (item.unitPrice || item.price || 0) * item.quantity,
        specialInstructions: item.notes || null,
        notes: item.notes || null,
        status: item.status || 'PENDING',
      }));

      await prisma.orderItem.createMany({
        data: orderItemsData,
      });
    }

    const { items, server, payments, ...updateFields } = data;

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateFields,
      include: {
        items: {
          include: {
            menuItem: true,
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

    io?.to(`restaurant:${updatedOrder.restaurantId}`).emit('order:updated', updatedOrder);
    io?.to(`restaurant:${updatedOrder.restaurantId}:kitchen`).emit('kitchen:order:updated', updatedOrder);

    return updatedOrder;
  }

  async deleteOrder(id: string) {
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

  async updateOrderItemStatus(itemId: string, status: string) {
    const item = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: {
        order: true,
        menuItem: true,
      },
    });

    if (!item) {
      throw new Error('Order item not found');
    }

    const updatedItem = await prisma.orderItem.update({
      where: { id: itemId },
      data: {
        status,
        completedAt: status === 'READY' || status === 'SERVED' ? new Date() : item.completedAt,
      },
    });

    io?.to(`restaurant:${item.order.restaurantId}`).emit('order:item:status:changed', {
      itemId,
      status,
      orderId: item.orderId,
    });

    return updatedItem;
  }

  async updateOrderStatus(orderId: string, status: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error('Order not found');
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

    io?.to(`restaurant:${order.restaurantId}`).emit('order:updated', updatedOrder);

    return updatedOrder;
  }

  async addItemsToOrder(orderId: string, items: any[]) {
    const orderItemsData = items.map((item) => ({
      orderId,
      menuItemId: item.menuItemId || null,
      name: item.name || 'Custom Item',
      quantity: item.quantity || 1,
      unitPrice: item.unitPrice || item.price || 0,
      price: item.unitPrice || item.price || 0,
      total: (item.unitPrice || item.price || 0) * (item.quantity || 1),
      notes: item.notes || null,
      status: 'PENDING',
    }));

    await prisma.orderItem.createMany({
      data: orderItemsData,
    });

    return this.getOrderById(orderId);
  }

  async completeOrder(orderId: string) {
    return this.updateOrderStatus(orderId, 'paid');
  }

  async cancelOrder(orderId: string, reason?: string) {
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'cancelled',
        notes: reason ? `Cancelled: ${reason}` : undefined,
      },
    });
    return updated;
  }

  async getOrderTotal(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error('Order not found');
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