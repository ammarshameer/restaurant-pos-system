# 🖥️ Server Handoff Document — Restaurant POS on Contabo VPS

**Prepared for:** Server/DevOps person
**Project:** Restaurant POS & Management System (multi-tenant SaaS, online only)
**Target server:** Contabo VPS (Ubuntu 22.04 / 24.04)
**Repo:** `https://github.com/dutchiono/restaurant-pos-system.git`

---

## 1. What This System Is

A full-stack, **online-only** restaurant POS:

- Cashiers and managers use a **web app** in the browser. An internet connection is required to sign in and to save data.
- Multiple restaurants (tenants) share one database, isolated by `restaurantId`.
- Realtime kitchen/order updates via **WebSockets (Socket.IO)**.
- Customers place orders through a tenant's public website; orders are handed off to the POS inbox and WhatsApp.
- When connectivity drops, the UI shows a blocking banner and retries idempotent writes. Nothing is saved locally for later sync.

---

## 2. Tech Stack (Languages & Components)

| Layer | Technology | Language |
|---|---|---|
| Frontend | React 18 + Vite 7 + Tailwind CSS + Redux Toolkit + React Query | TypeScript |
| Backend | Node.js 20 LTS + Express 4 + Socket.IO 4 + JWT + Zod | TypeScript (compiled to JS) |
| ORM | Prisma 5 (checked-in migrations, `prisma migrate deploy`) | TypeScript schema |
| Database | **PostgreSQL 16** (REQUIRED — not MySQL, not Mongo, not SQLite) | SQL |
| Process manager | PM2 | — |
| Web server / SSL | Nginx + Certbot (Let's Encrypt) | — |
| CI/CD | GitHub Actions (`.github/workflows/deploy.yml`) → SSH into the server | YAML |

### Database facts
- **PostgreSQL is the only database.** The Prisma schema provider is permanently `postgresql`.
- Prisma migrations are checked into `apps/backend/prisma/migrations/`; deploy with `npm run db:migrate` (`prisma migrate deploy`). Schema syncing commands are not used.
- Redis is optional: only needed if you run more than one backend instance and want shared socket state.
- Sentry (optional, recommended): set `SENTRY_DSN` to enable server-side error reporting. Set `SENTRY_FRONTEND_DSN` + `VITE_SENTRY_DSN` for browser errors.

---

## 3. Architecture to Set Up on the VPS

```
Internet
   │  HTTPS (443)
   ▼
┌─────────────────────────────────────────────┐
│  Contabo VPS (Ubuntu, 4 vCPU / 8 GB RAM)    │
│                                             │
│  Nginx ──► serves /var/www/restaurant-pos/  │
│   │        apps/frontend/dist  (static SPA) │
│   │                                         │
│   └── /api/* and /socket.io/* ──► proxy to  │
│           127.0.0.1:3000                    │
│           └── Node.js (PM2: restaurant-pos) │
│                └── Prisma ──► PostgreSQL    │
│                     localhost:5432          │
│                     db: restaurant_pos      │
│                └── daily backup ──► off-server storage
└─────────────────────────────────────────────┘
```

**Ports:**
- `80 / 443` → public (Nginx)
- `3000` → localhost only (Node backend)
- `5432` → localhost only (PostgreSQL)
- `22` → SSH

**Domain:** e.g. `pos.yourdomain.com` → A record → Contabo IP.

---

## 4. Server Setup Steps (in order)

### 4.1 Install software

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update && sudo apt install -y nodejs build-essential git nginx \
  postgresql postgresql-contrib certbot python3-certbot-nginx ufw

# PM2
sudo npm install -g pm2
```

### 4.2 Create PostgreSQL database

```bash
sudo -u postgres psql
```
```sql
CREATE USER pos_user WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE restaurant_pos OWNER pos_user;
GRANT ALL PRIVILEGES ON DATABASE restaurant_pos TO pos_user;
\q
```

### 4.3 Clone the project

```bash
sudo mkdir -p /var/www/restaurant-pos
sudo chown $USER:$USER /var/www/restaurant-pos
cd /var/www/restaurant-pos
git clone https://github.com/dutchiono/restaurant-pos-system.git .
```

### 4.4 Environment variables

**Create `/var/www/restaurant-pos/apps/backend/.env`:**

```ini
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://pos_user:REPLACE_WITH_STRONG_PASSWORD@localhost:5432/restaurant_pos
JWT_SECRET=GENERATE_96_CHAR_RANDOM_HEX_HERE
JWT_REFRESH_SECRET=GENERATE_ANOTHER_96_CHAR_RANDOM_HEX
JWT_PLATFORM_SECRET=GENERATE_A_THIRD_96_CHAR_RANDOM_HEX
FRONTEND_URL=https://pos.yourdomain.com
TURNSTILE_SECRET_KEY=your_cloudflare_turnstile_secret
# Optional but recommended
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
# Off-server backup destination (see section 7)
BACKUP_DIR=/var/backups/restaurant-pos
BACKUP_REMOTE=pos-backups:restaurant-pos
BACKUP_RETENTION_DAYS=30
```

> Generate secrets with: `openssl rand -hex 48`
> `FRONTEND_URL` must match the exact domain (used for CORS). Public orders are refused in production if `TURNSTILE_SECRET_KEY` is missing.

**Create `/var/www/restaurant-pos/apps/frontend/.env`:**

```ini
VITE_API_URL=https://pos.yourdomain.com/api
VITE_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
```

> ⚠️ Frontend env vars are baked in at **build time** — set them before `npm run build`.

### 4.5 Build and migrate

```bash
cd /var/www/restaurant-pos
npm run install:all

# Backend: generate client, compile TS, then apply checked-in migrations
cd apps/backend
npm run build
npm run db:migrate          # prisma migrate deploy

# Optional: load demo/seed data (never on a live tenant database)
# npx tsx prisma/seed.ts

# Frontend
cd ../frontend
npm run build
```

> ⚠️ Schema changes must go through a checked-in Prisma migration so every environment stays in sync.

### 4.6 Run backend with PM2

```bash
cd /var/www/restaurant-pos/apps/backend
pm2 start dist/index.js --name restaurant-pos
pm2 save
pm2 startup    # run the command it prints, for boot-time start
```

Check: `pm2 logs restaurant-pos` and `curl http://127.0.0.1:3000/health`
Expected: `{"status":"ok","mode":"postgresql","dbConnected":true,...}`

### 4.7 Nginx config

**`/etc/nginx/sites-available/restaurant-pos`:**

```nginx
server {
    listen 80;
    server_name pos.yourdomain.com;

    root /var/www/restaurant-pos/apps/frontend/dist;
    index index.html;

    # Static frontend (SPA)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # REST API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSockets (Socket.IO) — long timeouts required
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    client_max_body_size 15M;   # matches backend JSON limit
}
```

```bash
sudo ln -s /etc/nginx/sites-available/restaurant-pos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4.8 SSL

```bash
sudo certbot --nginx -d pos.yourdomain.com
# auto-renews via certbot timer; verify: sudo certbot renew --dry-run
```

### 4.9 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```
(Keeps 3000 and 5432 private to the server.)

---

## 5. CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` runs only after **Test (PostgreSQL)** completes successfully on the same commit (`workflow_run`, `main`). It checks out that exact tested SHA, SSHes into the server, installs, builds both apps, takes a database backup, verifies the migration baseline, applies migrations with `prisma migrate deploy`, and restarts PM2.

**Required GitHub repo secrets:**
- `SERVER_HOST` → Contabo IP
- `SERVER_USER` → SSH user
- `SERVER_SSH_KEY` → SSH private key

**Required GitHub repo variables** (or the same keys in a server env file referenced by `DEPLOY_ENV_FILE`):
- `NODE_BIN_DIR` → Node 20 bin directory, e.g. `/home/deploy/.nvm/versions/node/v20.20.2/bin`
- `PM2_BIN` → full path to `pm2`
- `HEALTH_PORT` → backend port (default `3000`; must match the server `.env`)
- `APP_DIR` → app checkout (default `/var/www/restaurant-pos`)

> **Branch protection:** require the **Test (PostgreSQL)** status check for `main`. The deploy workflow already waits for it, but the required check prevents a bypass via direct push or admin override.

The one-time production baseline for the old `db push` database must be completed with `apps/backend/scripts/README-production-baseline.md` before the first deploy; the deploy script aborts if `npm run db:migrate:check` reports an incomplete baseline.

---

## 6. Post-Deployment Verification

- [ ] `https://pos.yourdomain.com/health` returns `"status":"ok"`, `"dbConnected":true`, `"mode":"postgresql"`
- [ ] Frontend loads; login works (email/password and PIN)
- [ ] Create an order → kitchen display updates in realtime (WebSocket)
- [ ] Settle a cash payment; receipt/changes calculate correctly
- [ ] Public website menu loads; a test order appears in the Online Orders inbox and can be accepted atomically
- [ ] With the browser offline, a banner appears and save buttons are disabled; no data is queued locally
- [ ] `pm2 logs restaurant-pos` shows PII-free `[HTTP]` request logs, no errors
- [ ] `sudo systemctl status nginx` active
- [ ] SSL auto-renewal dry-run passes
- [ ] Backup + restore test completed (section 7)

---

## 7. Backups & Restore (off-server, 30-day retention)

Backups are **not** stored inside the app and there is no in-app backup button/feature.
The backup scripts live in `apps/backend/scripts/`:

```bash
cd /var/www/restaurant-pos/apps/backend

# Nightly cron — dumps, gzip-encrypts, uploads to BACKUP_REMOTE, prunes older than 30 days
0 2 * * * cd /var/www/restaurant-pos/apps/backend && ./scripts/backup-postgres.sh >> /var/log/pos-backup.log 2>&1

# Restore test (run monthly against a scratch database, not production)
./scripts/restore-postgres.sh /var/backups/restaurant-pos/backup-YYYY-MM-DD.sql.gz
```

- `BACKUP_RETENTION_DAYS` defaults to **30**.
- `BACKUP_REMOTE` is an rclone/S3-compatible destination (e.g. `s3:pos-backups/restaurant-pos`); leave it unset to keep local dumps only during initial setup, but production must copy off-server.
- Platform Super Admins can also download a ZIP of the latest backups from the Platform Dashboard (**Backups → Download ZIP**) without SSH access.
- Restore test procedure and checklist: `apps/backend/scripts/README-backup.md`.

---

## 8. Security Checklist

- [ ] Strong random `JWT_SECRET` / `JWT_REFRESH_SECRET` / `JWT_PLATFORM_SECRET` (32+ chars, all different)
- [ ] `.env` files are NOT committed to git and readable only by the app user (`chmod 600`)
- [ ] PostgreSQL and port 3000 NOT exposed publicly (UFW)
- [ ] HTTPS only; HTTP → HTTPS redirect (Certbot does this)
- [ ] SSH key auth + disable password login recommended
- [ ] Fail2ban installed (`sudo apt install fail2ban`)
- [ ] `NODE_ENV=production` set and `TURNSTILE_SECRET_KEY` configured
- [ ] `SENTRY_DSN` set; request logs verified free of emails, phones, tokens and card data

---

## 9. Quick Reference

| Item | Value |
|---|---|
| App directory | `/var/www/restaurant-pos` |
| Backend entry | `apps/backend/dist/index.js` (PM2 name: `restaurant-pos`) |
| Frontend build | `apps/frontend/dist` |
| Backend env | `apps/backend/.env` |
| DB | PostgreSQL `restaurant_pos`, user `pos_user`, localhost:5432 |
| Health check | `GET /health` or `GET /api/health` |
| Apply schema | `cd apps/backend && npm run db:migrate` |
| Rebuild after deploy | `npm run install:all && cd apps/backend && npm run build && npm run db:migrate && cd ../frontend && npm run build` |
| Restart backend | `pm2 restart restaurant-pos` |
| Backups | `apps/backend/scripts/backup-postgres.sh` (30-day, off-server) |
| Logs | `pm2 logs restaurant-pos` |

---

*Generated for handoff — full project docs: `README.md`, `DEPLOYMENT.md`, `API.md`, `MULTI_TENANT_GUIDE.md`.*
