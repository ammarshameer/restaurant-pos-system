import { Table, TableStatus } from '../types/table.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const getHeaders = (extraHeaders?: Record<string, string>) => {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
};

export const tableApi = {
  async getTables(floorPlanId: string): Promise<Table[]> {
    const response = await fetch(`${API_BASE_URL}/api/tables?floorPlanId=${floorPlanId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch tables');
    return response.json();
  },

  async getTable(id: string): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${id}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch table');
    return response.json();
  },

  async createTable(data: Partial<Table>): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create table');
    return response.json();
  },

  async updateTable(id: string, data: Partial<Table>): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update table');
    return response.json();
  },

  async updateTableStatus(id: string, status: TableStatus): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${id}/status`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error('Failed to update table status');
    return response.json();
  },

  async deleteTable(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete table');
  },

  async updateTablePosition(id: string, x: number, y: number): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${id}/position`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ x, y }),
    });
    if (!response.ok) throw new Error('Failed to update table position');
    return response.json();
  },

  async updateTableRotation(id: string, rotation: number): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${id}/rotation`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ rotation }),
    });
    if (!response.ok) throw new Error('Failed to update table rotation');
    return response.json();
  },

  async bulkUpdateTables(updates: Array<{ id: string; data: Partial<Table> }>): Promise<Table[]> {
    const response = await fetch(`${API_BASE_URL}/api/tables/bulk`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ updates }),
    });
    if (!response.ok) throw new Error('Failed to bulk update tables');
    return response.json();
  },

  async assignOrder(tableId: string, orderId: string): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${tableId}/order`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ orderId }),
    });
    if (!response.ok) throw new Error('Failed to assign order to table');
    return response.json();
  },

  async unassignOrder(tableId: string): Promise<Table> {
    const response = await fetch(`${API_BASE_URL}/api/tables/${tableId}/order`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to unassign order from table');
    return response.json();
  },
};
