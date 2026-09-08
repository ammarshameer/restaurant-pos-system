# Deployment Guide

This guide covers deploying the Restaurant POS system to production for offline/local network and cloud POS environments.

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

4. **Set environment variables**
```bash
railway variables set JWT_SECRET="your-secret-key"
railway variables set JWT_REFRESH_SECRET="your-refresh-secret"
railway variables set FRONTEND_URL="https://your-frontend-domain.com"
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

3. **Set secrets**
```bash
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set JWT_SECRET="..."
fly secrets set JWT_REFRESH_SECRET="..."
fly secrets set FRONTEND_URL="https://your-frontend.com"
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
   - `VITE_API_URL`: Your backend URL (e.g. `https://your-api.railway.app/api`)

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

### Backend
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `JWT_SECRET` - Secret for access tokens
- [ ] `JWT_REFRESH_SECRET` - Secret for refresh tokens
- [ ] `FRONTEND_URL` - Frontend domain (for CORS)
- [ ] `NODE_ENV` - Set to "production"
- [ ] `PORT` - Usually auto-assigned by platform

### Frontend
- [ ] `VITE_API_URL` - Backend API URL

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
- [ ] Set up uptime monitoring
- [ ] Configure log aggregation

### 3. Configure domain (optional)
- [ ] Purchase domain name
- [ ] Point DNS to your hosting platform
- [ ] Configure SSL certificate (usually automatic)

## Troubleshooting

### Database connection issues
```bash
# Test database connection
psql $DATABASE_URL

# Verify Prisma can connect
npx prisma db pull
```

### Migration failures
```bash
# Reset database (⚠️ DESTROYS DATA)
npx prisma migrate reset

# Force deploy migrations
npx prisma migrate deploy --force
```

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

### Database Backups
```bash
# Manual backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore from backup
psql $DATABASE_URL < backup.sql
```

### Automated Backups
Most hosting platforms (Railway, Supabase, Neon) provide automatic daily backups.

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
railway run npx prisma migrate deploy

# Frontend
cd ../frontend
vercel
```

Done! Your restaurant POS system is now live.
