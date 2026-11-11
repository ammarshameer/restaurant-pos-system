import { api } from '../lib/api';

export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface ExpenseItem {
  id: string;
  categoryId: string;
  category?: {
    id: string;
    name: string;
    isSystem: boolean;
  };
  expenseDate: string;
  amount: number;
  method: string;
  payee?: string | null;
  referenceNo?: string | null;
  billingPeriod?: string | null;
  dueDate?: string | null;
  status: 'PAID' | 'UNPAID';
  paidAt?: string | null;
  note?: string | null;
  billPhotoUrl?: string | null;
  source: 'MANUAL' | 'PAYROLL' | 'RECURRING';
  voidedAt?: string | null;
  voidReason?: string | null;
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  createdAt: string;
}

export interface ExpensesSummary {
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  byCategory: Array<{
    categoryId: string;
    name: string;
    amount: number;
  }>;
}

export interface ExpensesResponse {
  data: ExpenseItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: ExpensesSummary;
}

export interface RecurringTemplate {
  id: string;
  categoryId: string;
  category?: {
    id: string;
    name: string;
  };
  name: string;
  amount: number;
  method: string;
  payee?: string | null;
  dayOfMonth: number;
  note?: string | null;
  isActive: boolean;
  lastGeneratedMonth?: string | null;
}

export const expensesApi = {
  getCategories: (): Promise<ExpenseCategory[]> =>
    api.get('/expenses/categories'),

  createCategory: (data: { name: string; description?: string }): Promise<ExpenseCategory> =>
    api.post('/expenses/categories', data),

  deleteCategory: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/expenses/categories/${id}`),

  getExpenses: (params?: {
    page?: number;
    limit?: number;
    month?: string;
    startDate?: string;
    endDate?: string;
    categoryId?: string;
    status?: string;
    source?: string;
    search?: string;
    includeVoided?: boolean;
  }): Promise<ExpensesResponse> =>
    api.get('/expenses', { params }),

  getExpenseById: (id: string): Promise<ExpenseItem> =>
    api.get(`/expenses/${id}`),

  createExpense: (data: {
    categoryId: string;
    expenseDate: string;
    amount: number;
    method?: string;
    payee?: string;
    referenceNo?: string;
    billingPeriod?: string;
    dueDate?: string;
    status?: 'PAID' | 'UNPAID';
    paidAt?: string;
    note?: string;
    billPhotoUrl?: string;
    clientRef?: string;
  }): Promise<ExpenseItem> =>
    api.post('/expenses', data),

  markPaid: (id: string, data?: { method?: string; paidAt?: string }): Promise<ExpenseItem> =>
    api.patch(`/expenses/${id}/pay`, data || {}),

  voidExpense: (id: string, reason: string): Promise<ExpenseItem> =>
    api.post(`/expenses/${id}/void`, { reason }),

  getRecurringTemplates: (): Promise<RecurringTemplate[]> =>
    api.get('/expenses/recurring/templates'),

  createRecurringTemplate: (data: {
    categoryId: string;
    name: string;
    amount: number;
    method?: string;
    payee?: string;
    dayOfMonth?: number;
    note?: string;
  }): Promise<RecurringTemplate> =>
    api.post('/expenses/recurring/templates', data),

  updateRecurringTemplate: (id: string, data: Partial<RecurringTemplate>): Promise<RecurringTemplate> =>
    api.patch(`/expenses/recurring/templates/${id}`, data),

  deleteRecurringTemplate: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/expenses/recurring/templates/${id}`),

  generateRecurring: (month?: string): Promise<{ generated: number; expenses: ExpenseItem[] }> =>
    api.post('/expenses/recurring/generate', { month }),
};

