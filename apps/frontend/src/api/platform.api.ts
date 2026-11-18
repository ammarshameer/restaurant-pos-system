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
      // A 401 from a password-protected export means the re-entered password
      // was wrong, not that the access token expired. Never retry it.
      if (
        original.url?.includes('/auth/login') ||
        original.url?.includes('/auth/refresh') ||
        original.url?.includes('/export')
      ) {
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
            original.headers.Authorization = `Bearer ${res.accessToken}`;
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
  enabledFeatures?: string[];
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
  features?: Array<{ key: string; enabled: boolean; expiresAt?: string | null }> | string[];
  featureExpiresAt?: string | null;
}

function downloadBlob(data: Blob, contentDisposition: string | undefined, fallbackName: string): void {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  const fileName = (match?.[1] || fallbackName).replace(/[/\\]/g, '_');
  const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

/** Extracts an error message from JSON or blob error responses. */
export async function platformApiErrorMessage(
  error: any,
  fallback = 'Could not complete the request. Please try again.'
): Promise<string> {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed?.error || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.error || fallback;
}

export const platformApi = {
  getTenantFeatures: async (restaurantId: string) => {
    const res = await platformHttp.get(`/restaurants/${restaurantId}/features`);
    return res.data;
  },
  updateTenantFeatures: async (restaurantId: string, features: Array<{ key: string; enabled: boolean; expiresAt?: string | null }>) => {
    const res = await platformHttp.put(`/restaurants/${restaurantId}/features`, { features });
    return res.data;
  },
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

  /** Export a single business as a ZIP of CSVs. Requires password re-entry. */
  downloadTenantDataZip: async (restaurantId: string, password: string): Promise<void> => {
    const res = await platformHttp.post(
      `/restaurants/${encodeURIComponent(restaurantId)}/export`,
      { password },
      { responseType: 'blob' }
    );
    downloadBlob(res.data, res.headers['content-disposition'], `business-data-${restaurantId}.zip`);
  },

  /** Download the whole-database backup ZIP. Requires password re-entry. */
  downloadBackupZip: async (password: string): Promise<void> => {
    const res = await platformHttp.post('/backups/export', { password }, { responseType: 'blob' });
    downloadBlob(
      res.data,
      res.headers['content-disposition'],
      `restaurant-pos-backups-${new Date().toISOString().slice(0, 10)}.zip`
    );
  },
};
