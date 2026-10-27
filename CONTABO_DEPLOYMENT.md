# 🖥️ Server Handoff Document — Restaurant POS on Contabo VPS

**Prepared for:** Server/DevOps person
**Project:** Restaurant POS & Management System (multi-tenant SaaS)
**Target server:** Contabo VPS (Ubuntu 22.04 / 24.04)
**Repo:** `https://github.com/dutchiono/restaurant-pos-system.git`

---

## 1. What This System Is

A full-stack restaurant POS with **two deployment modes**. We are deploying the **online / multi-tenant mode**:

- Cashiers and managers use a **web app** in the browser.
- Multiple restaurants (tenants) share one database, isolated by `restaurantId`.
- Realtime kitchen/order updates via **WebSockets (Socket.IO)**.
- The app has an offline-sync layer (IndexedDB) that auto-flushes to the API when back online.

---

## 2. Tech Stack (Languages & Components)

| Layer | Technology | Language |
|---|---|---|
| Frontend | React 18 + Vite 7 + Tailwind CSS + Redux Toolkit + React Query | TypeScript |
| Backend | Node.js 20 LTS + Express 4 + Socket.IO 4 + JWT + Zod | TypeScript (compiled to JS) |
| ORM | Prisma 5 | TypeScript schema |
| Database | **PostgreSQL 16** (REQUIRED — not MySQL, not Mongo) | SQL |
| Offline cache | Dexie / IndexedDB (browser-side only) | TypeScript |
| Process manager | PM2 | — |
| Web server / SSL | Nginx + Certbot (Let's Encrypt) | — |
| CI/CD | GitHub Actions (`deploy.yml`) → SSH into the server | YAML |

### Database facts
- **PostgreSQL is the only database needed on the server.**
- SQLite exists **only** for the Electron desktop build — do NOT install it on the server.
- **Redis is NOT needed** (it's an unused dependency in package.json).
- Prisma auto-switches provider to `postgresql` when `DATABASE_URL` starts with `postgres://`.

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
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://pos_user:REPLACE_WITH_STRONG_PASSWORD@localhost:5432/restaurant_pos
JWT_SECRET=GENERATE_96_CHAR_RANDOM_HEX_HERE
JWT_REFRESH_SECRET=GENERATE_ANOTHER_96_CHAR_RANDOM_HEX
FRONTEND_URL=https://dimlight-cafe.vercel.app
```

> Generate secrets with: `openssl rand -hex 48`
> `FRONTEND_URL` must match the exact domain (used for CORS).

**Create `/var/www/restaurant-pos/apps/frontend/.env`:**

```ini
VITE_API_URL=https://pos.gsmpilot.com/api
```

> ⚠️ The frontend env var is baked in at **build time** — it must be set before `npm run build`.

### 4.5 Build

```bash
# Backend (switches Prisma to PostgreSQL, generates client, compiles TS)
cd /var/www/restaurant-pos/apps/backend
npm install
DATABASE_PROVIDER=postgresql npm run build:postgres

# Create database schema
npx prisma db push --skip-generate

# Optional: load demo/seed data
npx tsx prisma/seed.ts

# Frontend
cd /var/www/restaurant-pos/apps/frontend
npm install
VITE_API_URL=https://pos.gsmpilot.com/api npm run build
```

> ⚠️ **Important:** there is NO `prisma/migrations/` folder in the repo, so
> `prisma migrate deploy` will fail/do nothing. **Use `prisma db push`** as shown above.

### 4.6 Run backend with PM2

```bash
cd /var/www/restaurant-pos/apps/backend
pm2 start dist/index.js --name restaurant-pos
pm2 save
pm2 startup    # run the command it prints, for boot-time start
```

Check: `pm2 logs restaurant-pos` and `curl http://127.0.0.1:3000/health`
Expected: `{"status":"ok","mode":"online-postgres","dbConnected":true,...}`

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

    # Basic hardening
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

The repo contains **`deploy.yml`** — it SSHs into the server on every push to `main`,
pulls code, installs, builds both apps, pushes DB schema, and restarts the service.

**Required GitHub repo secrets:**
- `SERVER_HOST` → Contabo IP
- `SERVER_USER` → SSH user
- `SERVER_PASSWORD` → SSH password (recommend switching to SSH key)

**Two fixes needed in `deploy.yml`:**
1. The restart step uses `sudo systemctl restart restaurant-pos` — either
   create a systemd unit with that name, **or** change it to `pm2 restart restaurant-pos`.
2. It runs `npx prisma migrate deploy` which does nothing (no migrations folder) —
   `npx prisma db push --skip-generate` (also in the script) is what actually works.

---

## 6. Post-Deployment Verification

- [ ] `https://pos.yourdomain.com/health` returns `"status":"ok"` and `"dbConnected":true`
- [ ] Frontend loads; login works (email/password and PIN)
- [ ] Create an order → kitchen display updates in realtime (WebSocket)
- [ ] Settle a cash payment; receipt/changes calculate correctly
- [ ] Two browsers see live table/order status changes
- [ ] `pm2 logs restaurant-pos` shows `[HTTP]` request logs, no errors
- [ ] `sudo systemctl status nginx` active
- [ ] SSL auto-renewal dry-run passes

---

## 7. Backups & Maintenance

```bash
# Manual DB backup
pg_dump -U pos_user restaurant_pos | gzip > /var/backups/pos_$(date +%F).sql.gz

# Recommended: daily cron at 2 AM
0 2 * * * pg_dump -U pos_user restaurant_pos | gzip > /var/backups/pos_$(date +\%F).sql.gz
```
- The app also runs its **own startup + daily backup timer** (`backup.service`).
- Keep 7–30 days of backups and copy them off-server (rclone/S3).
- OS updates: `sudo apt update && sudo apt upgrade -y` (or unattended-upgrades).

---

## 8. Security Checklist

- [ ] Strong random `JWT_SECRET` / `JWT_REFRESH_SECRET` (32+ chars)
- [ ] `.env` files are NOT committed to git and readable only by the app user (`chmod 600`)
- [ ] PostgreSQL and port 3000 NOT exposed publicly (UFW)
- [ ] HTTPS only; HTTP → HTTPS redirect (Certbot does this)
- [ ] SSH key auth + disable password login recommended
- [ ] Fail2ban installed (`sudo apt install fail2ban`)
- [ ] `NODE_ENV=production` set

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
| Rebuild after deploy | `cd apps/backend && DATABASE_PROVIDER=postgresql npm run build:postgres && npx prisma db push --skip-generate` |
| Restart backend | `pm2 restart restaurant-pos` |
| Logs | `pm2 logs restaurant-pos` |

---

*Generated for handoff — full project docs: `README.md`, `DEPLOYMENT.md`, `API.md`, `MULTI_TENANT_GUIDE.md`, `OFFLINE_SYNC.md`.*
