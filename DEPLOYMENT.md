# Deployment Guide

This guide covers deploying the Restaurant POS system to production as an online-only web application. An internet connection and PostgreSQL are required.

## Overview

The system consists of three main components:
1. **PostgreSQL Database** - Data storage
2. **Backend API** - Node.js/Express server with WebSocket support
3. **Frontend** - React/Vite single-page application

## Database Deployment

### Option 1: Supabase (Recommended for beginners)

1. Sign up at [supabase.com](https://supabase.com)
2. Create a new project
3. Copy the PostgreSQL connection string from Project Settings > Database
4. Format: `postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres`

### Option 2: Railway

1. Sign up at [railway.app](https://railway.app)
2. Create new project > Add PostgreSQL
3. Copy the `DATABASE_URL` from Variables tab

### Option 3: Neon

1. Sign up at [neon.tech](https://neon.tech)
2. Create a new project
3. Copy the connection string

## Backend Deployment

### Option 1: Railway (Recommended)

1. **Install Railway CLI**
```bash
npm install -g @railway/cli
railway login
```

2. **Initialize project**
```bash
cd apps/backend
railway init
```

3. **Add PostgreSQL database**
```bash
railway add --database postgresql
```

4. **Set environment variables** (each JWT secret must be 32+ chars and all three distinct)
```bash
railway variables set DATABASE_URL="postgresql://user:password@host:5432/restaurant_pos?sslmode=require"
railway variables set NODE_ENV="production"
railway variables set JWT_SECRET="your-tenant-secret-32-chars-minimum"
railway variables set JWT_REFRESH_SECRET="your-refresh-secret-32-chars-minimum"
railway variables set JWT_PLATFORM_SECRET="your-platform-secret-32-chars-minimum"
railway variables set FRONTEND_URL="https://your-frontend-domain.com"
railway variables set SUPER_ADMIN_EMAIL="superadmin@yourdomain.com"
railway variables set SUPER_ADMIN_PASSWORD="a-strong-unique-password"
railway variables set SUPPORT_EMAIL="support@yourdomain.com"
railway variables set SUPPORT_PASSWORD="a-strong-unique-password"
railway variables set TURNSTILE_SECRET_KEY="your-cloudflare-turnstile-secret"
```

5. **Deploy**
```bash
railway up
```

6. **Run database migrations**
```bash
railway run npx prisma migrate deploy
```

### Option 2: Render

1. Create account at [render.com](https://render.com)
2. New > Web Service
3. Connect your GitHub repository
4. Configure:
   - **Build Command**: `cd apps/backend && npm install && npx prisma generate && npm run build`
   - **Start Command**: `cd apps/backend && npm start`
5. Add environment variables in Render dashboard
6. Deploy

### Option 3: Fly.io

1. **Install Fly CLI**
```bash
curl -L https://fly.io/install.sh | sh
```

2. **Login and launch**
```bash
cd apps/backend
fly auth login
fly launch
```

3. **Set secrets** (each JWT secret must be 32+ chars and all three distinct)
```bash
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set NODE_ENV="production"
fly secrets set JWT_SECRET="..."
fly secrets set JWT_REFRESH_SECRET="..."
fly secrets set JWT_PLATFORM_SECRET="..."
fly secrets set FRONTEND_URL="https://your-frontend.com"
fly secrets set SUPER_ADMIN_EMAIL="superadmin@yourdomain.com"
fly secrets set SUPER_ADMIN_PASSWORD="a-strong-unique-password"
fly secrets set SUPPORT_EMAIL="support@yourdomain.com"
fly secrets set SUPPORT_PASSWORD="a-strong-unique-password"
fly secrets set TURNSTILE_SECRET_KEY="your-cloudflare-turnstile-secret"
```

4. **Deploy**
```bash
fly deploy
```

## Frontend Deployment

### Option 1: Vercel (Recommended)

1. **Install Vercel CLI**
```bash
npm install -g vercel
```

2. **Deploy**
```bash
cd apps/frontend
vercel
```

3. **Set environment variables** in Vercel dashboard:
   - `VITE_API_URL`: Your backend URL, **including the `/api` suffix** (e.g. `https://your-api.railway.app/api`). This is required for the public customer menu, CSV exports and WebSocket connections to reach the backend when the frontend is hosted on a different domain.
   - `VITE_TURNSTILE_SITE_KEY`: Your Cloudflare Turnstile site key (must pair with the backend `TURNSTILE_SECRET_KEY` for public orders).

4. **Redeploy** to apply env vars:
```bash
vercel --prod
```

### Option 2: Netlify

1. **Install Netlify CLI**
```bash
npm install -g netlify-cli
```

2. **Build the app**
```bash
cd apps/frontend
npm run build
```

3. **Deploy**
```bash
netlify deploy --prod --dir=dist
```

4. **Set environment variables** in Netlify dashboard

### Option 3: Cloudflare Pages

1. Connect GitHub repository to Cloudflare Pages
2. Configure build:
   - **Build command**: `cd apps/frontend && npm install && npm run build`
   - **Build output directory**: `apps/frontend/dist`
3. Add environment variables
4. Deploy

## Database Migrations

> ⚠️ **Existing installations on the old `prisma db push` schema:** do **not**
> run `prisma migrate deploy` directly. The old schema has no
> `_prisma_migrations` history, so plain `migrate deploy` will fail. Back up the
> live database, restore that backup to **staging**, then follow
> `apps/backend/scripts/README-production-baseline.md` to apply the reviewed
> one-off delta and the mandatory per-tenant backfills. The baseline script
> fails closed on schema drift and on any tenant that cannot be backfilled, so
> no business is left half-upgraded. Only after the staging run succeeds should
> you schedule the same runbook against production. Fresh databases can skip
> this and apply migrations normally.

After deploying the backend, run migrations:

```bash
# If using Railway
railway run npx prisma migrate deploy

# If using Render
# SSH into your service and run:
npx prisma migrate deploy

# If using Fly.io
fly ssh console
npx prisma migrate deploy
```

## Environment Variables Checklist

### Backend (all required unless marked optional)

- [ ] `DATABASE_URL` - PostgreSQL connection string (with `?sslmode=require` for managed DBs)
- [ ] `NODE_ENV` - Set to `production`; the app **fails to start** if the secrets below are missing, short (< 32 chars) or identical
- [ ] `JWT_SECRET` - 32+ char secret for tenant access tokens
- [ ] `JWT_REFRESH_SECRET` - 32+ char secret for refresh tokens
- [ ] `JWT_PLATFORM_SECRET` - 32+ char secret for platform/admin tokens, **distinct** from both above
- [ ] `FRONTEND_URL` - Comma-separated frontend origins for CORS (exact origins, no wildcards in production)
- [ ] `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` - Bootstrap platform admin credentials
- [ ] `SUPPORT_EMAIL` / `SUPPORT_PASSWORD` - Bootstrap support account credentials
- [ ] `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile secret; public web orders are **refused** without it
- [ ] `ALLOW_SELF_ONBOARDING` - Must be `false` for multi-tenant SaaS
- [ ] `SENTRY_DSN` *(optional)* - Server error tracking
- [ ] `BACKUP_DIR` / `BACKUP_REMOTE` / `BACKUP_RETENTION_DAYS` *(optional)* - Off-server daily backups
- [ ] `PORT` - Usually auto-assigned by the platform

### Frontend

- [ ] `VITE_API_URL` - Backend API URL **including `/api`**, e.g. `https://pos.yourdomain.com/api`. Required for the public menu, CSV export and WebSocket when frontend/backend are on different domains.
- [ ] `VITE_TURNSTILE_SITE_KEY` - Cloudflare Turnstile site key (pairs with backend `TURNSTILE_SECRET_KEY`)
- [ ] `VITE_SENTRY_DSN` *(optional)* - Browser error tracking
- [ ] `VITE_PRINT_AGENT_URL` / `VITE_PRINT_AGENT_TOKEN` *(optional)* - Build-time defaults for the local print agent; normally written by the installer instead

> ⚠️ **Do not commit real `.env` files.** The checked-in `.env.example` files in the repo root, `apps/backend/` and `apps/frontend/` are templates only.

## Post-Deployment Steps

### 1. Test the deployment
- [ ] Visit frontend URL
- [ ] Test login with email/password and PIN
- [ ] Create a test order and send to kitchen
- [ ] Settle cash payment and verify change calculation
- [ ] Generate and print test receipt
- [ ] Check real-time WebSocket updates work

### 2. Set up monitoring
- [ ] Configure error tracking (Sentry recommended)
- [ ] Configure log aggregation
- [ ] Point an uptime monitor at `GET /health` (or `GET /api/health`)

#### Uptime check for `/health`

```bash
curl -fsS https://pos.yourdomain.com/health
```

Expected response while healthy:

```json
{
  "status": "ok",
  "mode": "postgresql",
  "dbConnected": true,
  "uptimeSeconds": 12345,
  "startedAt": "2026-11-18T00:00:00.000Z",
  "timestamp": "2026-11-18T03:25:45.000Z",
  "env": "production"
}
```

A database failure returns HTTP 503 with `"status": "degraded"` and
`"dbConnected": false`. Alert on anything other than HTTP 200/`"status": "ok"`.
The `uptimeSeconds` and `startedAt` fields also make unexpected restarts easy
to spot.

### 3. Configure domain (optional)
- [ ] Purchase domain name
- [ ] Point DNS to your hosting platform
- [ ] Configure SSL certificate (usually automatic)

### 4. Local print agent (optional, for receipt printing)

The one-click Windows/Linux installers generated by POS Settings download the
agent from the `agent-latest` GitHub release and **verify a published `.sha256`
checksum before installation**. If a release is published without its matching
`.sha256` asset, the installers fail closed and refuse to run the binary.

- [ ] Confirm the `agent-latest` release contains both the binaries and their
      `.sha256` files (see `apps/print-agent/README.md`).
- [ ] Each installer is generated for the POS site's own domain
      (`window.location.origin`) and uses a strict default-deny origin list;
      the agent only accepts requests from that exact origin.
- [ ] The loopback URL is always `http://127.0.0.1:17778`; do not expose it to
      the internet.

## Troubleshooting

### Database connection issues
```bash
# Test database connection
psql $DATABASE_URL

# Verify Prisma can connect
npx prisma db pull
```

### Migration failures

> ⚠️ **Never run `prisma migrate reset` against production.** It drops the
> database and destroys all tenant data. There is no `migrate deploy --force`
> flag; do not attempt to bypass a failed migration.

Check the current state first:

```bash
cd apps/backend
npm run db:migrate:status
npm run db:migrate:check   # exits non-zero unless fully baselined
```

If the database was created with the old `prisma db push` schema and has no
`_prisma_migrations` history, do **not** mark `init` as applied before the
schema is upgraded. Back up, restore the backup to staging, and follow
`apps/backend/scripts/README-production-baseline.md`:

```bash
npm run db:backup
LIVE_BASELINE_CONFIRMED=yes npm run db:migrate:baseline
npm run db:migrate:check
```

`db:migrate:baseline` applies the reviewed one-off delta, aborts on schema
drift, and only then resolves the checked-in migrations as applied. For a
normal database with pending migrations, investigate the specific error and
apply `npm run db:migrate` after the cause is fixed.

### WebSocket connection issues
- Ensure backend URL in frontend uses correct protocol (wss:// for https)
- Check CORS settings allow WebSocket connections
- Verify firewall rules allow WebSocket traffic

### Build failures
```bash
# Clear cache and rebuild
rm -rf node_modules dist
npm install
npm run build
```

## Scaling Considerations

### Database
- Enable connection pooling (PgBouncer)
- Set up read replicas for analytics queries
- Regular backups (automated on most platforms)

### Backend
- Scale horizontally (add more server instances)
- Use Redis for session/socket clustering if using multiple instances
- Enable rate limiting to prevent abuse

### Frontend
- Enable CDN for static assets
- Configure caching headers
- Use image optimization

## Security Checklist

- [ ] Use HTTPS for all connections
- [ ] Set strong JWT secrets (min 32 characters)
- [ ] Enable CORS only for your frontend domain
- [ ] Use environment variables for all secrets
- [ ] Enable rate limiting on API
- [ ] Set up SSL certificate monitoring
- [ ] Configure helmet.js security headers
- [ ] Enable SQL injection prevention (Prisma does this)
- [ ] Validate all user inputs

## Backup Strategy

### Database backups

Use the checked-in scripts; they strip Prisma's `?schema=public` parameter,
write gzipped dumps outside the app directory, and can copy them off-server.

```bash
cd apps/backend

# Manual/scheduled backup (30-day retention, optional BACKUP_REMOTE upload)
npm run db:backup

# Restore only into a scratch/staging database
RESTORE_DATABASE_URL='postgresql://pos:pos@localhost:5432/restaurant_pos_restore_test?schema=public' \
  npm run db:restore -- /var/backups/restaurant-pos/restaurant-pos-<timestamp>.sql.gz
```

`db:restore` refuses to target the live `DATABASE_URL` and verifies gzip
integrity first. Full configuration is in
`apps/backend/scripts/README-backup.md`.

### Monthly backup-restore test

A backup is only valid if it has been restored. Once a month:

1. Run `npm run db:backup` and note the dump filename.
2. Create an empty scratch database.
3. Run `npm run db:restore -- <dump>` with `RESTORE_DATABASE_URL` pointing at
   the scratch database.
4. Verify representative row counts, for example:

   ```bash
   psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "Restaurant";'
   psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "Order";'
   ```

5. Drop the scratch database and record the date, filename and result in the
   operations log. Investigate any failure before the next scheduled backup.

The platform Super Admin **Backups** tab can also download a ZIP of current
dumps; that action requires password re-entry and is written to the platform
audit log.

## Monitoring & Logging

### Recommended Tools
- **Error Tracking**: Sentry, Rollbar
- **Uptime Monitoring**: UptimeRobot, Pingdom
- **Log Management**: Logtail, Papertrail
- **Performance**: New Relic, Datadog

## Cost Optimization

### Free Tier Options
- **Database**: Supabase (500MB), Neon (0.5GB)
- **Backend**: Railway ($5 credit), Render (750hrs/mo)
- **Frontend**: Vercel, Netlify, Cloudflare Pages (all have generous free tiers)

### Estimated Monthly Costs
- **Hobby/Small**: $0-20/month (using free tiers)
- **Small Business**: $20-50/month
- **Medium Business**: $100-300/month

## Quick Deploy Commands

```bash
# Full deployment workflow
cd restaurant-pos

# Backend
cd apps/backend
railway init
railway up
railway run npm run db:backup
railway run npm run db:migrate

# Frontend
cd ../frontend
vercel
```

Done! Your restaurant POS system is now live.
