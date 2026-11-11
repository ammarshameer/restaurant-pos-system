import { api } from '../lib/api';

export interface PayrollSettings {
  id: string;
  restaurantId: string;
  workdayHours: number;
  workdaysPerMonth: number;
  overtimeMultiplier: number;
  overtimeApprovalRequired: boolean;
}

export interface EmployeeAdvance {
  id: string;
  employeeId: string;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    username?: string | null;
  };
  amount: number;
  remainingAmount: number;
  monthlyInstalment?: number | null;
  advanceDate: string;
  reason?: string | null;
  status: 'ACTIVE' | 'FULLY_RECOVERED' | 'CANCELLED';
  clientRef?: string | null;
  createdAt: string;
}

export interface PayrollTimeEntry {
  id: string;
  employeeId: string;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    salaryType?: string;
    overtimeEligible?: boolean;
  };
  clockIn: string;
  clockOut?: string | null;
  hoursWorked?: number | null;
  overtimeHours?: number | null;
  overtimeApproved?: boolean | null;
  isCorrected: boolean;
  correctionReason?: string | null;
  createdAt: string;
}

export interface PayrollLineItem {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    username?: string | null;
    role: string;
    salaryType: string;
    monthlySalary?: number | null;
    dailyRate?: number | null;
    hourlyRate?: number | null;
  };
  salaryType: 'MONTHLY' | 'DAILY' | 'HOURLY';
  base: number;
  regularHours: number;
  overtimeHours: number;
  overtimePay: number;
  allowances: number;
  bonus: number;
  deductions: number;
  advanceRecovered: number;
  advanceId?: string | null;
  absentDays: number;
  absenceDeduction: number;
  netPay: number;
  note?: string | null;
}

export interface PayrollRun {
  id: string;
  month: string;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  totalGross: number;
  totalNet: number;
  totalOvertime: number;
  totalDeductions: number;
  totalAdvances: number;
  employeeCount: number;
  finalizedAt?: string | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
  note?: string | null;
  lines?: PayrollLineItem[];
  _count?: { lines: number };
  createdAt: string;
}

export interface Payslip {
  payslipNumber: string;
  month: string;
  runStatus: string;
  paymentMethod: string;
  paidAt?: string | null;
  business?: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    logoUrl?: string | null;
  };
  employee: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    role: string;
    salaryType: string;
  };
  earnings: {
    base: number;
    regularHours: number;
    overtimeHours: number;
    overtimePay: number;
    allowances: number;
    bonus: number;
    totalGross: number;
  };
  deductions: {
    absentDays: number;
    absenceDeduction: number;
    deductions: number;
    advanceRecovered: number;
    totalDeductions: number;
  };
  netPay: number;
  currency: string;
}

export const payrollApi = {
  getSettings: (): Promise<PayrollSettings> =>
    api.get('/payroll/settings'),

  updateSettings: (data: Partial<PayrollSettings>): Promise<PayrollSettings> =>
    api.put('/payroll/settings', data),

  getAdvances: (params?: { employeeId?: string; status?: string; page?: number; limit?: number }): Promise<{
    data: EmployeeAdvance[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> =>
    api.get('/payroll/advances', { params }),

  createAdvance: (data: {
    employeeId: string;
    amount: number;
    monthlyInstalment?: number;
    reason?: string;
    advanceDate?: string;
    clientRef?: string;
  }): Promise<EmployeeAdvance> =>
    api.post('/payroll/advances', data),

  cancelAdvance: (id: string): Promise<EmployeeAdvance> =>
    api.post(`/payroll/advances/${id}/cancel`),

  getTimeEntries: (params?: { month?: string; employeeId?: string; page?: number; limit?: number }): Promise<{
    data: PayrollTimeEntry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> =>
    api.get('/payroll/time-entries', { params }),

  correctTimeEntry: (id: string, data: { clockIn?: string; clockOut?: string; reason: string }): Promise<PayrollTimeEntry> =>
    api.patch(`/payroll/time-entries/${id}`, data),

  approveOvertime: (id: string, approved: boolean): Promise<PayrollTimeEntry> =>
    api.post(`/payroll/time-entries/${id}/approve-overtime`, { approved }),

  getRuns: (params?: { page?: number; limit?: number }): Promise<{
    data: PayrollRun[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> =>
    api.get('/payroll/runs', { params }),

  getRunDetails: (idOrMonth: string): Promise<PayrollRun> =>
    api.get(`/payroll/runs/${idOrMonth}`),

  createOrCalculateDraft: (month: string): Promise<PayrollRun> =>
    api.post('/payroll/runs', { month }),

  updateLine: (lineId: string, data: Partial<PayrollLineItem>): Promise<PayrollRun> =>
    api.patch(`/payroll/lines/${lineId}`, data),

  finalizeRun: (runId: string): Promise<PayrollRun> =>
    api.post(`/payroll/runs/${runId}/finalize`),

  payRun: (runId: string, paymentMethod?: string): Promise<PayrollRun> =>
    api.post(`/payroll/runs/${runId}/pay`, { paymentMethod }),

  getPayslip: (lineId: string): Promise<Payslip> =>
    api.get(`/payroll/lines/${lineId}/payslip`),
};

