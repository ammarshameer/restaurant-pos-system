import type { BusinessSettings } from '../api/settings.api';

export interface ReceiptBranding {
  name: string;
  address?: string;
  phone?: string;
  logoUrl?: string | null;
}

const STORAGE_KEY = 'pos_business_print_settings';

export function cacheReceiptBranding(settings: Pick<BusinessSettings, 'name' | 'address' | 'phone' | 'logoUrl'>): void {
  const branding: ReceiptBranding = {
    name: settings.name,
    address: settings.address,
    phone: settings.phone,
    logoUrl: settings.logoUrl,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
}

export function getCachedReceiptBranding(): ReceiptBranding | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as ReceiptBranding : null;
  } catch {
    return null;
  }
}
