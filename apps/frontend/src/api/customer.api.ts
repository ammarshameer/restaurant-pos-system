import { api } from '../lib/api';

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  balanceDue?: number;
  creditLimit?: number;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt?: string | null;
}

export interface CustomerList {
  data: Customer[];
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

export const customerApi = {
  list: (params: { page?: number; limit?: number; search?: string }) => api.get<CustomerList>('/customers', { params }),
  get: (id: string) => api.get<any>(`/customers/${id}`),
  create: (data: Partial<Customer>) => api.post<Customer>('/customers', data),
  update: (id: string, data: Partial<Customer>) => api.patch<Customer>(`/customers/${id}`, data),
  delete: (id: string) => api.delete(`/customers/${id}`),
};
