# Restaurant POS Print Helper

A small Windows tray application that lets the hosted POS at
**https://pos.gsmpilot.com** print receipts directly to an installed printer in
**RAW ESC/POS** mode. It removes the extra blank slip, controls the paper cut,
and can open the cash drawer.

The offline Electron POS uses the same printing code through IPC, so receipts
behave identically in both builds.

---

## Why is there a localhost service?

A web page cannot talk to the Windows print spooler or a printer driver. The
browser only exposes `window.print()`, which renders the page through the
driver and cannot send RAW control bytes (cut, feed, drawer, code page).

The helper is a bridge:

```
POS website (https://pos.gsmpilot.com)
        │  fetch → http://127.0.0.1:17777  (JSON receipt)
        ▼
Print helper (Electron tray app)
        │  winspool.drv → WritePrinter(..., "RAW")
        ▼
Windows print spooler → printer driver → USB thermal printer
```

- **No helper running?** The POS automatically falls back to normal browser
  printing. That works with any installed printer, but the browser cannot issue
  ESC/POS cut or drawer commands.
- **Helper running?** The POS detects it, sends the receipt as JSON, and the
  helper prints only the receipt with one partial cut per slip.

Nothing is sent to the internet. The helper listens on loopback only.

---

## Security

| Control | Value |
| --- | --- |
| Bind address | `127.0.0.1` only |
| Port | `17777` |
| Allowed origin | `https://pos.gsmpilot.com` (exact match) |
| Token header | `X-Print-Token` |
| Default token | `rpos-print-2026-9f4c7b1e` |
| Host header check | `127.0.0.1:17777` / `localhost:17777` only |

- Any other `Origin` is rejected with **403**.
- A missing or wrong token is rejected with **401**.
- CORS preflight (`OPTIONS`) returns **204** with
  `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers:
  Content-Type, X-Print-Token` and
  `Access-Control-Allow-Private-Network: true` so Chromium allows a public
  HTTPS page to call a loopback service.
- There are no wildcards and localhost origins are not allowed.

The token can be changed in the helper settings. If you change it, set the same
value for the POS build (`VITE_PRINT_HELPER_TOKEN`) or in the browser's
`localStorage` keys `pos.printHelper.token` / `pos.printHelper.url`.

---

## API

All routes require the `Origin` and `X-Print-Token` headers.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Helper status and configured printer |
| `GET` | `/printers` | Installed Windows printer names |
| `POST` | `/print` | Print a receipt (`{ receipt, mode, openDrawer, printerName }`) |
| `POST` | `/test-print` | Print a small test receipt |

`mode` is `BOTH`, `CUSTOMER`, or `KITCHEN`. `BOTH` prints the customer slip
then the kitchen slip, each ending with its own partial cut.
`printerName` is optional and lets the receipt modal select an installed printer
for an individual print; without it, the configured printer is used.

---

## Build and install (Windows)

Run these commands on Windows from the repository root:

```bash
npm install
npm run dist:print-helper
```

The installer is written to `release/print-helper/`. Install it, then:

1. Start **Restaurant POS Print Helper** from the Start menu.
2. Pick your printer in the settings window (or type its exact Windows name).
3. Set characters per line: **48** for an 80 mm roll, **32** for 58 mm.
4. Click **Save settings**, then **Test print**.
5. Leave the app running in the notification area.

The settings window opens automatically on first launch when no printer is
configured. Closing the window does not quit the helper; use the tray menu →
**Quit** to stop it.

### Any installed printer

The helper prints to whatever printer name is selected. It does not require the
Black Copper BC-88AC specifically. A printer that understands ESC/POS
(most 58 mm / 80 mm thermal receipt printers) produces the best result because
cut/feed/drawer commands are honoured. For a printer without ESC/POS support,
the POS falls back to normal browser printing.

### Recommended Windows printer settings

In **Settings → Bluetooth & devices → Printers & scanners → [printer] →
Printing preferences**:

- Paper size: **80 mm Receipt/Roll** (or the roll size you use)
- Margins: **None**
- Disable any "fit to page" or A4 scaling option

The helper sends RAW bytes, so these settings mostly affect the fallback browser
path and the driver's own cut behaviour.

---

## Run from source (development)

```bash
npm run print-helper:start
```

This launches the tray app with the same code that ships in the installer.

Run the cross-platform self-test:

```bash
npm run test:print-helper
```

The self-test validates the ESC/POS byte stream, one cut per slip, the cash
drawer command, CORS/preflight handling, origin rejection, token rejection and
Host header rejection. Windows spooler calls are mocked because the test runs on
Linux too.

---

## Manual verification checklist (Windows 10 + real printer)

Automated checks cannot cover the physical printer. On the POS machine:

- [ ] Helper starts and shows **Ready to print** with the correct printer.
- [ ] **Test print** produces one short receipt and one cut, no blank slip.
- [ ] POS shows **Direct printer ready** in the receipt dialog.
- [ ] **Print Both Slips** produces exactly two slips and two cuts, no blank page.
- [ ] **Customer** and **Kitchen** buttons each produce one slip.
- [ ] Cash drawer opens when the option is enabled and the drawer is connected.
- [ ] Closing the helper makes the POS fall back to the browser print dialog.
- [ ] Starting the helper again restores direct printing after **Refresh**.

---

## Troubleshooting

**The POS still opens the browser print dialog.**
The helper is not running, or the origin/token does not match. Check the tray
icon, open settings, and confirm the printer is selected. Then press **Refresh**
in the POS receipt dialog.

**`403 Origin not allowed`.**
The page origin is not exactly `https://pos.gsmpilot.com`. Preview deployments
and `http://localhost` are intentionally rejected.

**`401 Invalid or missing print token`.**
The token in the helper settings differs from the token the POS uses.

**`OpenPrinter failed`.**
The printer name does not match Windows exactly. Use **Refresh** and pick it
from the list.

**Port 17777 already in use.**
Another copy of the helper is running. Quit it from the tray, then start the
helper again.

**Browser blocks the loopback request.**
Chromium requires the Private Network Access preflight. The helper answers it;
make sure you are on a current Chrome/Edge build and that no extension is
blocking requests to `127.0.0.1`.
