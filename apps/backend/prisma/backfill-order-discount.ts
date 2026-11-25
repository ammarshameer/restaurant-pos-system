import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotent post-schema backfill for order-level percentage discounts.
 *
 * Older orders had no dedicated discount columns, so their discount was only
 * visible as the difference between the computed gross (subtotal + tax +
 * charges) and the stored total. This script records that implied discount once,
 * in both percent and amount form. Re-running never overwrites a value that was
 * already recorded, so discounts applied from the POS are preserved.
 *
 * Verification is fail-closed per business: inconsistent or impossible discount
 * values, or unexplained gross/total gaps, abort the deploy.
 */
export async function backfillOrderDiscount(): Promise<number> {
  const updated = await prisma.$executeRaw`
    UPDATE "Order"
    SET
      "discountAmount" = ROUND(GREATEST(
        ("subtotal" + "tax" + "serviceCharge" + "deliveryCharge") - "total", 0
      )::numeric, 2),
      "discountPercent" = CASE
        WHEN ("subtotal" + "tax" + "serviceCharge" + "deliveryCharge") > 0
        THEN ROUND((GREATEST(
          ("subtotal" + "tax" + "serviceCharge" + "deliveryCharge") - "total", 0
        ) * 100 / ("subtotal" + "tax" + "serviceCharge" + "deliveryCharge"))::numeric, 2)
        ELSE 0
      END
    WHERE "discountPercent" = 0
      AND "discountAmount" = 0
      AND ("subtotal" + "tax" + "serviceCharge" + "deliveryCharge") - "total" >= 0.01
  `;

  const invalid = await prisma.order.findMany({
    where: {
      OR: [
        { discountPercent: { lt: 0 } },
        { discountPercent: { gt: 100 } },
        { discountAmount: { lt: 0 } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      restaurantId: true,
      discountPercent: true,
      discountAmount: true,
    },
  });

  const unresolvedRows = await prisma.$queryRaw<Array<{
    id: string;
    orderNumber: number;
    restaurantId: string;
  }>>`
    SELECT "id", "orderNumber", "restaurantId"
    FROM "Order"
    WHERE "discountAmount" = 0
      AND ("subtotal" + "tax" + "serviceCharge" + "deliveryCharge") - "total" >= 0.05
  `;

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

  const failures: string[] = [];
  const byBusiness = new Map<string, string[]>();
  for (const row of [
    ...invalid.map((order) => ({
      restaurantId: order.restaurantId,
      message: `#${order.orderNumber} has invalid discount (${order.discountPercent}%, ${order.discountAmount})`,
    })),
    ...unresolvedRows.map((order) => ({
      restaurantId: order.restaurantId,
      message: `#${order.orderNumber} has an unexplained gross/total difference`,
    })),
  ]) {
    const messages = byBusiness.get(row.restaurantId) || [];
    messages.push(row.message);
    byBusiness.set(row.restaurantId, messages);
  }
  for (const [restaurantId, messages] of byBusiness) {
    failures.push(`${labelFor(restaurantId)}: ${messages.join('; ')}`);
  }

  if (failures.length > 0) {
    console.error('Order discount backfill FAILED per business:');
    for (const failure of failures) console.error(`  - ${failure}`);
    throw new Error(`Order discount backfill failed for ${failures.length} business(es).`);
  }

  if (updated > 0) {
    console.log(`Order discount backfill derived discounts for ${updated} order(s).`);
  } else {
    console.log('Order discount backfill: no changes needed.');
  }

  return Number(updated);
}

export async function disconnectOrderDiscountDb(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-order-discount'))) {
  backfillOrderDiscount()
    .then(() => console.log('Order discount backfill verification PASSED.'))
    .catch((error) => {
      console.error('Order discount backfill failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectOrderDiscountDb();
    });
}
