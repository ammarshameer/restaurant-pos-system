-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "logoUrl" TEXT;

-- Idempotent backfill: give active owners the business logo as their profile
-- logo when they have not chosen one. Re-running only fills NULL values, so a
-- logo changed later in the Owner Profile is never overwritten.
UPDATE "Employee" AS e
SET "logoUrl" = r."logoUrl"
FROM "Restaurant" AS r
WHERE e."restaurantId" = r."id"
  AND e."isActive" = true
  AND e."logoUrl" IS NULL
  AND r."logoUrl" IS NOT NULL
  AND (
    e."role" = 'OWNER'
    OR EXISTS (
      SELECT 1
      FROM "Role" AS role
      WHERE role."id" = e."roleId"
        AND (role."key" = 'OWNER' OR role."isOwnerRole" = true)
    )
  );
