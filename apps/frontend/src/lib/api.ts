import axios, { AxiosInstance, AxiosError } from 'axios';
import { getRefreshToken, storeSession, clearSession } from './session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/** Auth endpoints that must never trigger the refresh/retry flow. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/pin-login', '/auth/refresh', '/auth/onboard'];

let refreshPromise: Promise<string | null> | null = null;

/** True when the request never reached the server (safe to retry). */
export function isNetworkFailure(error: any): boolean {
  if (error?.response) return false;
  return ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_CONNECTION_RESET'].includes(error?.code) ||
    error instanceof TypeError;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries a request only when it carries a stable idempotency key. The server
 * dedupes on that key, so a retry can never produce a duplicate order/payment.
 */
async function withIdempotentRetry<T>(send: () => Promise<T>, payload: any): Promise<T> {
  const hasIdempotencyKey = Boolean(payload?.clientId || payload?.clientRef);
  if (!hasIdempotencyKey) return send();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (!isNetworkFailure(error) || attempt === 2) throw error;
      await delay(500 * (attempt + 1));
    }
  }
  throw new Error('Request failed');
}

/** Exchange the stored refresh token for a fresh access token. Single-flight. */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    const data: any = res.data || {};
    if (data.accessToken) {
      storeSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      return data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original: any = error.config;
        const status = error.response?.status;
        const url = original?.url || '';
        const isAuthEndpoint = AUTH_ENDPOINTS.some((endpoint) => url.includes(endpoint));

        // Try a silent refresh once for expired access tokens, then replay the
        // original request with the new token.
        if (status === 401 && original && !original._retried && !isAuthEndpoint) {
          original._retried = true;

          if (!refreshPromise) {
            refreshPromise = refreshAccessToken().finally(() => {
              refreshPromise = null;
            });
          }
          const token = await refreshPromise;

          if (token) {
            original.headers = original.headers || {};
            original.headers.Authorization = `Bearer ${token}`;
            return this.client(original);
          }
        }

        const hadToken = Boolean(localStorage.getItem('auth_token'));
        if (status === 401 && (isAuthEndpoint || !hadToken || original?._retried)) {
          clearSession();
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.replace('/login');
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string, params?: any): Promise<T> {
    const response = await this.client.get<T>(url, { params });
    return response.data;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await withIdempotentRetry(() => this.client.post<T>(url, data), data);
    return response.data;
  }

  async put<T>(url: string, data?: any): Promise<T> {
    const response = await withIdempotentRetry(() => this.client.put<T>(url, data), data);
    return response.data;
  }

  async patch<T>(url: string, data?: any): Promise<T> {
    const response = await withIdempotentRetry(() => this.client.patch<T>(url, data), data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete<T>(url);
    return response.data;
  }
}

export const api = new ApiClient();
