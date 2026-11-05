import { api } from '../lib/api';

export const accountingApi = {
  summary: (startDate: string, endDate: string) => api.get('/accounting/summary', { params: { startDate, endDate } }),
  transactions: (params: { page: number; limit: number; startDate: string; endDate: string }) =>
    api.get('/accounting/transactions', { params }),
};
