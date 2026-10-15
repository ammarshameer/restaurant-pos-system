type Listener = (online: boolean) => void;

/**
 * Tracks browser connectivity. `navigator.onLine` gives us a fast signal, but
 * the sync engine may also flip this to `false` when a request fails at the
 * network layer (e.g. server unreachable while "online").
 */
class NetworkMonitor {
  private online: boolean;
  private listeners = new Set<Listener>();

  constructor() {
    this.online = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.set(true));
      window.addEventListener('offline', () => this.set(false));
    }
  }

  isOnline(): boolean {
    return this.online;
  }

  set(value: boolean): void {
    if (this.online === value) return;
    this.online = value;
    this.listeners.forEach((listener) => listener(value));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const network = new NetworkMonitor();

/** True when an axios/network request failed before reaching the server. */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  // Axios errors carry `isAxiosError`; no `response` means the request never landed.
  if (error.isAxiosError) return !error.response;
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') return true;
  return false;
}
