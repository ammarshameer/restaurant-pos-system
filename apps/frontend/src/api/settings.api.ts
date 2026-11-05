import { api } from '../lib/api';

export interface BusinessSettings {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessBranding {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  address: string;
  phone: string;
  timezone: string;
}

export const settingsApi = {
  getBranding: async () => {
    return api.get<BusinessBranding>('/settings/branding');
  },

  getBusinessSettings: async (): Promise<BusinessSettings> => {
    return api.get('/settings/business');
  },

  updateBusinessSettings: async (data: Partial<BusinessSettings>): Promise<BusinessSettings> => {
    return api.patch('/settings/business', data);
  },
};
