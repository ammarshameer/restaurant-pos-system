import axios, { AxiosInstance, AxiosError } from 'axios';
import { network, isNetworkError } from './offline/network';
import { getRefreshToken, storeSession, clearSession } from './session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/** Auth endpoints that must never trigger the refresh/retry flow. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/pin-login', '/auth/refresh', '/auth/onboard'];

type RefreshResult = { token?: string; networkError?: boolean };

let refreshPromise: Promise<RefreshResult> | null = null;

/**
 * Exchange the stored refresh token for a fresh access token. Single-flight so
 * a burst of parallel 401s only triggers one refresh. A network failure (still
 * offline) is reported separately so callers can keep the session instead of
 * logging the user out.
 */
async function refreshAccessToken(): Promise<RefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return {};

  try {
    const res = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    const data: any = res.data || {};
    if (data.accessToken) {
      network.set(true);
      storeSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      return { token: data.accessToken };
    }
    return {};
  } catch (e: any) {
    if (isNetworkError(e)) {
      network.set(false);
      return { networkError: true };
    }
    return {};
  }
}

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      // Keep requests short so the POS can fall back to offline mode quickly
      // when the server is unreachable.
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
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

    // Response interceptor for error handling + connectivity detection
    this.client.interceptors.response.use(
      (response) => {
        // Any successful round-trip means we have a working connection.
        network.set(true);
        return response;
      },
      async (error: AxiosError) => {
        // A request that never reached the server means we are offline.
        if (isNetworkError(error)) {
          network.set(false);
        }

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
          const result = await refreshPromise;

          if (result.token) {
            original.headers = original.headers || {};
            original.headers.Authorization = `Bearer ${result.token}`;
            return this.client(original);
          }

          // Still offline: keep the session (and queued offline ops) intact.
          if (result.networkError) {
            return Promise.reject(error);
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
    const response = await this.client.post<T>(url, data);
    return response.data;
  }

  async patch<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.patch<T>(url, data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete<T>(url);
    return response.data;
  }
}

export const api = new ApiClient();