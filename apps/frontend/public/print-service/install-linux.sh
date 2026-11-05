#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="local-print-agent"
INSTALL_DIR="/opt/local-print-agent"
BIN_PATH="${INSTALL_DIR}/local-print-agent"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
AGENT_PORT=17778

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root, for example: sudo bash install-linux.sh" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "This installer requires systemd." >&2
  exit 1
fi

# A local binary path may be passed as $1 (for development builds).
LOCAL_BINARY="${1:-}"
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
      downloaded=1
      break
    fi
    echo "Download failed, trying next source..." >&2
  done
  if [[ "$downloaded" -ne 1 ]]; then
    echo "Could not download the print agent binary." >&2
    echo "Build it locally (go build in apps/print-agent) and rerun: sudo bash $0 /path/to/local-print-agent" >&2
    exit 1
  fi
  chmod 0755 "$BIN_PATH"
fi

SERVICE_USER="${SUDO_USER:-root}"
cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Local print bridge: lets apps send jobs to installed printers
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
SupplementaryGroups=lp
WorkingDirectory=${INSTALL_DIR}
Environment=PORT=${AGENT_PORT}
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
echo "Installed and started ${SERVICE_NAME}. It will start automatically with Linux."
