import { api } from '../lib/api';
import { PaginatedResponse } from '../types/pagination';

const DEFAULT_RESTAURANT_ID = 'rest-default-1';

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'SERVER' | 'BARTENDER' | 'HOST' | 'KITCHEN' | 'CASHIER';
  hourlyRate: number;
  pin: string;
  phone?: string;
  isActive: boolean;
  isClockedIn?: boolean;
  clockInTime?: string;
}

export interface Shift {
  id: string;
  employeeId?: string;
  employeeName: string;
  role: string;
  clockIn: string;
  clockOut?: string;
  hoursWorked?: number;
  laborCost?: number;
}

function mapEmployee(e: any): Employee {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    role: e.role,
    hourlyRate: Number(e.hourlyRate || 0),
    pin: e.pin,
    phone: e.phone,
    isActive: Boolean(e.isActive),
    isClockedIn: Boolean(e.isClockedIn || (e.timeEntries && e.timeEntries.some((te: any) => !te.clockOut))),
    clockInTime: e.timeEntries?.find((te: any) => !te.clockOut)?.clockIn
      ? new Date(e.timeEntries.find((te: any) => !te.clockOut).clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : undefined,
  };
}

export const employeeApi = {
  getEmployeesPaginated: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    restaurantId?: string;
  }): Promise<PaginatedResponse<Employee>> => {
    try {
      const restaurantId = params?.restaurantId || DEFAULT_RESTAURANT_ID;
      const res: any = await api.get(`/employees/restaurant/${restaurantId}`, {
        page: params?.page || 1,
        limit: params?.limit || 50,
        search: params?.search || undefined,
        role: params?.role || undefined,
      });

      if (res && res.data && Array.isArray(res.data)) {
        return {
          data: res.data.map(mapEmployee),
          page: res.page || 1,
          limit: res.limit || 50,
          totalCount: res.totalCount || res.data.length,
          hasMore: Boolean(res.hasMore),
        };
      }

      if (Array.isArray(res)) {
        return {
          data: res.map(mapEmployee),
          page: 1,
          limit: res.length,
          totalCount: res.length,
          hasMore: false,
        };
      }
    } catch (err) {
      console.warn('Failed to fetch paginated employees:', err);
    }

    return {
      data: [],
      page: params?.page || 1,
      limit: params?.limit || 50,
      totalCount: 0,
      hasMore: false,
    };
  },

  getEmployees: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<Employee[]> => {
    try {
      const res: any = await api.get(`/employees/restaurant/${restaurantId}`, { page: 1, limit: 100 });
      const list = res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      return list.map(mapEmployee);
    } catch (err) {
      console.warn('Failed to fetch employees from API:', err);
    }
    return [];
  },

  getEmployee: async (id: string): Promise<Employee | null> => {
    try {
      return await api.get<Employee>(`/employees/${id}`);
    } catch (err) {
      console.warn('Failed to fetch employee from API:', err);
      return null;
    }
  },

  createEmployee: async (
    data: Partial<Employee>,
    restaurantId = DEFAULT_RESTAURANT_ID
  ): Promise<Employee | null> => {
    try {
      return await api.post<Employee>('/employees', {
        ...data,
        restaurantId,
      });
    } catch (err) {
      console.error('Failed to create employee via API:', err);
      throw err;
    }
  },

  updateEmployee: async (id: string, data: Partial<Employee>): Promise<Employee | null> => {
    try {
      return await api.patch<Employee>(`/employees/${id}`, data);
    } catch (err) {
      console.error('Failed to update employee via API:', err);
      throw err;
    }
  },

  clockIn: async (id: string): Promise<any> => {
    return api.post(`/employees/${id}/clock-in`);
  },

  clockOut: async (id: string): Promise<any> => {
    return api.post(`/employees/${id}/clock-out`);
  },

  getActiveShifts: async (restaurantId = DEFAULT_RESTAURANT_ID): Promise<Shift[]> => {
    try {
      const shifts: any = await api.get(`/employees/restaurant/${restaurantId}/active-shifts`);
      if (Array.isArray(shifts)) {
        return shifts.map((s) => ({
          id: s.id,
          employeeId: s.employeeId,
          employeeName: s.employee ? `${s.employee.firstName} ${s.employee.lastName}` : 'Staff',
          role: s.employee?.role || 'SERVER',
          clockIn: new Date(s.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          clockOut: s.clockOut ? new Date(s.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
          hoursWorked: s.hoursWorked ? Number(s.hoursWorked) : undefined,
          laborCost: s.hoursWorked && s.employee?.hourlyRate ? +(s.hoursWorked * s.employee.hourlyRate).toFixed(2) : undefined,
        }));
      }
    } catch (err) {
      console.warn('Failed to fetch active shifts from API:', err);
    }
    return [];
  },

  getShifts: async (id: string, startDate?: string, endDate?: string): Promise<Shift[]> => {
    try {
      const shifts: any = await api.get(`/employees/${id}/shifts`, { startDate, endDate });
      if (Array.isArray(shifts)) {
        return shifts.map((s) => ({
          id: s.id,
          employeeId: s.employeeId,
          employeeName: s.employee ? `${s.employee.firstName} ${s.employee.lastName}` : 'Staff',
          role: s.employee?.role || 'SERVER',
          clockIn: new Date(s.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          clockOut: s.clockOut ? new Date(s.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
          hoursWorked: s.hoursWorked ? Number(s.hoursWorked) : undefined,
          laborCost: s.hoursWorked && s.employee?.hourlyRate ? +(s.hoursWorked * s.employee.hourlyRate).toFixed(2) : undefined,
        }));
      }
    } catch (err) {
      console.warn('Failed to fetch shifts from API:', err);
    }
    return [];
  },
};
