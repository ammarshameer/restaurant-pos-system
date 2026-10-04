# Dual Deployment Architecture: Offline Desktop & Online Multi-Tenant SaaS

This codebase supports **TWO** primary deployment targets from a single repository:

1. **OFFLINE Desktop**: Standalone Electron desktop application utilizing a local embedded SQLite database.
2. **ONLINE Cloud SaaS**: Multi-tenant cloud application deployed to Render (backend + Socket.IO) + Vercel (frontend SPA) backed by a managed PostgreSQL database.

---

## 1. Dynamic Prisma Datasource Switching (No Schema Duplication)

The backend uses [`scripts/prepare-prisma.js`](file:///apps/backend/scripts/prepare-prisma.js) which executes automatically prior to `prisma generate`, `prisma migrate`, or build scripts.

- **Offline / Local Mode**:
  Set `DATABASE_PROVIDER="sqlite"` (or omit, defaults to SQLite with `DATABASE_URL="file:./prisma/dev.db"`).
- **Online / Cloud SaaS Mode**:
  Set `DATABASE_PROVIDER="postgresql"` and provide a connection string: `DATABASE_URL="postgresql://user:pass@host:5432/pos?sslmode=require"`.

### NPM Commands
```bash
# In apps/backend:
npm run prisma:sqlite    # Switches schema to SQLite and regenerates Prisma client
npm run prisma:postgres  # Switches schema to PostgreSQL and regenerates Prisma client
npm run build            # Dynamically checks environment and compiles
```

---

## 2. Multi-Tenant Onboarding Flow (`POST /api/auth/onboard`)

Creating a new restaurant tenant isolates all their subsequent data.

### Endpoint: `POST /api/auth/onboard`
Rate-limited (5 onboarding attempts per hour per IP) to prevent automated abuse.

**Request Payload:**
```json
{
  "restaurantName": "Urban Grill House",
  "address": "123 Main Street, Downtown",
  "phone": "+1-555-0199",
  "email": "contact@urbangrill.com",
  "timezone": "America/New_York",
  "adminFirstName": "John",
  "adminLastName": "Doe",
  "adminEmail": "john@urbangrill.com",
  "adminPassword": "SecurePassword123!",
  "adminPin": "4321",
  "adminPhone": "+1-555-0198"
}
```

**What it executes in an atomic transaction:**
1. Creates a new `Restaurant` record.
2. Creates the initial `Employee` (Role: `ADMIN`) linked strictly to the new restaurant.
3. Automatically provisions default categories (`Burgers & Fast Food`, `Pizzas & Platters`, `Beverages & Drinks`, `Desserts`).
4. Generates a default `FloorPlan` and starter tables (`T-1` through `T-4`).
5. Returns JWT `accessToken`, `refreshToken`, and full tenant profile.

---

## 3. Cloud Deployment Guide

### A. Deploy Backend to Render
1. Connect your GitHub repository to [Render](https://render.com).
2. Choose **Blueprint** and select [`render.yaml`](file:///render.yaml).
3. Render will provision:
   - A **Managed PostgreSQL Database** (`restaurant-pos-db`).
   - A **Web Service** (`restaurant-pos-backend`) running Node.js with persistent WebSocket support.
4. Set the `FRONTEND_URL` environment variable to your Vercel deployment URL (e.g., `https://restaurant-pos.vercel.app`).

### B. Deploy Frontend to Vercel
1. Import the repository into [Vercel](https://vercel.com).
2. Set **Root Directory** to `apps/frontend`.
3. Add the Environment Variable:
   - `VITE_API_URL`: Your Render backend URL (e.g. `https://restaurant-pos-backend.onrender.com`).
4. Deploy. The [`vercel.json`](file:///apps/frontend/vercel.json) file handles SPA client-side routing rewrites and security headers.

---

## 4. Production Security Hardening

- **Rate Limiting**:
  - `POST /api/auth/login`, `POST /api/auth/pin-login`: 10 requests per minute per IP.
  - `POST /api/auth/onboard`: 5 requests per hour per IP.
- **CORS Locking**: Backend rejects origins not in `FRONTEND_URL`, localhost, or Electron local clients.
- **JWT Tenant Scoping**: JWT tokens contain `restaurantId`. Every protected route extracts `restaurantId` from the verified token—never trusting client-supplied query parameters.
- **WebSocket Isolation**: Socket.IO connections join tenant-isolated rooms (`restaurant:<restaurantId>`) derived strictly from the verified JWT.
- **Reverse Proxy Trust**: `app.set('trust proxy', 1)` enabled for correct client IP detection behind Render/Railway proxies.
- **Health Checks & Monitoring**: `/health` verifies database connectivity and tenant statistics.
