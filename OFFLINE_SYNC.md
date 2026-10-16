# Offline-First Sync

The POS now works **online-first with an offline fallback**. When the internet
is available it talks to the backend normally. When the connection drops, you
can keep taking orders and editing invoices — everything is saved to a local
database (IndexedDB) on the device and automatically pushed to the server once
the connection returns. Nothing is lost and nothing is duplicated.

---

## How it behaves

| State | What happens |
| --- | --- |
| **Online** | Orders/invoices are saved to the server immediately, exactly like before. Menu, deals and orders are cached locally in the background. |
| **Offline** | New orders, payment updates, and void/cancel actions are written to a local **outbox** in IndexedDB. The POS UI keeps working. The order list shows cached/local data. |
| **Back online** | The sync engine replays the outbox to the server automatically (also on window focus, on a 20s timer, and via the **Sync now** button). |

The top bar shows live status:

- 🟢 **Online • Synced** – connected, nothing waiting.
- 🟠 **Offline • N queued** – working offline, N actions waiting to sync.
- 🔵 **Syncing…** – actively pushing queued actions.
- **🔄 Sync now** – appears when there is anything queued (or failed).

Invoices that are stored locally but not yet synced show a **⏳ Pending sync**
badge in the *Sale Invoices* list.

---

## What can be done offline

- Create / send orders (Dine In, Take Away, Delivery) and cash-paid orders.
- Update invoice details and items (Sale Invoices → Edit).
- Update payment status (Cash Register).
- Void / delete invoices.
- Update order/KDS status.
- Browse the last cached menu and deals (so the POS grid is usable).

---

## Architecture

### Frontend

```
apps/frontend/src/lib/offline/
  id.ts           – UUID helper (idempotency keys)
  db.ts           – Dexie (IndexedDB) database: outbox, orders cache, key/value cache
  network.ts      – connectivity monitor + isNetworkError()
  syncEngine.ts   – the queue + sync engine
apps/frontend/src/hooks/useSyncStatus.ts        – React hook for live status
apps/frontend/src/components/SyncStatusIndicator.tsx – top-bar badge
```

- **Outbox** – every mutation that fails offline is queued as an operation
  (`CREATE_ORDER`, `UPDATE_ORDER`, `UPDATE_PAYMENT_STATUS`, `CANCEL_ORDER`,
  `DELETE_ORDER`) with an ordering sequence and a stable `opId`.
- **Orders cache** – a local mirror of orders so the UI can render and edit
  while offline.
- **KV cache** – menu and active deals, refreshed on every successful fetch.

Every order gets a client-generated UUID (`crypto.randomUUID`) used as both the
local id and the server id. This is the key that makes syncing idempotent.

### Backend

```
apps/backend/src/services/sync.service.ts   – applies queued operations idempotently
apps/backend/src/routes/sync.routes.ts      – POST /api/sync/push
```

`POST /api/sync/push` accepts `{ operations: [...] }` and returns one result per
operation. It reuses the existing `OrderService`, so all the normal validation,
inventory deduction and websocket broadcasts still happen on the server.

---

## Idempotency & conflict handling

- **No duplicates.** `OrderService.createOrder` first looks for an order with
  the same `clientId` (or client-supplied `id`). If it exists, it returns the
  existing record instead of inserting a new one. Replaying a batch after a
  dropped connection is therefore safe, and inventory is not deducted twice.
- **Server picks the final order number.** The POS generates a friendly local
  number for the printed receipt. If two terminals ever produce the same
  number, the server reassigns the next available number and the client is
  updated with the authoritative value.
- **Ordering.** The outbox is replayed in creation order, so an order is always
  created before its later edits/payment updates.
- **Retries.** Failed operations are retried automatically up to 10 times;
  after that they are marked `FAILED` and can be retried with **Sync now**.

---

## Database change

Two nullable, indexed columns were added:

- `Order.clientId`
- `Payment.clientId`

The change is additive (no data loss). Apply it with:

```bash
cd apps/backend
npx prisma db push --skip-generate
```

This is now part of the deploy scripts (`deploy.yml` and `render.yaml`) so the
online PostgreSQL database stays in sync automatically.

---

## How to test locally

1. Start the backend and frontend as usual.
2. Open the POS, add items, and create an order — it is saved to the server.
3. Turn off your network (dev tools → *Network → Offline*, or disconnect).
4. Create more orders / mark invoices paid. The status badge shows
   “Offline • N queued” and invoices show “⏳ Pending sync”.
5. Turn the network back on. The badge shows “Syncing…”, then “Online • Synced”,
   and the invoices are now on the server with no duplicates.

You can also queue several orders offline, reload the page (the outbox is
persisted in IndexedDB), and confirm they still sync when the connection
returns.

---

## App shell (the POS loads while offline)

The frontend registers a service worker (`apps/frontend/public/sw.js`) that
precaches the built app shell (`index.html` + its JS/CSS assets) on first load.
This means that once a terminal has opened the POS online at least once, the
app **cold-boots without internet** — no more browser “no connection” page.
Only static assets are cached; `/api`, `/socket.io` and `/health` are never
intercepted so the sync engine still sees real network failures.

Registration is production-only and silently skipped where unsupported
(Electron `file://`, insecure contexts).

---

## Session resilience

Turning off the internet should not log staff out. Two mechanisms help:

- **Silent token refresh** (`apps/frontend/src/lib/api.ts`): the refresh token
  returned by `/auth/login` and `/auth/pin-login` is now persisted. When a
  request gets a `401`, the client exchanges the refresh token for a new access
  token (single-flight, then replays the original request). If the refresh
  fails because the device is offline, the session and the queued outbox are
  preserved; only a genuinely invalid refresh token triggers a re-login.
- **Offline login** (`apps/frontend/src/lib/offline/authCache.ts`): after a
  successful online login, a salted **PBKDF2** verifier (never the raw
  password/PIN) is stored in IndexedDB. If the device is offline and the user
  signs in with credentials verified on this device before, they are let in and
  the POS keeps working. A device that has never gone online can't be unlocked
  offline — that is intentional.

---

## Housekeeping

Fully-synced orders older than 90 days are periodically pruned from the local
IndexedDB cache (pending/failed orders are never touched) so terminals that
run for months don't accumulate storage. Retries use exponential backoff (up
to 5 minutes) after repeated failures, and the top-bar badge now surfaces the
last sync error in its tooltip.

