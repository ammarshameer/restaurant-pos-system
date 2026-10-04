import { PrismaClient } from '@prisma/client';
import { OrderService } from './order.service';

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'ONLINE' | string;
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | string;

const prisma = new PrismaClient();
const orderService = new OrderService();

export class PaymentService {
  async createPayment(
    data: {
      orderId: string;
      amount: number;
      tipAmount?: number;
      method?: PaymentMethod;
      splitNumber?: number;
      transactionId?: string;
    },
    restaurantId: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to create a payment');
    }

    const order = await prisma.order.findFirst({
      where: {
        id: data.orderId,
        restaurantId,
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
    const updatedOrder = await prisma.order.findFirst({
      where: { id: data.orderId, restaurantId },
      include: { payments: true },
    });

    if (updatedOrder) {
      const totalPaid = updatedOrder.payments
        .filter((p) => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const orderTotal = Number(updatedOrder.total);

      if (totalPaid >= orderTotal - 0.01) {
        // Complete order & deduct inventory
        await orderService.completeOrder(updatedOrder.id, restaurantId);
      }
    }

    return payment;
  }

  async confirmPayment(paymentId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to confirm a payment');
    }

    const existingPayment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        order: { restaurantId },
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
    const order = await prisma.order.findFirst({
      where: { id: payment.orderId, restaurantId },
      include: { payments: true },
    });

    if (order) {
      const totalPaid = order.payments
        .filter((p) => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const orderTotal = Number(order.total);

      if (totalPaid >= orderTotal - 0.01) {
        await orderService.completeOrder(order.id, restaurantId);
      }
    }

    return payment;
  }

  async processRefund(paymentId: string, _amount?: number, restaurantId?: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to process a refund');
    }

    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        order: { restaurantId },
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
    restaurantId: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to split bill');
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
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
        this.createPayment(
          {
            orderId,
            amount: split.amount,
            method: split.method || 'CASH',
            splitNumber: index + 1,
          },
          restaurantId
        )
      )
    );

    return payments;
  }

  async getPaymentsByOrder(orderId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve payments');
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
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

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
  async getReceiptData(paymentIdOrOrderId: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve receipt data');
    }

    // Try finding by payment ID first
    let payment = await prisma.payment.findFirst({
      where: {
        id: paymentIdOrOrderId,
        order: { restaurantId },
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
          restaurantId,
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
    }

    if (!order) {
      throw new Error('Receipt record not found or unauthorized');
    }

    const restaurant = order.restaurant;

    const totalPaid = (order.payments || [])
      .filter((p: any) => p.status === 'COMPLETED')
      .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

    const balanceDue = Math.max(0, +(Number(order.total) - totalPaid).toFixed(2));

    return {
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.address || '123 Main Street, Suite 100',
        phone: restaurant.phone || '+1 (555) 000-0000',
        email: restaurant.email || 'info@restaurant.com',
      },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        orderTypeLabel: order.orderTypeLabel || order.orderType,
        createdAt: order.createdAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        dineInTag: order.dineInTag,
        tableName: order.table?.number || null,
        serverName: order.server ? `${order.server.firstName} ${order.server.lastName}`.trim() : null,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        deliveryAddress: order.deliveryAddress,
      },
      items: (order.items || []).map((item: any) => ({
        id: item.id,
        name: item.name || item.menuItem?.name || 'Item',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice || item.price || 0),
        total: Number(item.total || (item.unitPrice || item.price || 0) * item.quantity),
        notes: item.notes || item.specialInstructions || null,
      })),
      totals: {
        subtotal: Number(order.subtotal || 0),
        serviceCharge: Number(order.serviceCharge || 0),
        deliveryCharge: Number(order.deliveryCharge || 0),
        tax: Number(order.tax || 0),
        taxRate: Number(order.taxRate || 0.05),
        total: Number(order.total || 0),
        totalPaid: +totalPaid.toFixed(2),
        balanceDue,
        change: Number(order.change || 0),
      },
      payments: (order.payments || []).map((p: any) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        status: p.status,
        transactionId: p.transactionId,
        processedAt: p.processedAt,
      })),
      receiptMeta: {
        receiptNumber: payment?.transactionId || `REC-${order.orderNumber}-${Date.now().toString().slice(-4)}`,
        generatedAt: new Date(),
        footerMessage: 'Thank you for dining with us! Please come again.',
      },
    };
  }
}

export const paymentService = new PaymentService();
