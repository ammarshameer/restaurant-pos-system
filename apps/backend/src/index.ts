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

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Electron file/local requests) or configured origins
      callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Health check endpoint for Electron main process readiness polling
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    dbConnected: true,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tables', authenticate, tableRoutes);
app.use('/api/orders', authenticate, orderRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/employees', authenticate, employeeRoutes);
app.use('/api/inventory', authenticate, inventoryRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/payments', authenticate, paymentRoutes);

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
});

// Graceful shutdown helper
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
