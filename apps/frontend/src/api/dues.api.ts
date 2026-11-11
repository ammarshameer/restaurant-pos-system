import { api } from '../lib/api';

export interface CustomerDueItem {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  balanceDue: number;
  creditLimit: number;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt?: string | null;
}

export interface CustomerLedgerEntryItem {
  id: string;
  customerId: string;
  orderId?: string | null;
  type: 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'REFUND' | string;
  amount: number;
  balanceAfter: number;
  method?: string | null;
  note?: string | null;
  createdAt: string;
  order?: {
    id: string;
    orderNumber: number;
    orderType: string;
    total: number;
    totalPaid: number;
    amountDue: number;
    paymentStatus: string;
  } | null;
}

export interface CustomerStatementResponse {
  customer: CustomerDueItem;
  entries: CustomerLedgerEntryItem[];
  unpaidOrders: any[];
  totalCharged: number;
  totalPaid: number;
  currentBalance: number;
}

export const duesApi = {
  listDues: (params?: { search?: string; page?: number; limit?: number }): Promise<{
    data: CustomerDueItem[];
    page: number;
    limit: number;
    totalCount: number;
    totalOutstanding: number;
    customersWithDues: number;
    hasMore: boolean;
  }> => api.get('/dues', { params }),

  getCustomerStatement: (
    customerId: string,
    params?: { startDate?: string; endDate?: string }
  ): Promise<CustomerStatementResponse> =>
    api.get(`/dues/${customerId}/statement`, { params }),

  receivePayment: (
    customerId: string,
    data: { amount: number; method?: string; note?: string }
  ): Promise<{
    customer: any;
    entry: CustomerLedgerEntryItem;
    balanceAfter: number;
    allocatedOrdersCount: number;
  }> => api.post(`/dues/${customerId}/payments`, data),

  adjustBalance: (
    customerId: string,
    data: { amount: number; note?: string }
  ): Promise<{
    customer: any;
    entry: CustomerLedgerEntryItem;
    balanceAfter: number;
  }> => api.post(`/dues/${customerId}/adjustments`, data),
};

