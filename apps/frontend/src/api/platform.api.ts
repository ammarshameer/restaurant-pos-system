import axios, { AxiosInstance } from 'axios';
import {
  getPlatformAccessToken,
  getPlatformRefreshToken,
  storePlatformSession,
  clearPlatformSession,
} from '../lib/session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const platformHttp: AxiosInstance = axios.create({
  baseURL: `${API_URL}/platform`,
  headers: {
    'Content-Type': 'application/json',
  },
});

let platformRefreshPromise: Promise<any> | null = null;

async function refreshPlatformSession(refreshToken: string): Promise<any> {
  if (!platformRefreshPromise) {
    platformRefreshPromise = axios
      .post(`${API_URL}/platform/auth/refresh`, { refreshToken })
      .then((res) => res.data)
      .finally(() => {
        platformRefreshPromise = null;
      });
  }
  return platformRefreshPromise;
}

platformHttp.interceptors.request.use((config) => {
  const token = getPlatformAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

platformHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original: any = error.config;
    if (error.response?.status === 401 && original && !original._retried) {
      if (original.url?.includes('/auth/login') || original.url?.includes('/auth/refresh')) {
        return Promise.reject(error);
      }
      original._retried = true;
      const refreshToken = getPlatformRefreshToken();
      if (refreshToken) {
        try {
          const res = await refreshPlatformSession(refreshToken);
          if (res?.accessToken) {
            storePlatformSession({
              accessToken: res.accessToken,
              refreshToken: res.refreshToken,
              user: res.user,
            });
            original.headers.Authorization = `Bearer ${res.data.accessToken}`;
            return platformHttp(original);
          }
        } catch {
          clearPlatformSession();
          if (typeof window !== 'undefined' && window.location.pathname !== '/platform/login') {
            window.location.replace('/platform/login');
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isActive: boolean;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  owner?: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    role: string;
  } | null;
}

export interface CreateBusinessPayload {
  businessName: string;
  address?: string;
  phone?: string;
  businessEmail?: string;
  timezone?: string;
  logoUrl?: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPhone?: string;
  ownerPassword: string;
  ownerPin?: string;
}

export const platformApi = {
  login: async (email: string, password: string) => {
    const res = await platformHttp.post('/auth/login', { email, password });
    return res.data;
  },

  logout: async () => {
    const refreshToken = getPlatformRefreshToken();
    if (refreshToken) {
      try {
        await platformHttp.post('/auth/logout', { refreshToken });
      } catch {
        // ignore
      }
    }
    clearPlatformSession();
  },

  getMe: async () => {
    const res = await platformHttp.get('/me');
    return res.data.user;
  },

  getRestaurants: async (): Promise<PlatformTenant[]> => {
    const res = await platformHttp.get('/restaurants');
    return res.data;
  },

  createRestaurant: async (data: CreateBusinessPayload) => {
    const res = await platformHttp.post('/restaurants', data);
    return res.data;
  },

  updateRestaurant: async (id: string, data: Partial<PlatformTenant>) => {
    const res = await platformHttp.patch(`/restaurants/${id}`, data);
    return res.data;
  },

  resetOwnerPassword: async (id: string, newPassword: string) => {
    const res = await platformHttp.post(`/restaurants/${id}/reset-owner-password`, { newPassword });
    return res.data;
  },

  enterTenant: async (id: string, reason?: string) => {
    const res = await platformHttp.post(`/restaurants/${id}/enter`, { reason });
    return res.data;
  },

  upsertSupportAccount: async (data: { name?: string; email: string; password?: string; isActive?: boolean }) => {
    const res = await platformHttp.put('/support-account', data);
    return res.data;
  },

  getAuditLogs: async (params?: { page?: number; limit?: number; restaurantId?: string; action?: string }) => {
    const res = await platformHttp.get('/audit-logs', { params });
    return res.data;
  },
};
