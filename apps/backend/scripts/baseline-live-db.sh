#!/usr/bin/env bash
# Apply the reviewed one-off delta migration to a legacy db-push database,
# verify there is no schema drift, then mark the normal Prisma migrations as
# applied. Never point this at production until the same steps have succeeded
# on a restored copy in staging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

ENV_FILE="${ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set}"
if [[ "${LIVE_BASELINE_CONFIRMED:-}" != "yes" ]]; then
  echo "[baseline] REFUSED: set LIVE_BASELINE_CONFIRMED=yes after backing up and verifying a staging copy." >&2
  exit 1
fi

PSQL_BIN="${PSQL_BIN:-psql}"
if ! command -v "$PSQL_BIN" >/dev/null 2>&1; then
  echo "[baseline] ERROR: $PSQL_BIN not found. Install the PostgreSQL client tools or set PSQL_BIN." >&2
  exit 1
fi

# Prisma accepts ?schema=public; PostgreSQL client tools do not.
PSQL_URL="${DATABASE_URL%%\?*}"
BASELINE_SQL="$SCRIPT_DIR/../prisma/live-baseline/20261118000000_live_schema_delta/migration.sql"

# Refuse to run against a database that already has a migration history.
HAS_HISTORY="$("$PSQL_BIN" "$PSQL_URL" -Atqc "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")"
if [[ "$HAS_HISTORY" == "t" ]]; then
  echo "[baseline] REFUSED: _prisma_migrations already exists. Use 'npm run db:migrate:status' instead." >&2
  exit 1
fi

echo "[baseline] Applying reviewed live-schema delta (credentials redacted)"
"$PSQL_BIN" "$PSQL_URL" -v ON_ERROR_STOP=1 -q -f "$BASELINE_SQL"

echo "[baseline] Verifying resulting schema matches prisma/schema.prisma"
set +e
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
DIFF_CODE=$?
set -e
if [[ $DIFF_CODE -ne 0 ]]; then
  echo "[baseline] FAIL: schema drift remains; migrations were NOT marked as applied." >&2
  exit 1
fi

echo "[baseline] Marking checked-in migrations as applied"
for migration in "$SCRIPT_DIR"/../prisma/migrations/*_*/migration.sql; do
  name="$(basename "$(dirname "$migration")")"
  npx prisma migrate resolve --applied "$name"
done

bash "$SCRIPT_DIR/check-migration-baseline.sh"
echo "[baseline] Completed successfully."
