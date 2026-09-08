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
  }) {
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
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: { payments: true },
    });

    if (order) {
      const totalPaid = order.payments
        .filter((p) => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const orderTotal = Number(order.total);

      if (totalPaid >= orderTotal - 0.01) {
        // Complete order & deduct inventory
        await orderService.completeOrder(order.id);
      }
    }

    return payment;
  }

  async confirmPayment(paymentId: string) {
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
        await orderService.completeOrder(order.id);
      }
    }

    return payment;
  }

  async processRefund(paymentId: string, _amount?: number) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error('Payment not found');
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
    splits: Array<{ amount: number; method?: PaymentMethod }>
  ) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: true } } },
    });

    if (!order) {
      throw new Error('Order not found');
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
        })
      )
    );

    return payments;
  }

  async getPaymentsByOrder(orderId: string) {
    return prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Generates structured receipt and invoice data with restaurant profile and item breakdown
   */
  async getReceiptData(paymentIdOrOrderId: string) {
    // Try finding by payment ID first
    let payment = await prisma.payment.findUnique({
      where: { id: paymentIdOrOrderId },
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
      order = await prisma.order.findUnique({
        where: { id: paymentIdOrOrderId },
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
      throw new Error('Order or Payment not found');
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
