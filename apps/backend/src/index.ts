import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
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
import backupRoutes from './routes/backup.routes';
import dealRoutes from './routes/deal.routes';
import { backupService } from './services/backup.service';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { setupWebSocket } from './websocket';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
].filter(Boolean) as string[];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, electron file:// or same-origin)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  },
});

// Dynamic Prisma initialization with support for app.getPath('userData') database location
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  console.log(`📦 Prisma connecting to: ${dbUrl}`);
}
export const prisma = new PrismaClient(
  dbUrl
    ? {
        datasources: {
          db: {
            url: dbUrl,
          },
        },
      }
    : undefined
);

// Production Environment Hardening Check
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'restaurant-pos-super-secret-jwt-key-change-in-production') {
    console.warn(`⚠️ [SECURITY WARNING] Insecure default JWT_SECRET detected in production environment! Please set a strong, random JWT_SECRET.`);
  }
}

// Trust proxy for Render / Railway / reverse proxies
app.set('trust proxy', 1);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true; // Electron, mobile apps, local file://, curl, server-to-server
  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true;
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

// Lightweight structured request logger for cloud debugging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const authRestId = (req as any).user?.restaurantId || (req as any).restaurantId || '-';
    if (!req.path.startsWith('/health') && !req.path.startsWith('/socket.io')) {
      console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms) [Tenant: ${authRestId}]`);
    }
  });
  next();
});

// Health check endpoint for Render/Railway/Electron polling
const handleHealthCheck = async (req: express.Request, res: express.Response) => {
  try {
    const restaurantCount = await prisma.restaurant.count();
    res.json({
      status: 'ok',
      mode: process.env.DATABASE_PROVIDER || (process.env.DATABASE_URL?.startsWith('postgres') ? 'online-postgres' : 'offline-sqlite'),
      dbConnected: true,
      tenants: restaurantCount,
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  } catch (dbErr: any) {
    console.error('[Health Check DB Error]', dbErr.message);
    res.status(503).json({
      status: 'degraded',
      dbConnected: false,
      error: dbErr.message,
      timestamp: new Date().toISOString(),
    });
  }
};

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tables', authenticate, tableRoutes);
app.use('/api/orders', authenticate, orderRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/employees', authenticate, employeeRoutes);
app.use('/api/inventory', authenticate, inventoryRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/payments', authenticate, paymentRoutes);
app.use('/api/backups', authenticate, backupRoutes);
app.use('/api/deals', authenticate, dealRoutes);

// WebSocket setup
setupWebSocket(io);

// Static frontend serving for Electron / Production
const candidateFrontendPaths = [
  process.env.FRONTEND_DIST_PATH,
  path.join(__dirname, '../../frontend/dist'),
  path.join(__dirname, '../frontend/dist'),
  path.join(process.cwd(), 'apps/frontend/dist'),
  path.join(process.cwd(), 'frontend/dist'),
].filter(Boolean) as string[];

let resolvedFrontendDist: string | null = null;
for (const p of candidateFrontendPaths) {
  if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
    resolvedFrontendDist = p;
    break;
  }
}

if (resolvedFrontendDist) {
  console.log(`🌐 Serving static frontend assets from: ${resolvedFrontendDist}`);
  app.use(express.static(resolvedFrontendDist));

  // SPA fallback for all non-API GET requests
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(resolvedFrontendDist!, 'index.html'));
  });
}

// Error handling middleware
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '3000', 10);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Restaurant POS Backend running on http://127.0.0.1:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Perform automated startup database backup & start daily timer
  backupService.performBackup('startup');
  backupService.startDailyTimer();
});

// Graceful shutdown helper
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received: closing database & HTTP server...`);
  
  // Trigger backup automatically on clean app shutdown
  try {
    backupService.performBackup('clean shutdown');
  } catch (backupErr) {
    console.error('Error during shutdown backup:', backupErr);
  }

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

  // Force shutdown if not closed within 3 seconds
  setTimeout(() => {
    console.error('⚠️ Forcefully terminating server process');
    process.exit(1);
  }, 3000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    gracefulShutdown('IPC shutdown');
  }
});

export { io };
