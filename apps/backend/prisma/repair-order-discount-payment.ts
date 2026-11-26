import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Repair orders affected by the POS discount payload bug.
 *
 * For a short window, the POS computed a discounted client total and paid that
 * amount, but the discount fields were dropped before the order was created.
 * The backend therefore stored the gross total again and recorded the discount
 * as an outstanding balance (for example total 400, paid 380, due 20).
 *
 * This repair is deliberately conservative and idempotent. It only touches
 * PARTIAL, non-credit orders where:
 *   - no discount has been recorded yet,
 *   - gross still equals the stored total,
 *   - paid + due reconciles exactly to that total,
 *   - the entire due amount equals one of the POS quick discounts (5/10/15%)
 *     applied to the subtotal, and
 *   - the amount actually paid equals the discounted net total.
 *
 * Genuine partial payments (for example paying 325.50 against 1860) do not
 * match those checks and are left untouched. Re-running finds no candidates.
 */
const QUICK_DISCOUNT_PERCENTS = [5, 10, 15] as const;

const round2 = (value: number): number => +Number(value || 0).toFixed(2);

export interface CandidateOrder {
  id: string;
  orderNumber: number;
  restaurantId: string;
  subtotal: number;
  tax: number;
  serviceCharge: number;
  deliveryCharge: number;
  total: number;
  totalPaid: number | null;
  amountDue: number;
}

export interface Repair extends CandidateOrder {
  discountPercent: number;
  discountAmount: number;
  netTotal: number;
}

export function planRepair(order: CandidateOrder): Repair | null {
  const subtotal = round2(Number(order.subtotal));
  const gross = round2(
    Number(order.subtotal) +
      Number(order.tax) +
      Number(order.serviceCharge) +
      Number(order.deliveryCharge)
  );
  const total = round2(Number(order.total));
  const paid = round2(Number(order.totalPaid || 0));
  const due = round2(Number(order.amountDue));

  if (Math.abs(gross - total) > 0.01) return null;
  if (subtotal <= 0 || due <= 0.01 || paid <= 0) return null;
  if (Math.abs(paid + due - total) > 0.01) return null;

  const discountPercent = QUICK_DISCOUNT_PERCENTS.find(
    (percent) => Math.abs(due - round2((subtotal * percent) / 100)) <= 0.01
  );
  if (discountPercent === undefined) return null;

  const discountAmount = round2((subtotal * discountPercent) / 100);
  const netTotal = round2(gross - discountAmount);
  if (Math.abs(netTotal - paid) > 0.01) return null;

  return {
    ...order,
    discountPercent,
    discountAmount,
    netTotal,
  };
}

async function findCandidates(): Promise<CandidateOrder[]> {
  return prisma.order.findMany({
    where: {
      discountPercent: 0,
      discountAmount: 0,
      paymentStatus: 'PARTIAL',
      settledToCredit: false,
      amountDue: { gt: 0.01 },
      totalPaid: { gt: 0 },
    },
    select: {
      id: true,
      orderNumber: true,
      restaurantId: true,
      subtotal: true,
      tax: true,
      serviceCharge: true,
      deliveryCharge: true,
      total: true,
      totalPaid: true,
      amountDue: true,
    },
  });
}

export async function repairOrderDiscountPayments(): Promise<number> {
  const candidates = await findCandidates();
  const repairs = candidates
    .map(planRepair)
    .filter((repair): repair is Repair => repair !== null);

  if (repairs.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const repair of repairs) {
        await tx.order.update({
          where: { id: repair.id },
          data: {
            discountPercent: repair.discountPercent,
            discountAmount: repair.discountAmount,
            total: repair.netTotal,
            amountDue: 0,
            paymentStatus: 'PAID',
            status: 'paid',
            completedAt: new Date(),
          },
        });
      }
    });
  }

  // Fail closed: after the repair, no order may still carry the exact signature.
  const remaining = (await findCandidates())
    .map(planRepair)
    .filter((repair): repair is Repair => repair !== null);

  if (remaining.length > 0) {
    const restaurants = await prisma.restaurant.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
    const labelFor = (restaurantId: string) => {
      const restaurant = restaurants.find((row) => row.id === restaurantId);
      return restaurant
        ? `${restaurant.name}${restaurant.slug ? ` (${restaurant.slug})` : ''}`
        : restaurantId;
    };
    const byBusiness = new Map<string, string[]>();
    for (const order of remaining) {
      const messages = byBusiness.get(order.restaurantId) || [];
      messages.push(`#${order.orderNumber}`);
      byBusiness.set(order.restaurantId, messages);
    }
    const failures = [...byBusiness].map(
      ([restaurantId, orders]) =>
        `${labelFor(restaurantId)}: ${orders.join(', ')}`
    );
    console.error('Order discount payment repair FAILED per business:');
    for (const failure of failures) console.error(`  - ${failure}`);
    throw new Error(
      `Order discount payment repair left ${remaining.length} order(s) unresolved.`
    );
  }

  if (repairs.length > 0) {
    console.log(
      `Order discount payment repair restored ${repairs.length} order(s): ` +
        repairs.map((r) => `#${r.orderNumber}`).join(', ')
    );
  } else {
    console.log('Order discount payment repair: no changes needed.');
  }

  return repairs.length;
}

export async function disconnectOrderDiscountRepairDb(): Promise<void> {
  await prisma.$disconnect();
}

if (
  require.main === module ||
  (process.argv[1] && process.argv[1].includes('repair-order-discount-payment'))
) {
  repairOrderDiscountPayments()
    .then(() => console.log('Order discount payment repair verification PASSED.'))
    .catch((error) => {
      console.error('Order discount payment repair failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectOrderDiscountRepairDb();
    });
}
