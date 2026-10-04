import { PrismaClient } from '@prisma/client';
import { OrderService } from './order.service';

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'ONLINE' | string;
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | string;

const prisma = new PrismaClient();
const orderService = new OrderService();

export class PaymentService {
  async createPayment(data: {
    orderId: string;
    amount: number;
    tipAmount?: number;
    method?: PaymentMethod;
    splitNumber?: number;
    transactionId?: string;
  }, restaurantId?: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: data.orderId,
        ...(restaurantId ? { restaurantId } : {}),
      },
      include: { payments: true },
    });

    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    const payment = await prisma.payment.create({
      data: {
        orderId: data.orderId,
        amount: data.amount,
        tipAmount: data.tipAmount || 0,
        method: data.method || 'CASH',
        status: 'COMPLETED', // Cash/offline payments in POS are settled immediately
        splitNumber: data.splitNumber,
        transactionId: data.transactionId || `CASH-${Date.now().toString().slice(-6)}`,
        processedAt: new Date(),
      },
    });

    // Check if order is now fully paid
    const updatedOrder = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: { payments: true },
    });

    if (updatedOrder) {
      const totalPaid = updatedOrder.payments
        .filter((p) => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const orderTotal = Number(updatedOrder.total);

      if (totalPaid >= orderTotal - 0.01) {
        // Complete order & deduct inventory
        await orderService.completeOrder(updatedOrder.id, updatedOrder.restaurantId);
      }
    }

    return payment;
  }

  async confirmPayment(paymentId: string, restaurantId?: string) {
    const existingPayment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        ...(restaurantId ? { order: { restaurantId } } : {}),
      },
      include: { order: true },
    });

    if (!existingPayment) {
      throw new Error('Payment not found or unauthorized');
    }

    const payment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });

    // Update order status and deduct inventory if fully paid
    const order = await prisma.order.findUnique({
      where: { id: payment.orderId },
      include: { payments: true },
    });

    if (order) {
      const totalPaid = order.payments
        .filter((p) => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const orderTotal = Number(order.total);

      if (totalPaid >= orderTotal - 0.01) {
        await orderService.completeOrder(order.id, order.restaurantId);
      }
    }

    return payment;
  }

  async processRefund(paymentId: string, _amount?: number, restaurantId?: string) {
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        ...(restaurantId ? { order: { restaurantId } } : {}),
      },
    });

    if (!payment) {
      throw new Error('Payment not found or unauthorized');
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'REFUNDED',
      },
    });

    return { success: true, payment: updatedPayment };
  }

  async splitBill(
    orderId: string,
    splits: Array<{ amount: number; method?: PaymentMethod }>,
    restaurantId?: string
  ) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        ...(restaurantId ? { restaurantId } : {}),
      },
      include: { items: { include: { menuItem: true } } },
    });

    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    const total = Number(order.total);
    const splitTotal = splits.reduce((sum, split) => sum + split.amount, 0);

    if (Math.abs(splitTotal - total) > 0.05) {
      throw new Error(`Split amounts ($${splitTotal.toFixed(2)}) do not match order total ($${total.toFixed(2)})`);
    }

    const payments = await Promise.all(
      splits.map((split, index) =>
        this.createPayment({
          orderId,
          amount: split.amount,
          method: split.method || 'CASH',
          splitNumber: index + 1,
        }, order.restaurantId)
      )
    );

    return payments;
  }

  async getPaymentsByOrder(orderId: string, restaurantId?: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!order) {
      throw new Error('Order not found or unauthorized');
    }

    return prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPaymentsByRestaurant(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      method?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = {
      order: {
        restaurantId,
      },
    };

    if (options?.method && options.method !== 'ALL' && options.method !== 'All') {
      whereClause.method = options.method;
    }

    if (options?.startDate || options?.endDate) {
      whereClause.createdAt = {
        ...(options.startDate ? { gte: options.startDate } : {}),
        ...(options.endDate ? { lte: options.endDate } : {}),
      };
    }

    if (options?.search && options.search.trim()) {
      const q = options.search.trim();
      const num = parseInt(q, 10);
      whereClause.OR = [
        ...(!isNaN(num) ? [{ order: { orderNumber: num } }] : []),
        { transactionId: { contains: q } },
        { order: { customerName: { contains: q } } },
        { order: { customerPhone: { contains: q } } },
      ];
    }

    const [totalCount, payments] = await Promise.all([
      prisma.payment.count({ where: whereClause }),
      prisma.payment.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          order: {
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
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
      data: payments,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  /**
   * Generates structured receipt and invoice data with restaurant profile and item breakdown
   */
  async getReceiptData(paymentIdOrOrderId: string, restaurantId?: string) {
    // Try finding by payment ID first
    let payment = await prisma.payment.findFirst({
      where: {
        id: paymentIdOrOrderId,
        ...(restaurantId ? { order: { restaurantId } } : {}),
      },
      include: {
        order: {
          include: {
            restaurant: true,
            table: true,
            server: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            items: {
              include: {
                menuItem: true,
                modifiers: {
                  include: { modifier: true },
                },
              },
            },
            payments: true,
          },
        },
      },
    });

    let order = payment?.order;

    if (!order) {
      // Find directly by order ID
      order = await prisma.order.findFirst({
        where: {
          id: paymentIdOrOrderId,
          ...(restaurantId ? { restaurantId } : {}),
        },
        include: {
          restaurant: true,
          table: true,
          server: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          items: {
            include: {
              menuItem: true,
              modifiers: {
                include: { modifier: true },
              },
            },
          },
          payments: true,
        },
      });
      if (order && order.payments.length > 0) {
        payment = order.payments[0] as any;
      }
    }

    if (!order) {
      throw new Error('Order or Payment not found or unauthorized');
    }

    const restaurant = order.restaurant;
    const subtotal = Number(order.subtotal);
    const tax = 0; // Tax disabled
    const total = Number(order.total);
    const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const tipAmount = order.payments.reduce((sum, p) => sum + Number(p.tipAmount), 0);
    const change = Math.max(0, totalPaid - total);

    return {
      receiptNumber: `REC-${order.orderNumber.toString().padStart(6, '0')}`,
      orderNumber: order.orderNumber,
      orderId: order.id,
      date: payment?.processedAt || order.createdAt,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.address,
        phone: restaurant.phone,
        email: restaurant.email,
      },
      server: order.server
        ? `${order.server.firstName} ${order.server.lastName}`
        : 'Cashier',
      table: order.table ? order.table.number : 'Takeout / Direct',
      customerCount: order.customerCount,
      orderType: order.orderType || (order as any).orderTypeLabel || 'Dine In',
      items: order.items.map((item) => ({
        id: item.id,
        name: item.menuItem?.name || item.name || 'Dish',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
        notes: item.specialInstructions,
        modifiers: item.modifiers?.map((m) => ({
          name: m.modifier.name,
          price: Number(m.price),
        })),
      })),
      subtotal,
      tax,
      tipAmount,
      total,
      totalPaid,
      change,
      paymentMethod: payment?.method || 'CASH',
      paymentStatus: payment?.status || 'COMPLETED',
      payments: order.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        method: p.method,
        status: p.status,
        processedAt: p.processedAt,
        transactionId: p.transactionId,
      })),
    };
  }
}
