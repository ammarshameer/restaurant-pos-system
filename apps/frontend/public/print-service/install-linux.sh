#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="local-print-agent"
INSTALL_DIR="/opt/local-print-agent"
BIN_PATH="${INSTALL_DIR}/local-print-agent"
CONFIG_PATH="${INSTALL_DIR}/print-agent-config.json"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
AGENT_PORT=17778

# A local binary path may be passed as $1 (for development builds).
LOCAL_BINARY="${1:-}"
# Exact browser origins, comma-separated. May also be passed as $2.
ALLOWED_ORIGINS="${2:-${PRINT_AGENT_ALLOWED_ORIGINS:-https://pos.gsmpilot.com}}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root, for example: sudo bash install-linux.sh" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "This installer requires systemd." >&2
  exit 1
fi

IFS=',' read -r -a ORIGIN_PARTS <<< "$ALLOWED_ORIGINS"
ORIGINS_JSON=""
for raw in "${ORIGIN_PARTS[@]}"; do
  origin="$(printf '%s' "$raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [[ -z "$origin" ]] && continue
  escaped="${origin//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  ORIGINS_JSON+="\"${escaped}\","
done
ORIGINS_JSON="${ORIGINS_JSON%,}"
if [[ -z "$ORIGINS_JSON" ]]; then
  echo "At least one allowed POS origin is required." >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) AGENT_ARCH="amd64" ;;
  aarch64|arm64) AGENT_ARCH="arm64" ;;
  *)
    echo "Unsupported CPU architecture: $ARCH" >&2
    exit 1
    ;;
esac

BIN_URLS=()
if [[ -n "${PRINT_AGENT_BINARY_URL:-}" ]]; then
  BIN_URLS+=("$PRINT_AGENT_BINARY_URL")
fi
BIN_URLS+=(
  "https://github.com/ammarshameer/restaurant-pos-system/releases/download/agent-latest/local-print-agent-linux-${AGENT_ARCH}"
  "https://github.com/ammarshameer/restaurant-pos-system/releases/latest/download/local-print-agent-linux-${AGENT_ARCH}"
)

if systemctl is-active --quiet "$SERVICE_NAME"; then
  systemctl stop "$SERVICE_NAME"
fi
# If the port is held by a manually-run copy of this agent, stop it; a foreign
# process on the port is a real conflict and must be resolved first.
if ss -H -ltn "sport = :${AGENT_PORT}" 2>/dev/null | grep -q .; then
  holder="$(ss -H -ltnp "sport = :${AGENT_PORT}" 2>/dev/null || true)"
  if echo "$holder" | grep -q "local-print-agent"; then
    echo "Stopping the currently running print agent..."
    pkill -f "local-print-agent" 2>/dev/null || true
    sleep 1
  fi
  if ss -H -ltn "sport = :${AGENT_PORT}" 2>/dev/null | grep -q .; then
    echo "Port ${AGENT_PORT} is already in use by another process. Stop it before installing." >&2
    exit 1
  fi
fi

mkdir -p "$INSTALL_DIR"
if [[ -n "$LOCAL_BINARY" ]]; then
  if [[ ! -f "$LOCAL_BINARY" ]]; then
    echo "Binary not found: $LOCAL_BINARY" >&2
    exit 1
  fi
  install -m 0755 "$LOCAL_BINARY" "$BIN_PATH"
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download the print agent." >&2
    exit 1
  fi
  downloaded=0
  for url in "${BIN_URLS[@]}"; do
    echo "Downloading $url"
    if curl --fail --silent --show-error --location "$url" --output "$BIN_PATH"; then
      echo "Verifying SHA-256 checksum..."
      if ! checksum_text="$(curl --fail --silent --show-error --location "${url}.sha256")"; then
        echo "Checksum verification failed: ${url}.sha256 is missing." >&2
        exit 1
      fi
      expected="$(printf '%s' "$checksum_text" | awk '{print $1}' | tr 'A-Z' 'a-z')"
      if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]]; then
        echo "Invalid checksum published at ${url}.sha256" >&2
        exit 1
      fi
      actual="$(sha256sum "$BIN_PATH" | awk '{print $1}')"
      if [[ "$actual" != "$expected" ]]; then
        echo "SHA-256 mismatch. Published: $expected Downloaded: $actual" >&2
        exit 1
      fi
      downloaded=1
      break
    fi
    echo "Download failed, trying next source..." >&2
  done
  if [[ "$downloaded" -ne 1 ]]; then
    echo "Could not download a verified print agent binary." >&2
    echo "Build it locally (go build in apps/print-agent) and rerun: sudo bash $0 /path/to/local-print-agent" >&2
    exit 1
  fi
  chmod 0755 "$BIN_PATH"
fi

# Generate a fresh random token on every install. Shown once at the end.
if command -v openssl >/dev/null 2>&1; then
  TOKEN="$(openssl rand -hex 32)"
else
  TOKEN="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
fi

cat >"$CONFIG_PATH" <<EOF
{
  "port": ${AGENT_PORT},
  "printerName": "",
  "token": "${TOKEN}",
  "allowedOrigins": [${ORIGINS_JSON}]
}
EOF

# Run as the installing user (not root when invoked with sudo), never as a
# system-wide privileged account. The service user alone can read the token.
SERVICE_USER="${SUDO_USER:-root}"
chown "$SERVICE_USER" "$CONFIG_PATH"
chmod 0600 "$CONFIG_PATH"

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Local print bridge: lets apps send jobs to installed printers
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
SupplementaryGroups=lp
WorkingDirectory=${INSTALL_DIR}
ExecStart=${BIN_PATH}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true

echo "Installed and started ${SERVICE_NAME}. It runs as ${SERVICE_USER}."
echo '======================================================================'
echo 'COPY THIS TOKEN INTO POS SETTINGS > LOCAL PRINT SERVICE (SHOWN ONCE):'
echo "$TOKEN"
echo '======================================================================'
echo 'Allowed browser origins:'
echo "$ALLOWED_ORIGINS" | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
