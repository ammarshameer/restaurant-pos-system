-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "address" TEXT;

-- Idempotent backfill: seed a personal address from the employee's business
-- address. Re-running this migration is safe because only NULL rows are filled.
UPDATE "Employee" AS e
SET "address" = r."address"
FROM "Restaurant" AS r
WHERE e."restaurantId" = r."id"
  AND e."address" IS NULL
  AND r."address" IS NOT NULL;
