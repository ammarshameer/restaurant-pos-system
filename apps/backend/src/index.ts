import 'dotenv/config';
import './config/secrets';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import tableRoutes from './routes/table.routes';
import orderRoutes from './routes/order.routes';
import menuRoutes from './routes/menu.routes';
import authRoutes from './routes/auth.routes';
import employeeRoutes from './routes/employee.routes';
import inventoryRoutes from './routes/inventory.routes';
import analyticsRoutes from './routes/analytics.routes';
import paymentRoutes from './routes/payment.routes';
import dealRoutes from './routes/deal.routes';
import platformRoutes from './routes/platform.routes';
import permissionRoutes from './routes/permission.routes';
import roleRoutes from './routes/roles.routes';
import settingRoutes from './routes/settings.routes';
import customerRoutes from './routes/customer.routes';
import costingRoutes from './routes/costing.routes';
import duesRoutes from './routes/dues.routes';
import expensesRoutes from './routes/expenses.routes';
import payrollRoutes from './routes/payroll.routes';
import publicRoutes from './routes/public.routes';
import weborderRoutes from './routes/weborder.routes';
import { expireStaleWebOrders, purgeOldWebOrders } from './services/weborder.service';
import { migrateExistingBusinesses } from './services/feature.service';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { authenticate } from './middleware/auth';
import { setupWebSocket } from './websocket';

const PROCESS_STARTED_AT = new Date();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Never attach request bodies or user identifiers to reported events.
    sendDefaultPii: false,
    integrations: [Sentry.expressIntegration()],
  });
  console.log('✓ Error tracking enabled');
}

const app = express();
const httpServer = createServer(app);

// Frontend origins allowed by CORS.
const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  ...envOrigins,
  ...extraOrigins,
  'http://localhost:3100',
  'http://localhost:3000',
  'http://127.0.0.1:3100',
  'http://127.0.0.1:3000',
].filter(Boolean) as string[];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Requests without an origin include server-to-server calls and curl.
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  },
});

export const prisma = new PrismaClient();

// Production Environment Hardening Check
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'restaurant-pos-super-secret-jwt-key-change-in-production') {
    console.warn(`⚠️ [SECURITY WARNING] Insecure default JWT_SECRET detected in production environment! Please set a strong, random JWT_SECRET.`);
  }
  if (!process.env.TURNSTILE_SECRET_KEY) {
    console.warn('⚠️ [SECURITY WARNING] TURNSTILE_SECRET_KEY is missing in production. Public online orders will be refused until human verification is configured.');
  }
}

// Trust proxy for cloud hosting / reverse proxies
app.set('trust proxy', 1);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true; // Server-to-server, curl, mobile clients
  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return true;
  // Allow any local dev server, including IPv6 localhost and HTTPS dev servers.
  if (process.env.NODE_ENV !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(origin)) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS Blocked] Request origin: "${origin}"`);
        callback(new Error(`Not allowed by CORS`));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(requestLogger);

// Health check endpoint for uptime monitoring
const handleHealthCheck = async (req: express.Request, res: express.Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      mode: 'postgresql',
      dbConnected: true,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: PROCESS_STARTED_AT.toISOString(),
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  } catch (dbErr: any) {
    console.error('[Health Check DB Error]', dbErr.message);
    res.status(503).json({
      status: 'degraded',
      mode: 'postgresql',
      dbConnected: false,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: PROCESS_STARTED_AT.toISOString(),
      error: dbErr instanceof Error ? dbErr.message : 'Database check failed',
      timestamp: new Date().toISOString(),
    });
  }
};

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// API Routes
app.use('/api/platform', platformRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tables', authenticate, tableRoutes);
app.use('/api/orders', authenticate, orderRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/employees', authenticate, employeeRoutes);
app.use('/api/inventory', authenticate, inventoryRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/payments', authenticate, paymentRoutes);
app.use('/api/deals', authenticate, dealRoutes);
app.use('/api/roles', authenticate, roleRoutes);
app.use('/api/settings', authenticate, settingRoutes);
app.use('/api/customers', authenticate, customerRoutes);
app.use('/api/costing', authenticate, costingRoutes);
app.use('/api/dues', authenticate, duesRoutes);
app.use('/api/expenses', authenticate, expensesRoutes);
app.use('/api/payroll', authenticate, payrollRoutes);

// Public (no-login) website ordering API — rate limited per IP inside the router
app.use('/api/public', publicRoutes);
// POS-side Website & WhatsApp Orders module (403 when the module is off)
app.use('/api/weborders', authenticate, weborderRoutes);

// WebSocket setup
setupWebSocket(io);

// Error handling middleware (Sentry first, then our JSON responder)
app.use(Sentry.expressErrorHandler());
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '3000', 10);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Restaurant POS Backend running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Migrate any existing businesses to ensure full module availability
  migrateExistingBusinesses().catch((err) => console.error('Migration error:', err));

  // Website order lifecycle: expire unaccepted orders and purge old data
  setInterval(() => {
    expireStaleWebOrders().catch((err) => console.warn('[WebOrder] expiry sweep failed:', err?.message));
  }, 60 * 1000);
  setInterval(() => {
    purgeOldWebOrders().catch((err) => console.warn('[WebOrder] purge failed:', err?.message));
  }, 6 * 60 * 60 * 1000);
});

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received: closing database & HTTP server...`);

  try {
    await prisma.$disconnect();
    console.log('✓ Prisma disconnected');
  } catch (err) {
    console.error('Error disconnecting Prisma:', err);
  }

  httpServer.close(() => {
    console.log('✓ HTTP server closed cleanly');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ Forcefully terminating server process');
    process.exit(1);
  }, 3000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { io };
