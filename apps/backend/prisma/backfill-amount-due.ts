import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotently repair orders created before `Order.amountDue` existed, and old
 * partly paid orders that still have a zero balance due. Credit-settled orders
 * are left alone because their balance was cleared through customer credit.
 *
 * PostgreSQL stores settledToCredit as a boolean, so the literal must be
 * `false` (not `0`). The same predicate also works on SQLite used in tests.
 */
export async function backfillAmountDue(): Promise<number> {
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Order"
        SET "amountDue" = ROUND(("total" - COALESCE("totalPaid", 0)) * 100) / 100.0
      WHERE "amountDue" = 0
        AND COALESCE("totalPaid", 0) < "total"
        AND ("paymentStatus" IS NULL OR "paymentStatus" <> 'PAID')
        AND "total" > 0
        AND "settledToCredit" = false`
  );

  console.log(`Backfilled amountDue for ${updated} order(s).`);
  return updated;
}

export async function disconnectAmountDueDb(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-amount-due'))) {
  backfillAmountDue()
    .catch((error) => {
      console.error('Failed to backfill amountDue:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
