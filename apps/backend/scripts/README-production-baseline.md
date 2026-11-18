# Production database baseline runbook

The live database was created with `prisma db push` from the old (~20-model)
schema, so it has no `_prisma_migrations` history. The checked-in
`20261117111351_init` migration creates the **full current schema** from empty
and therefore fails on that database. Do **not** resolve `init` as applied
before the schema actually matches — apply the reviewed one-off delta first,
verify no drift, and only then resolve the migrations as applied.

The delta is kept at
`prisma/live-baseline/20261118000000_live_schema_delta/migration.sql`.
It is deliberately **outside** `prisma/migrations/` so fresh databases still
apply the normal init migration. It was reviewed: additive only, with no
`DROP TABLE`, `DROP COLUMN`, or `DELETE` statements.

## 0. Preconditions

- PostgreSQL client tools (`psql`, `pg_dump`) and `rclone` installed.
- `DATABASE_URL` points to the **staging copy** for the first run.
- `BACKUP_REMOTE` configured so the backup is off-server.
- A maintenance window booked for the production run.

All commands below run from `apps/backend`.

## 1. Back up production

```bash
npm run db:backup
```

Confirm a new `*.sql.gz` appears in `BACKUP_DIR` and is copied to
`BACKUP_REMOTE`. Run `gzip -t` on the file before continuing.

## 2. Restore the backup to a staging database

```bash
createdb restaurant_pos_staging
RESTORE_DATABASE_URL='postgresql://pos:pos@localhost:5432/restaurant_pos_staging?schema=public' \
  npm run db:restore -- /var/backups/restaurant-pos/restaurant-pos-<timestamp>.sql.gz
```

`restore-postgres.sh` refuses a `RESTORE_DATABASE_URL` equal to the live
`DATABASE_URL` and verifies gzip integrity before streaming to `psql`.

Spot-check restored row counts, for example:

```bash
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "Restaurant";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "Order";'
```

## 3. Baseline and apply the delta on staging

Point `DATABASE_URL` at staging, then:

```bash
export DATABASE_URL='postgresql://pos:pos@localhost:5432/restaurant_pos_staging?schema=public'

# Optional: regenerate/review the delta from the restored copy.
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/live-delta.sql

# Confirm it contains no DROP TABLE / DROP COLUMN / DELETE before applying.

npm run db:migrate:baseline
```

`db:migrate:baseline` will:

1. Refuse unless `LIVE_BASELINE_CONFIRMED=yes`.
2. Refuse if `_prisma_migrations` already exists.
3. Apply the reviewed delta with `ON_ERROR_STOP=1`.
4. Run `prisma migrate diff --exit-code`; any drift aborts before baselining.
5. Mark both checked-in migrations as applied with `prisma migrate resolve`.
6. Run `npm run db:migrate:check`.

Set the confirmation explicitly when ready:

```bash
LIVE_BASELINE_CONFIRMED=yes npm run db:migrate:baseline
```

If the drift check fails, stop. Restore staging from the backup again and
investigate; do not resolve migrations manually.

Verify the gate:

```bash
npm run db:migrate:status
npm run db:migrate:check    # exits 0 only when fully baselined
```

## 4. Run acceptance tests against staging

```bash
npm run db:seed
npm run test:unit
npm run test:acceptance
```

The seed creates the platform Super Admin/Support accounts required by the
acceptance suite. Only proceed when both suites pass.

## 5. Repeat on production in a maintenance window

1. Re-run `npm run db:backup` immediately before the change.
2. Point `DATABASE_URL` at production.
3. Run `npm run db:migrate:check`; it must fail with “not baselined” on the
   legacy database. If it passes, the database was already upgraded — stop.
4. Run `LIVE_BASELINE_CONFIRMED=yes npm run db:migrate:baseline`.
5. Run `npm run db:migrate:check` again; it must pass.
6. Start the backend and verify `/health` reports `dbConnected: true`.
7. Smoke-test login, an order, a payment, and one public website order.

If any step fails, stop and restore from the pre-change backup. Never use
`prisma migrate reset` or a destructive schema push on production.

## Regenerating the checked-in delta

If the old live schema differs from the ~20-model schema used here, regenerate
from an actual restored copy:

```bash
npx prisma migrate diff --from-url '<copy of live DB>' \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/live-baseline/20261118000000_live_schema_delta/migration.sql
```

Review the result, add the header comment, and re-test the whole staging flow
before changing production.
