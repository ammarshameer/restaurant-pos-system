import { api } from '../lib/api';

export interface OwnerProfile {
  id: string;
  firstName: string;
  lastName: string;
  username?: string | null;
  email: string;
  phone?: string | null;
  address?: string | null;
  restaurant?: {
    name: string;
    slug?: string | null;
  };
}

export interface OwnerProfileUpdate {
  firstName: string;
  lastName: string;
  username?: string;
  email: string;
  phone: string;
  address: string;
  currentPassword: string;
}

export interface OwnerProfileUpdateResponse {
  profile: OwnerProfile;
  requiresRelogin: boolean;
  message: string;
}

export const ownerProfileApi = {
  get: (): Promise<OwnerProfile> => api.get<OwnerProfile>('/auth/profile'),

  update: (data: OwnerProfileUpdate): Promise<OwnerProfileUpdateResponse> =>
    api.patch<OwnerProfileUpdateResponse>('/auth/profile', data),
};
