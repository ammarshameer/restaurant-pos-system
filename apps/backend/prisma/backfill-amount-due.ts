import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotent backfill for orders created before `Order.amountDue` existed.
 * Those rows defaulted to 0 even though they were still unpaid, which made the
 * cash register show a zero balance due.
 */
async function main() {
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Order"
        SET "amountDue" = ROUND(("total" - "totalPaid") * 100) / 100.0
      WHERE "amountDue" = 0
        AND "totalPaid" = 0
        AND "paymentStatus" != 'PAID'
        AND "total" > 0
        AND "settledToCredit" = 0`
  );

  console.log(`Backfilled amountDue for ${updated} order(s).`);
}

main()
  .catch((error) => {
    console.error('Failed to backfill amountDue:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
