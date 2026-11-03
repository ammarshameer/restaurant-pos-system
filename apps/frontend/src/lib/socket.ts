import { io, Socket } from 'socket.io-client';
import { getCurrentRestaurantId } from './session';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

class SocketClient {
  private socket: Socket | null = null;

  connect(token: string, restaurantId?: string) {
    if (this.socket?.connected) {
      return this.socket;
    }

    const targetRestId = restaurantId || getCurrentRestaurantId() || undefined;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      query: targetRestId ? { restaurantId: targetRestId } : undefined,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  emit(event: string, data: any) {
    this.socket?.emit(event, data);
  }

  on(event: string, callback: (...args: any[]) => void) {
    this.socket?.on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void) {
    this.socket?.off(event, callback);
  }

  getSocket() {
    return this.socket;
  }
}

export const socketClient = new SocketClient();