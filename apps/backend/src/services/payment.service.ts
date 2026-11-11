import { PrismaClient } from '@prisma/client';
import { OrderService } from './order.service';
import { CustomerCreditService } from './customer-credit.service';
import { ValidationError } from '../lib/errors';
import { getIO } from '../websocket';

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'ONLINE' | string;
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | string;

const prisma = new PrismaClient();
const orderService = new OrderService();
const customerCreditService = new CustomerCreditService();

export class PaymentService {
  async createPayment(
    data: {
      orderId: string;
      amount: number;
      tipAmount?: number;
      method?: PaymentMethod;
      splitNumber?: number;
      transactionId?: string;
      settleToCredit?: boolean;
      createdById?: string;
      clientId?: string;
    },
    restaurantId: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to create a payment');
    }
    if (!data.orderId) {
      throw new ValidationError('orderId is required');
    }

    const paymentAmount = +Number(data.amount || 0).toFixed(2);
    if (paymentAmount <= 0 && !data.settleToCredit) {
      throw new ValidationError('Payment amount must be greater than zero');
    }

    let shouldComplete = false;
    let orderToCompleteId: string | null = null;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: data.orderId,
          restaurantId,
        },
      });

      if (!order) {
        throw new Error('Order not found or unauthorized');
      }

      // Idempotency: an offline replay carries the same clientId. Return the
      // original payment instead of charging the customer twice.
      if (data.clientId) {
        const existingPayment = await tx.payment.findFirst({
          where: { clientId: data.clientId, orderId: order.id },
        });
        if (existingPayment) {
          const customer = order.customerId
            ? await tx.customer.findFirst({ where: { id: order.customerId, restaurantId } })
            : null;
          return {
            payment: existingPayment,
            order,
            customerBalance: customer ? Number(customer.balanceDue || 0) : null,
            duplicate: true,
          };
        }
      }

      // Credit-settled orders must be collected through the dues ledger so the
      // customer balance and the order cannot drift apart.
      if (order.settledToCredit && !data.settleToCredit) {
        throw new ValidationError(
          'This order was settled to customer credit. Record the payment from Customer Dues & Receivables.'
        );
      }

      if (data.settleToCredit) {
        if (!order.customerId) {
          throw new ValidationError('A customer must be attached to the order to settle remaining balance to credit');
        }
        const existingCharge = await tx.customerLedgerEntry.findFirst({
          where: { restaurantId, orderId: order.id, type: 'CHARGE' },
        });
        if (order.settledToCredit || existingCharge) {
          throw new ValidationError('This order has already been settled to customer credit');
        }
      }

      const completedPayments = await tx.payment.findMany({
        where: { orderId: order.id, status: 'COMPLETED' },
      });
      const priorPaid = +completedPayments
        .reduce((sum, p) => sum + Number(p.amount), 0)
        .toFixed(2);

      const orderTotal = +Number(order.total).toFixed(2);
      const amountDueBefore = Math.max(0, +(orderTotal - priorPaid).toFixed(2));

      if (paymentAmount > amountDueBefore + 0.01) {
        throw new ValidationError(
          `Payment amount (${paymentAmount}) exceeds the remaining balance due (${amountDueBefore})`
        );
      }

      let createdPayment: any = null;
      if (paymentAmount > 0) {
        createdPayment = await tx.payment.create({
          data: {
            clientId: data.clientId,
            orderId: order.id,
            amount: paymentAmount,
            tipAmount: data.tipAmount || 0,
            method: data.method || 'CASH',
            status: 'COMPLETED', // Cash/offline payments in POS are settled immediately
            splitNumber: data.splitNumber,
            transactionId: data.transactionId || `CASH-${Date.now().toString().slice(-6)}`,
            processedAt: new Date(),
          },
        });
      }

      const totalPaid = +(priorPaid + paymentAmount).toFixed(2);
      const amountDue = Math.max(0, +(orderTotal - totalPaid).toFixed(2));

      let paymentStatus = 'UNPAID';
      if (totalPaid >= orderTotal - 0.01) {
        paymentStatus = 'PAID';
      } else if (totalPaid > 0) {
        paymentStatus = 'PARTIAL';
      }

      let isSettledToCredit = false;
      let customerBalance: number | null = null;
      if (data.settleToCredit) {
        const customer = await tx.customer.findFirst({
          where: { id: order.customerId as string, restaurantId },
        });
        if (!customer) {
          throw new ValidationError('Customer not found in this business');
        }

        const creditLimit = Number(customer.creditLimit || 0);
        const projectedBalance = +(Number(customer.balanceDue || 0) + amountDue).toFixed(2);
        if (creditLimit > 0 && projectedBalance > creditLimit + 0.01) {
          throw new ValidationError(
            `Credit limit exceeded. Customer balance would be ${projectedBalance}, limit is ${creditLimit}`
          );
        }

        if (amountDue > 0) {
          isSettledToCredit = true;
          const chargeResult = await customerCreditService.charge(
            restaurantId,
            order.customerId as string,
            order.id,
            amountDue,
            `Order #${order.orderNumber} remaining balance`,
            data.createdById,
            tx
          );
          customerBalance = chargeResult.balanceAfter;
        } else {
          customerBalance = Number(customer.balanceDue || 0);
        }
      } else if (order.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: order.customerId, restaurantId },
        });
        customerBalance = customer ? Number(customer.balanceDue || 0) : null;
      }

      const isSettled = isSettledToCredit || order.settledToCredit;
      const isFullySettledOrPaid = paymentStatus === 'PAID' || isSettled;

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          totalPaid,
          amountDue,
          paymentStatus,
          paymentMethod: data.method || order.paymentMethod || 'CASH',
          settledToCredit: isSettled,
          ...(isFullySettledOrPaid ? { status: 'paid', completedAt: new Date() } : {}),
        },
        include: {
          items: true,
          payments: true,
        },
      });

      if (isFullySettledOrPaid) {
        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: { status: 'SERVED' },
        });

        const tableId = order.tableId || updatedOrder.tableId;
        if (tableId) {
          await tx.table.update({
            where: { id: tableId },
            data: { status: 'AVAILABLE', currentOrder: null },
          }).catch((err) => console.warn('Could not free table:', err));
        }
        await tx.table.updateMany({
          where: { currentOrder: order.id },
          data: { status: 'AVAILABLE', currentOrder: null },
        }).catch((err) => console.warn('Could not free table by currentOrder:', err));

        shouldComplete = true;
        orderToCompleteId = updatedOrder.id;
      }

      return {
        payment: createdPayment,
        order: updatedOrder,
        customerBalance,
        duplicate: false,
      };
    });

    if (shouldComplete && orderToCompleteId) {
      try {
        await orderService.completeOrder(orderToCompleteId, restaurantId);
      } catch (err) {
        console.warn('Post-payment completeOrder non-fatal warning:', err);
      }
    }

    const io = getIO();
    if (!result.duplicate) {
      if (result.order) {
        io?.to(`restaurant:${restaurantId}`).emit('order:updated', result.order);
        io?.to(`restaurant:${restaurantId}:kitchen`).emit('kitchen:order:updated', result.order);
        if (result.order.tableId) {
          io?.to(`restaurant:${restaurantId}`).emit('table:status', {
            tableId: result.order.tableId,
            status: 'AVAILABLE',
            currentOrder: null,
          });
        }
      }
      io?.to(`restaurant:${restaurantId}`).emit('payment:completed', result.payment);
    }

    return {
      ...(result.payment || {}),
      customerBalance: result.customerBalance,
      order: result.order,
      duplicate: result.duplicate,
    };
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
      const allPayments = await prisma.payment.findMany({
        where: { orderId: order.id, status: 'COMPLETED' },
      });
      const totalPaid = +allPayments
        .reduce((sum, p) => sum + Number(p.amount), 0)
        .toFixed(2);

      const orderTotal = +Number(order.total).toFixed(2);
      const amountDue = Math.max(0, +(orderTotal - totalPaid).toFixed(2));
      const paymentStatus = totalPaid >= orderTotal - 0.01 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';

      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          totalPaid,
          amountDue,
          paymentStatus,
          ...(paymentStatus === 'PAID' ? { status: 'paid', completedAt: new Date() } : {}),
        },
      });

      if (paymentStatus === 'PAID') {
        await orderService.completeOrder(order.id, restaurantId);
      }

      const io = getIO();
      io?.to(`restaurant:${restaurantId}`).emit('order:updated', updatedOrder);
      io?.to(`restaurant:${restaurantId}`).emit('payment:completed', payment);
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

    // If the order had an outstanding credit balance, reverse the remaining
    // dues so the customer is not left owing money for a refunded order.
    const order = await prisma.order.findFirst({
      where: { id: payment.orderId, restaurantId },
    });
    if (order?.settledToCredit && order.customerId && Number(order.amountDue || 0) > 0) {
      await customerCreditService.reverseCharge(
        restaurantId,
        order.id,
        Number(order.amountDue || 0),
        `Refund for order #${order.orderNumber}`
      );
    }

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
