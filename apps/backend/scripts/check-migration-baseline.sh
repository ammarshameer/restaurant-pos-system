#!/usr/bin/env bash
# Fail unless the target database has a complete Prisma migration history.
# Used as a deploy preflight so a db-push-created database cannot silently run
# `migrate deploy` from the beginning.
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

STATUS_FILE="$(mktemp)"
trap 'rm -f "$STATUS_FILE"' EXIT

set +e
npx prisma migrate status >"$STATUS_FILE" 2>&1
STATUS_CODE=$?
set -e

cat "$STATUS_FILE"

if [[ $STATUS_CODE -ne 0 ]] || grep -q 'not yet been applied' "$STATUS_FILE"; then
  echo "[baseline] FAIL: database is not baselined. Run scripts/baseline-live-db.sh on a verified copy first." >&2
  exit 1
fi

echo "[baseline] OK: all Prisma migrations are applied."
