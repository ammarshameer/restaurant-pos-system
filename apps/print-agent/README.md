# POS Print Agent

A web page can't send raw ESC/POS commands (including **auto-cut**) to a printer, so the POS posts
receipts to this small local service. It prints through the OS spooler, so it works with any
installed thermal printer on Windows, Linux and macOS.

```
cd apps/print-agent
node server.js          # Node 18+, no dependencies
```

| Variable       | Default        | Notes                                              |
| -------------- | -------------- | -------------------------------------------------- |
| `PRINTER_NAME` | system default | Exact OS printer name; see `GET /printers`         |
| `PRINT_COLS`   | `48`           | `48` for 80mm paper, `32` for 58mm                 |
| `CUT_MODE`     | `partial`      | `partial`, `full`, or `none` (printers w/o cutter) |
| `PORT`         | `3001`         | Frontend calls `http://127.0.0.1:3001`             |

- **Windows:** the printer is installed with its normal driver; data is sent as RAW via winspool.
- **Linux/macOS:** printer must be a CUPS queue; data is sent with `lp -o raw`.
- `BOTH` prints two tickets, each followed by feed + cut.
- If the agent isn't running, the POS falls back to the browser print dialog (no auto-cut).
