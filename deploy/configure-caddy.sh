#!/usr/bin/env bash
# Install the checked-in POS site block into the host Caddyfile.
# Idempotent: replaces the existing POS block (and its old comment header), then
# validates the resulting config before reloading Caddy.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/restaurant-pos}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
SITE_FILE="$APP_DIR/deploy/caddy-pos.gsmpilot.com.caddy"
CADDY_BIN="${CADDY_BIN:-caddy}"

if [[ ! -f "$CADDYFILE" ]]; then
  echo "[caddy] Caddyfile not found: $CADDYFILE" >&2
  exit 1
fi
if [[ ! -f "$SITE_FILE" ]]; then
  echo "[caddy] POS site config not found: $SITE_FILE" >&2
  exit 1
fi
if ! command -v "$CADDY_BIN" >/dev/null 2>&1; then
  echo "[caddy] caddy binary not found in PATH" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cp "$CADDYFILE" "$WORKDIR/Caddyfile"

python3 - "$WORKDIR/Caddyfile" "$SITE_FILE" <<'PY'
import re
import sys
from pathlib import Path

caddy_path, site_path = sys.argv[1:3]
text = Path(caddy_path).read_text()
site = Path(site_path).read_text()
if not site.endswith("\n"):
    site += "\n"

lines = text.splitlines(keepends=True)
start = None

# Prefer replacing the whole managed comment header plus site block.
for i, line in enumerate(lines):
    if "Restaurant POS (production hostname" in line:
        start = i
        break

# Fall back to the site block itself if the managed header is missing.
if start is None:
    for i, line in enumerate(lines):
        if re.match(r"^\s*pos\.gsmpilot\.com\s*\{", line):
            start = i
            break

if start is not None:
    site_start = start
    while site_start < len(lines) and not re.match(
        r"^\s*pos\.gsmpilot\.com\s*\{", lines[site_start]
    ):
        site_start += 1
    if site_start >= len(lines):
        raise SystemExit("[caddy] Found POS marker without a site block")

    depth = 0
    end = None
    for i in range(site_start, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if depth == 0:
            end = i + 1
            break
    if end is None:
        raise SystemExit("[caddy] Unbalanced braces in POS site block")

    new_lines = lines[:start] + [site] + lines[end:]
else:
    insert_at = next(
        (i for i, line in enumerate(lines) if re.match(r"^\s*:\d+\s*\{", line)),
        len(lines),
    )
    new_lines = lines[:insert_at] + [site] + lines[insert_at:]

Path(caddy_path).write_text("".join(new_lines))
PY

# cloudflare.env holds the DNS API token used by the TLS block. Load it only for
# validation; never print it.
if [[ -f /etc/caddy/cloudflare.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/caddy/cloudflare.env
  set +a
fi

echo "[caddy] Validating updated Caddyfile"
"$CADDY_BIN" validate --config "$WORKDIR/Caddyfile" --adapter caddyfile >/dev/null

BACKUP="${CADDYFILE}.bak-$(date +%Y%m%d%H%M%S)"
sudo cp -p "$CADDYFILE" "$BACKUP"
sudo cp "$WORKDIR/Caddyfile" "$CADDYFILE"
sudo systemctl reload caddy

echo "[caddy] POS site config installed; backup: $BACKUP"
