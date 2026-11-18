# Live database baseline

This directory holds the one-off SQL migration used to upgrade a production
database that was created with `prisma db push` from the old (~20-model)
schema.

`20261118000000_live_schema_delta/migration.sql` is intentionally **not** in
`prisma/migrations/`. Fresh databases apply the full init migration there;
only legacy databases use this delta through
`npm run db:migrate:baseline`.

See `apps/backend/scripts/README-production-baseline.md` for the full staging
and production procedure.
