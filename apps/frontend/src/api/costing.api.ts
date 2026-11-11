import { api } from '../lib/api';

export interface MissingCostItem {
  id: string;
  name: string;
  type: 'DISH' | 'DEAL';
  count: number;
}

export interface CostingSummary {
  grossSales: number;
  netSales: number;
  discounts: number;
  tax: number;
  serviceCharge: number;
  deliveryCharge: number;
  refunds: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  foodCostPercent: number;
  averageTicket: number;
  transactionCount: number;
  missingCostItems?: MissingCostItem[];
}

export interface MenuCostItem {
  id: string;
  name: string;
  categoryName: string;
  price: number;
  recipeCost: number;
  margin: number;
  marginPercent: number;
  costPercent: number;
  ingredientsCount: number;
}

export interface InventoryValuationItem {
  id: string;
  name: string;
  sku?: string;
  category?: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
  stockValue: number;
  reorderPoint: number;
  isLowStock: boolean;
}

export interface InventoryValuationResponse {
  items: InventoryValuationItem[];
  totalInventoryValue: number;
  lowStockCount: number;
  totalItemsCount: number;
}

export interface CostingTransactionItem {
  id: string;
  orderNumber: number;
  orderType: string;
  customerName?: string;
  total: number;
  cogs: number;
  margin: number;
  marginPercent: number;
  paymentStatus: string;
  createdAt: string;
  itemCount: number;
}

export interface ProfitLossReport {
  month: string;
  currency: string;
  summary: {
    grossSales: number;
    discounts: number;
    refunds: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number;
    totalExpenses: number;
    netProfit: number;
    netMarginPercent: number;
    missingCostItemsCount: number;
  };
  expensesByCategory: Array<{
    categoryId: string;
    categoryName: string;
    isSystem: boolean;
    amount: number;
  }>;
  cashFlowVsDues: {
    totalCashCollected: number;
    regularPayments: number;
    duesPaymentsCollected: number;
    newCreditCharges: number;
    totalOutstandingDues: number;
  };
  payrollLabor: {
    recordedSalariesExpense: number;
    payrollRunStatus: string;
    realLaborCost: number;
    payrollRunId: string | null;
  };
}

export const costingApi = {
  summary: (startDate?: string, endDate?: string): Promise<CostingSummary> =>
    api.get('/costing/summary', { params: { startDate, endDate } }),

  menu: (): Promise<MenuCostItem[]> =>
    api.get('/costing/menu'),

  inventory: (): Promise<InventoryValuationResponse> =>
    api.get('/costing/inventory'),

  transactions: (params?: { page?: number; limit?: number; startDate?: string; endDate?: string }): Promise<{
    data: CostingTransactionItem[];
    page: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  }> =>
    api.get('/costing/transactions', { params }),

  profitLoss: (month?: string): Promise<ProfitLossReport> =>
    api.get('/costing/profit-loss', { params: { month } }),
};

