#!/usr/bin/env bash
# Restore a gzipped backup into a scratch database for verification.
# Never restores into the database referenced by DATABASE_URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  echo "Set RESTORE_DATABASE_URL to a scratch PostgreSQL database." >&2
  exit 1
fi

BACKUP_FILE="$1"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point to a scratch database}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

if [[ "$RESTORE_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "[restore] REFUSED: RESTORE_DATABASE_URL matches the live DATABASE_URL." >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[restore] Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if ! gzip -t "$BACKUP_FILE"; then
  echo "[restore] Backup file failed its gzip integrity check." >&2
  exit 1
fi

PSQL_BIN="${PSQL_BIN:-psql}"
RESTORE_URL="${RESTORE_DATABASE_URL%%\?*}"
if ! command -v "$PSQL_BIN" >/dev/null 2>&1; then
  echo "[restore] ERROR: $PSQL_BIN not found. Install the PostgreSQL client tools." >&2
  exit 1
fi

echo "[restore] Restoring into scratch database (credentials redacted)"
gunzip -c "$BACKUP_FILE" | "$PSQL_BIN" "$RESTORE_URL" \
  --no-password --set ON_ERROR_STOP=1 --quiet

echo "[restore] Restore completed successfully."
