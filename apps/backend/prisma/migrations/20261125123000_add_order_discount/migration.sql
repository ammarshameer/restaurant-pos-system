-- Add order-level percentage discounts. Existing orders are backfilled by the
-- mandatory idempotent post-migration script (db:backfill:order-discount), which
-- also derives the implied discount on older orders where the stored total was
-- already reduced manually.
ALTER TABLE "Order"
  ADD COLUMN "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
