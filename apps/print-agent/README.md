# Local Print Agent

A generic loopback print bridge, shipped as a **single static binary** — no
runtime, no dependencies, ~8 MB. Browsers and other apps cannot talk to OS
printers directly, so this service listens on `127.0.0.1` and spools raw bytes
through the OS print system. It is **not bound to any app, website, or port** —
install it once on a machine and any number of clients can use it.

Windows, Linux and macOS supported (amd64 + arm64).

## API (http://127.0.0.1:PORT)

| Method | Path        | Body / Result |
| ------ | ----------- | ------------- |
| `GET`  | `/health`   | `{success, app: "local-print-agent", version, port}` — use `app` to detect the right service on a port |
| `GET`  | `/printers` | `{success, printers: [{name, default}]}` — all installed OS printers |
| `POST` | `/print`    | `{printer, dataBase64 \| dataHex \| text}` → sends raw bytes verbatim — ESC/POS, ZPL, TSPL, any printer language |

`printer` selects any installed printer by name; omit it to use the system
default. The receipt layout is **not** built here — clients generate their own
bytes (the POS web app builds ESC/POS in TypeScript, or prints the same bytes
directly over WebUSB). That is what makes the bridge reusable for anything:
kitchen tickets, labels, another backend, a CLI script — whatever can HTTP POST
to localhost.

## Run it

```sh
# From source (Go 1.22+):
cd apps/print-agent
go build -o local-print-agent .
./local-print-agent

# Or grab a prebuilt binary from GitHub Releases (tag: agent-latest).
```

Cross-compile for a till machine without a Go install:

```sh
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o local-print-agent.exe .
```

## Configuration

All settings are optional. Environment variables, or a
`print-agent-config.json` next to the binary:

```json
{ "port": 17778, "printerName": "POS-80", "token": "secret",
  "allowedOrigins": ["https://example.com"] }
```

| Variable                | Default        | Notes |
| ----------------------- | -------------- | ----- |
| `PORT`                  | `17778`        | Any free port; clients just need the matching URL |
| `PRINTER_NAME`          | system default | Fallback when the caller sends no printer |
| `PRINT_TOKEN`           | none (open)    | If set, `POST /print` requires `X-Print-Token: <token>` |
| `PRINT_ALLOWED_ORIGINS` | none (open)    | Optional comma-separated browser-origin allowlist |

## Install as a service

The receipt modal on the POS site offers one-shot installers that download the
binary from GitHub Releases and register an auto-start service:

- **Windows:** run `install-windows.ps1` in an elevated PowerShell window
  (registers via `sc.exe`, no other tooling needed). For a local build:
  `.\install-windows.ps1 -BinaryPath .\local-print-agent.exe`
- **Linux:** `sudo bash install-linux.sh` (systemd + CUPS). For a local build:
  `sudo bash install-linux.sh /path/to/local-print-agent`
- **macOS:** download the binary, `chmod +x`, run it (or wrap it in a launchd
  plist).

To remove: Windows Services → "Local Print Agent", or
`sudo systemctl disable --now local-print-agent` on Linux.

## Notes

- The service only listens on `127.0.0.1` — it is never reachable from the LAN.
- **Windows:** printers go through the normal driver; data is sent as RAW via
  winspool. **Linux/macOS:** the printer must be a CUPS queue; data is sent
  with `lp -o raw`.
- The service runs as the installing user — on Linux it is added to the `lp`
  group for printer access.
- CORS is open by default so any of your apps/sites can call the bridge. On a
  machine used for untrusted browsing, set `PRINT_ALLOWED_ORIGINS` or
  `PRINT_TOKEN`.
