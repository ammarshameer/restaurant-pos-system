import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { ValidationError } from '../lib/errors';
import { getIO } from '../websocket';

const prisma = new PrismaClient();

export class CustomerCreditService {
  async charge(
    restaurantId: string,
    customerId: string,
    orderId: string | null,
    amount: number,
    note?: string,
    createdById?: string,
    txClient?: any
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }
    const chargeAmount = +Number(amount).toFixed(2);
    if (chargeAmount <= 0) {
      throw new ValidationError('Charge amount must be greater than zero');
    }

    const run = async (tx: any) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, restaurantId },
      });
      if (!customer) {
        throw new ValidationError('Customer not found in this business');
      }

      const balanceAfter = +(Number(customer.balanceDue || 0) + chargeAmount).toFixed(2);

      await tx.customer.update({
        where: { id: customerId },
        data: { balanceDue: balanceAfter },
      });

      const entry = await tx.customerLedgerEntry.create({
        data: {
          restaurantId,
          customerId,
          orderId: orderId || null,
          type: 'CHARGE',
          amount: chargeAmount,
          balanceAfter,
          note: note || (orderId ? `Order charge` : 'Credit charge'),
          createdById: createdById || null,
        },
      });

      return { customer, entry, balanceAfter };
    };

    if (txClient) {
      return run(txClient);
    }
    return prisma.$transaction(run);
  }

  /**
   * Reverse credit previously charged to a customer for an order (used when an
   * order is cancelled or a credit payment is refunded). Idempotent: it only
   * reverses the portion of the CHARGE that has not already been refunded.
   */
  async reverseCharge(
    restaurantId: string,
    orderId: string,
    amount?: number,
    note?: string,
    createdById?: string,
    txClient?: any
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const run = async (tx: any) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, restaurantId },
      });
      if (!order) {
        throw new ValidationError('Order not found in this business');
      }
      if (!order.customerId) {
        return { reversed: 0, balanceAfter: null };
      }

      const [chargeEntries, refundEntries] = await Promise.all([
        tx.customerLedgerEntry.findMany({
          where: { restaurantId, orderId, type: 'CHARGE' },
        }),
        tx.customerLedgerEntry.findMany({
          where: { restaurantId, orderId, type: 'REFUND' },
        }),
      ]);

      const charged = chargeEntries.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
      const alreadyRefunded = refundEntries.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
      const outstanding = Math.max(0, +(charged - alreadyRefunded).toFixed(2));
      const requested =
        amount !== undefined
          ? Math.min(Math.abs(Number(amount) || 0), outstanding)
          : outstanding;

      if (requested <= 0.009) {
        return { reversed: 0, balanceAfter: null };
      }

      const customer = await tx.customer.findFirst({
        where: { id: order.customerId, restaurantId },
      });
      if (!customer) {
        throw new ValidationError('Customer not found in this business');
      }

      const balanceAfter = Math.max(0, +(Number(customer.balanceDue || 0) - requested).toFixed(2));

      await tx.customer.update({
        where: { id: customer.id },
        data: { balanceDue: balanceAfter },
      });

      const entry = await tx.customerLedgerEntry.create({
        data: {
          restaurantId,
          customerId: order.customerId,
          orderId,
          type: 'REFUND',
          amount: +requested.toFixed(2),
          balanceAfter,
          note: note || `Credit reversed for order #${order.orderNumber}`,
          createdById: createdById || null,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          amountDue: Math.max(0, +(Number(order.amountDue || 0) - requested).toFixed(2)),
          settledToCredit: false,
        },
      });

      return { reversed: +requested.toFixed(2), balanceAfter, entry };
    };

    if (txClient) {
      return run(txClient);
    }
    return prisma.$transaction(run);
  }

  async receivePayment(
    restaurantId: string,
    customerId: string,
    amount: number,
    method = 'CASH',
    note?: string,
    createdById?: string,
    clientId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }
    const paymentAmount = +Number(amount).toFixed(2);
    if (paymentAmount <= 0) {
      throw new ValidationError('Payment amount must be greater than zero');
    }

    if (clientId) {
      const existing = await prisma.customerLedgerEntry.findFirst({
        where: { restaurantId, customerId, clientId },
        include: { customer: true },
      });
      if (existing) {
        return {
          customer: existing.customer,
          entry: existing,
          balanceAfter: existing.balanceAfter,
          allocatedOrdersCount: 0,
          duplicate: true,
        };
      }
    }

    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, restaurantId },
      });
      if (!customer) {
        throw new ValidationError('Customer not found in this business');
      }

      const currentBalance = Number(customer.balanceDue || 0);
      if (paymentAmount > currentBalance + 0.01) {
        throw new ValidationError(
          `Payment amount (${paymentAmount}) exceeds customer balance due (${currentBalance})`
        );
      }

      // FIFO allocation to customer's oldest orders with settledToCredit = true and amountDue > 0
      const unpaidOrders = await tx.order.findMany({
        where: {
          restaurantId,
          customerId,
          settledToCredit: true,
          amountDue: { gt: 0.01 },
        },
        orderBy: { createdAt: 'asc' },
      });

      let remainingToAllocate = paymentAmount;
      const updatedOrders = [];

      for (const order of unpaidOrders) {
        if (remainingToAllocate <= 0) break;
        const currentOrderDue = Number(order.amountDue || 0);
        const allocated = Math.min(remainingToAllocate, currentOrderDue);

        if (allocated > 0) {
          const uniqueTxId = `DUES-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          await tx.payment.create({
            data: {
              orderId: order.id,
              amount: +allocated.toFixed(2),
              method: method || 'CASH',
              status: 'COMPLETED',
              transactionId: uniqueTxId,
              processedAt: new Date(),
            },
          });

          const newTotalPaid = +(Number(order.totalPaid || 0) + allocated).toFixed(2);
          const newAmountDue = Math.max(0, +(currentOrderDue - allocated).toFixed(2));
          const newPaymentStatus = newAmountDue <= 0.01 ? 'PAID' : 'PARTIAL';

          const updated = await tx.order.update({
            where: { id: order.id },
            data: {
              totalPaid: newTotalPaid,
              amountDue: newAmountDue,
              paymentStatus: newPaymentStatus,
              ...(newPaymentStatus === 'PAID' ? { status: 'paid', completedAt: new Date() } : {}),
            },
          });

          updatedOrders.push(updated);
          remainingToAllocate = +(remainingToAllocate - allocated).toFixed(2);
        }
      }

      const balanceAfter = Math.max(0, +(currentBalance - paymentAmount).toFixed(2));

      await tx.customer.update({
        where: { id: customerId },
        data: { balanceDue: balanceAfter },
      });

      const entryTxId = `DUES-TX-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const entry = await tx.customerLedgerEntry.create({
        data: {
          restaurantId,
          customerId,
          type: 'PAYMENT',
          amount: paymentAmount,
          balanceAfter,
          method: method || 'CASH',
          note: note || 'Dues payment received',
          createdById: createdById || null,
          clientId: clientId || null,
          transactionId: entryTxId,
        },
      });

      const io = getIO();
      for (const ord of updatedOrders) {
        io?.to(`restaurant:${restaurantId}`).emit('order:updated', ord);
      }

      return {
        customer,
        entry,
        balanceAfter,
        allocatedOrdersCount: updatedOrders.length,
        duplicate: false,
      };
    });
  }

  async adjust(
    restaurantId: string,
    customerId: string,
    amount: number,
    note?: string,
    createdById?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const adjustAmount = +Number(amount).toFixed(2);
    if (adjustAmount === 0 || !Number.isFinite(adjustAmount)) {
      throw new ValidationError('Adjustment amount must be a non-zero number');
    }

    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, restaurantId },
      });
      if (!customer) {
        throw new ValidationError('Customer not found in this business');
      }

      const currentBalance = Number(customer.balanceDue || 0);
      if (adjustAmount < 0 && Math.abs(adjustAmount) > currentBalance + 0.01) {
        throw new ValidationError(
          `Adjustment of ${adjustAmount} exceeds the customer's outstanding balance of ${currentBalance}`
        );
      }
      const balanceAfter = Math.max(0, +(currentBalance + adjustAmount).toFixed(2));

      await tx.customer.update({
        where: { id: customerId },
        data: { balanceDue: balanceAfter },
      });

      const entry = await tx.customerLedgerEntry.create({
        data: {
          restaurantId,
          customerId,
          type: 'ADJUSTMENT',
          // Signed so the ledger always reconciles with the running balance.
          amount: adjustAmount,
          balanceAfter,
          note: note || (adjustAmount > 0 ? 'Balance increased' : 'Balance decreased'),
          createdById: createdById || null,
        },
      });

      return { customer, entry, balanceAfter };
    });
  }

  async listDues(
    restaurantId: string,
    options?: { search?: string; page?: number; limit?: number }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 20);
    const search = options?.search?.trim() || '';

    const where: any = {
      restaurantId,
      balanceDue: { gt: 0 },
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const [data, totalCount, aggregate] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ balanceDue: 'desc' }, { lastOrderAt: 'desc' }],
      }),
      prisma.customer.count({ where }),
      prisma.customer.aggregate({
        where: { restaurantId, balanceDue: { gt: 0 } },
        _sum: { balanceDue: true },
        _count: true,
      }),
    ]);

    const totalOutstanding = +(aggregate._sum.balanceDue || 0).toFixed(2);
    const customersWithDues = aggregate._count || 0;

    return {
      data,
      page,
      limit,
      totalCount,
      totalOutstanding,
      customersWithDues,
      hasMore: page * limit < totalCount,
    };
  }

  async getLedger(
    restaurantId: string,
    customerId: string,
    options?: { page?: number; limit?: number }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);

    const where = { restaurantId, customerId };

    const [data, totalCount] = await Promise.all([
      prisma.customerLedgerEntry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              orderType: true,
              total: true,
              totalPaid: true,
              amountDue: true,
              paymentStatus: true,
            },
          },
        },
      }),
      prisma.customerLedgerEntry.count({ where }),
    ]);

    return {
      data,
      page,
      limit,
      totalCount,
      hasMore: page * limit < totalCount,
    };
  }

  async getStatement(
    restaurantId: string,
    customerId: string,
    startDate?: string,
    endDate?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, restaurantId },
    });
    if (!customer) {
      throw new ValidationError('Customer not found');
    }

    const where: any = { restaurantId, customerId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    const [entries, unpaidOrders] = await Promise.all([
      prisma.customerLedgerEntry.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              total: true,
              totalPaid: true,
              amountDue: true,
              paymentStatus: true,
            },
          },
        },
      }),
      prisma.order.findMany({
        where: {
          restaurantId,
          customerId,
          amountDue: { gt: 0 },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const totalCharged = entries.reduce((sum, entry) => {
      if (entry.type === 'CHARGE') return sum + Number(entry.amount || 0);
      if (entry.type === 'ADJUSTMENT' && Number(entry.amount) > 0) return sum + Number(entry.amount);
      return sum;
    }, 0);
    const totalPaid = entries.reduce((sum, entry) => {
      if (entry.type === 'PAYMENT' || entry.type === 'REFUND') return sum + Math.abs(Number(entry.amount || 0));
      if (entry.type === 'ADJUSTMENT' && Number(entry.amount) < 0) return sum + Math.abs(Number(entry.amount));
      return sum;
    }, 0);

    return {
      customer,
      entries,
      unpaidOrders,
      totalCharged: +totalCharged.toFixed(2),
      totalPaid: +totalPaid.toFixed(2),
      currentBalance: customer.balanceDue,
    };
  }
}

