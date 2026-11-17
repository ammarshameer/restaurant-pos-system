#!/usr/bin/env bash
# Daily logical backup of the PostgreSQL database.
# Produces a gzipped SQL dump in BACKUP_DIR, optionally copies it to an
# off-server rclone destination, and prunes backups older than the retention
# window. Nothing is written inside the application directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/restaurant-pos}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-restaurant-pos}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"

# Prisma appends a `schema` query parameter; PostgreSQL client tools use the
# search_path instead and reject that parameter in the connection URI.
DUMP_URL="${DATABASE_URL%%\?*}"

if ! command -v "$PG_DUMP_BIN" >/dev/null 2>&1; then
  echo "[backup] ERROR: $PG_DUMP_BIN not found. Install the PostgreSQL client tools." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE_NAME="${BACKUP_PREFIX}-${STAMP}.sql.gz"
TARGET="$BACKUP_DIR/$FILE_NAME"

echo "[backup] Dumping database (credentials redacted) to $FILE_NAME"
"$PG_DUMP_BIN" "$DUMP_URL" --no-password --format=plain | gzip > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

# Copy to an off-server destination when configured. Backups must not live
# only on the application server.
if [[ -n "$BACKUP_REMOTE" ]]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[backup] ERROR: BACKUP_REMOTE is set but rclone is not installed." >&2
    exit 1
  fi
  echo "[backup] Uploading $FILE_NAME to off-server destination"
  rclone copyto "$TARGET" "${BACKUP_REMOTE%/}/$FILE_NAME"
  rclone delete "${BACKUP_REMOTE%/}" --min-age "${BACKUP_RETENTION_DAYS}d"
else
  echo "[backup] WARNING: BACKUP_REMOTE is not set; dump is local only." >&2
fi

# Prune local copies outside the retention window.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${BACKUP_PREFIX}-*.sql.gz" \
  -mtime "+${BACKUP_RETENTION_DAYS}" -delete

echo "[backup] Completed: $FILE_NAME (retention: ${BACKUP_RETENTION_DAYS} days)"
