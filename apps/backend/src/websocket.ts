import { Server, Socket } from 'socket.io';
import {
  resolveTenantSession,
  AuthenticatedUser,
} from './services/session-resolver';

export type SocketUser = AuthenticatedUser;

let ioInstance: Server | null = null;

export const getIO = (): Server | null => {
  return ioInstance;
};

export const setupWebSocket = (io: Server) => {
  ioInstance = io;

  // Authentication middleware for WebSocket
  io.use(async (socket: Socket, next) => {
    let token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization;

    if (token && typeof token === 'string' && token.startsWith('Bearer ')) {
      token = token.slice(7).trim();
    }

    // Allow mock connection only when NOT in production AND explicitly enabled by env
    if (!token) {
      const isProduction = process.env.NODE_ENV === 'production';
      const allowMock = process.env.ALLOW_MOCK_AUTH === 'true';

      if (isProduction || !allowMock) {
        return next(new Error('Authentication error: Token required'));
      }

      const devRestId = socket.handshake.query?.restaurantId as string;
      if (!devRestId) {
        return next(new Error('Authentication error: restaurantId query required in dev when omitting token'));
      }
      (socket as any).user = {
        id: 'emp-dev-1',
        email: 'dev@pos.local',
        role: 'OWNER',
        restaurantId: devRestId,
      };
      return next();
    }

    try {
      const sessionUser = await resolveTenantSession(token);
      (socket as any).user = sessionUser;
      next();
    } catch (err: any) {
      return next(new Error(`Authentication error: ${err.message || 'Invalid token'}`));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user as SocketUser;
    if (!user || !user.restaurantId) {
      socket.disconnect(true);
      return;
    }

    const restaurantId = user.restaurantId;
    socket.join(`restaurant:${restaurantId}`);
    console.log(
      `User ${user.email} joined restaurant room: restaurant:${restaurantId}${
        user.supportMode ? ' (Support impersonation)' : ''
      }`
    );

    // Table status updates
    socket.on('table:update', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('table:updated', data);
    });

    socket.on('table:status', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('table:status:changed', data);
    });

    // Order events
    socket.on('order:created', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('order:new', data);
      io.to(`restaurant:${restaurantId}:kitchen`).emit('kitchen:order:new', data);
    });

    socket.on('order:updated', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('order:updated', data);
    });

    socket.on('order:item:status', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('order:item:status:changed', data);
      io.to(`restaurant:${restaurantId}:floor`).emit('order:item:ready', data);
    });

    // Kitchen display events
    socket.on('kitchen:join', () => {
      socket.join(`restaurant:${restaurantId}:kitchen`);
      console.log(`Kitchen display connected for restaurant ${restaurantId}`);
    });

    socket.on('kitchen:item:complete', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('kitchen:item:completed', data);
    });

    // Payment events
    socket.on('payment:initiated', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('payment:processing', data);
    });

    socket.on('payment:completed', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('payment:success', data);
    });

    // Inventory events
    socket.on('inventory:alert', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('inventory:alert', data);
    });

    // Floor plan live sync
    socket.on('floor:update', (data) => {
      io.to(`restaurant:${restaurantId}`).emit('floor:updated', data);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${user.email} (${socket.id})`);
    });
  });
};
