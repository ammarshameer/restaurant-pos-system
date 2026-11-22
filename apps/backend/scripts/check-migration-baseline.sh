#!/usr/bin/env bash
# Fail unless the target database has a complete Prisma migration baseline.
# Used as a deploy preflight so a db-push-created database cannot silently run
# `migrate deploy` from the beginning. Newer pending migrations are allowed;
# they are applied by the deploy step immediately after this check.
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
PSQL_BIN="${PSQL_BIN:-psql}"
DB_URL="${DATABASE_URL%%\?*}"

echo "[baseline] Checking migration history (credentials redacted)"

HAS_HISTORY="$("$PSQL_BIN" "$DB_URL" -Atqc "select to_regclass('public._prisma_migrations') is not null")"
if [[ "$HAS_HISTORY" != "t" ]]; then
  echo "[baseline] FAIL: no _prisma_migrations history found. Run scripts/baseline-live-db.sh on a verified copy first." >&2
  exit 1
fi

BASELINE_COUNT="$("$PSQL_BIN" "$DB_URL" -Atqc \
  "select count(*) from \"_prisma_migrations\" where \"migration_name\" in ('20261117111351_init','20261117112000_remove_legacy_local_data','20261119120000_add_audit_log') and \"finished_at\" is not null")"
if [[ "$BASELINE_COUNT" != "3" ]]; then
  echo "[baseline] FAIL: baseline migrations are incomplete (found $BASELINE_COUNT/3). Do not deploy." >&2
  exit 1
fi

STATUS_FILE="$(mktemp)"
trap 'rm -f "$STATUS_FILE"' EXIT

set +e
npx prisma migrate status >"$STATUS_FILE" 2>&1
STATUS_CODE=$?
set -e

cat "$STATUS_FILE"

# Drift or modified migrations are never safe to auto-apply.
if grep -qiE 'was applied after|modified|drift|not found' "$STATUS_FILE"; then
  echo "[baseline] FAIL: Prisma reported migration drift. Do not deploy." >&2
  exit 1
fi

# A non-zero status is acceptable only when it is just newer migrations waiting
# to be applied by `prisma migrate deploy` in this deploy run.
if [[ $STATUS_CODE -ne 0 ]] && ! grep -q 'not yet been applied' "$STATUS_FILE"; then
  echo "[baseline] FAIL: database is not baselined. Run scripts/baseline-live-db.sh on a verified copy first." >&2
  exit 1
fi

echo "[baseline] OK: complete migration baseline present (pending migrations will be applied by deploy)."
