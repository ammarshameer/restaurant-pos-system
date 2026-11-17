# PostgreSQL backup & restore

Backups are **off-server** and **outside the app**: the scripts live in the repo but
dumps are written to `BACKUP_DIR` (default `/var/backups/restaurant-pos`) and copied
to an rclone/S3-compatible remote. The application has no in-app backup feature.

## Configuration

Set these in `apps/backend/.env` (or in the service environment):

| Variable | Default | Purpose |
|---|---|---|
| `BACKUP_DIR` | `/var/backups/restaurant-pos` | Local staging directory for dumps |
| `BACKUP_REMOTE` | (none) | rclone destination, e.g. `s3:pos-backups/restaurant-pos` |
| `BACKUP_RETENTION_DAYS` | `30` | Delete local/remote dumps older than this |
| `BACKUP_PREFIX` | `restaurant-pos` | Filename prefix |
| `PG_DUMP_BIN` | `pg_dump` | Path to the PostgreSQL client binary |
| `PSQL_BIN` | `psql` | Path to the PostgreSQL client binary |

Production must set `BACKUP_REMOTE`. The script warns and keeps the dump locally
when it is unset (useful for a first-run smoke test only).

## Nightly schedule

```cron
0 2 * * * cd /var/www/restaurant-pos/apps/backend && npm run db:backup >> /var/log/pos-backup.log 2>&1
```

Each run produces `restaurant-pos-YYYY-MM-DDTHH-MM-SSZ.sql.gz`, uploads it to the
remote, and prunes anything older than 30 days. Credentials are never logged.

## Monthly restore test (required)

A backup that has never been restored is not a backup. Run this against a **scratch**
database, never the live one:

```bash
# 1. Create an empty scratch database
createdb -U pos_user pos_restore_test

# 2. Restore the newest dump into it
cd /var/www/restaurant-pos/apps/backend
RESTORE_DATABASE_URL=postgresql://pos_user:PASSWORD@localhost:5432/pos_restore_test \
  npm run db:restore -- /var/backups/restaurant-pos/restaurant-pos-<timestamp>.sql.gz

# 3. Verify representative data
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "Restaurant";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "Order";'

# 4. Drop the scratch database
dropdb -U pos_user pos_restore_test
```

`restore-postgres.sh` refuses to run when `RESTORE_DATABASE_URL` equals the live
`DATABASE_URL`, and verifies the gzip integrity before streaming to `psql`.

Record the date, dump filename and result in the operations log. Investigate any
failure before the next scheduled backup runs.

## Platform-admin download

Super Admins can download a ZIP of the current local dumps from the Platform
Dashboard without SSH access. This uses the same `BACKUP_DIR` and requires the
platform JWT. The export contains only database dump files — no env files, no
application secrets.
