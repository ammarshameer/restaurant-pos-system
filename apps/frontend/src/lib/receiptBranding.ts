import type { BusinessSettings } from '../api/settings.api';
import { getTenantItem, setTenantItem } from './tenantStorage';

export interface ReceiptBranding {
  name: string;
  address?: string;
  phone?: string;
  logoUrl?: string | null;
}

const STORAGE_KEY = 'pos_business_print_settings';

export function cacheReceiptBranding(settings: Pick<BusinessSettings, 'id' | 'name' | 'address' | 'phone' | 'logoUrl'>): void {
  const branding: ReceiptBranding = {
    name: settings.name,
    address: settings.address,
    phone: settings.phone,
    logoUrl: settings.logoUrl,
  };
  setTenantItem(STORAGE_KEY, branding, settings.id);
}

export function getCachedReceiptBranding(): ReceiptBranding | null {
  return getTenantItem<ReceiptBranding | null>(STORAGE_KEY, null);
}
