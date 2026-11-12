import { api } from '../lib/api';

export interface WebOrderModifier {
  group?: string;
  name: string;
  price: number;
}

export interface WebOrderItem {
  id: string;
  menuItemId?: string | null;
  dealId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  modifiers: string | WebOrderModifier[];
  notes?: string | null;
}

export interface WebOrder {
  id: string;
  restaurantId: string;
  reference: string;
  status: 'NEW' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'DELIVERED' | string;
  customerName: string;
  customerPhone: string;
  orderType: 'DELIVERY' | 'PICKUP' | string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod?: string | null;
  rejectionReason?: string | null;
  posOrderId?: string | null;
  createdAt: string;
  acceptedAt?: string | null;
  items: WebOrderItem[];
}

export interface WebsiteSettings {
  id: string;
  name: string;
  slug?: string | null;
  websiteSlug?: string | null;
  onlineOrderingEnabled: boolean;
  whatsappNumber?: string | null;
  logoUrl?: string | null;
  websiteCoverUrl?: string | null;
  websiteAbout?: string | null;
  websiteOpeningHours?: string;
  websiteOrderTypes?: string;
  websiteDeliveryFee?: number;
  websiteFreeDeliveryAbove?: number | null;
  websiteMinOrder?: number;
  websitePaymentNote?: string | null;
}

export type OpeningHours = Partial<
  Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', { closed?: boolean; open?: string; close?: string }>
>;

export const webordersApi = {
  getSettings: async (): Promise<WebsiteSettings> => {
    return api.get('/weborders/settings');
  },

  updateSettings: async (
    data: Omit<Partial<WebsiteSettings>, 'websiteOrderTypes'> & { websiteOrderTypes?: string[] }
  ): Promise<WebsiteSettings> => {
    return api.put('/weborders/settings', data);
  },

  testWhatsApp: async (number?: string): Promise<{ whatsappUrl: string; number: string }> => {
    return api.post('/weborders/settings/test-whatsapp', number ? { number } : {});
  },

  listOrders: async (params?: { status?: string; limit?: number }): Promise<WebOrder[]> => {
    return api.get('/weborders/orders', { params });
  },

  getOrder: async (id: string): Promise<WebOrder> => {
    return api.get(`/weborders/orders/${id}`);
  },

  acceptOrder: async (id: string, deliveryFee?: number): Promise<WebOrder> => {
    return api.post(
      `/weborders/orders/${id}/accept`,
      deliveryFee !== undefined ? { deliveryFee } : {}
    );
  },

  rejectOrder: async (id: string, reason: string): Promise<WebOrder> => {
    return api.post(`/weborders/orders/${id}/reject`, { reason });
  },

  markDelivered: async (id: string): Promise<WebOrder> => {
    return api.post(`/weborders/orders/${id}/delivered`);
  },

  replyUrl: async (id: string): Promise<{ whatsappUrl: string }> => {
    return api.get(`/weborders/orders/${id}/reply-url`);
  },
};
