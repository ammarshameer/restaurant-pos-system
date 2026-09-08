import { api } from '../lib/api';
import { Table, TableStatus } from '../types/table.types';

const DEFAULT_FLOOR_PLAN_ID = 'fp-default-1';

export const tableApi = {
  getTables: async (floorPlanId = DEFAULT_FLOOR_PLAN_ID): Promise<Table[]> => {
    try {
      const tables = await api.get<Table[]>(`/tables/floor/${floorPlanId}`);
      if (Array.isArray(tables)) {
        return tables.map((t: any) => ({
          ...t,
          capacity: Number(t.capacity || 4),
          x: Number(t.x || 0),
          y: Number(t.y || 0),
          width: Number(t.width || 100),
          height: Number(t.height || 100),
          serverName: t.orders?.[0]?.server ? `${t.orders[0].server.firstName} ${t.orders[0].server.lastName}` : undefined,
          activeOrderTotal: t.orders?.[0]?.total ? Number(t.orders[0].total) : undefined,
        }));
      }
    } catch (err) {
      console.warn('Failed to fetch tables from API:', err);
    }
    return [];
  },

  getTable: async (id: string): Promise<Table | null> => {
    try {
      return await api.get<Table>(`/tables/${id}`);
    } catch (err) {
      console.warn('Failed to fetch table from API:', err);
      return null;
    }
  },

  createTable: async (data: Partial<Table>, floorPlanId = DEFAULT_FLOOR_PLAN_ID): Promise<Table> => {
    return api.post<Table>('/tables', {
      ...data,
      floorPlanId: data.floorPlanId || floorPlanId,
    });
  },

  updateTable: async (id: string, data: Partial<Table>): Promise<Table> => {
    return api.patch<Table>(`/tables/${id}`, data);
  },

  updateTableStatus: async (id: string, status: TableStatus): Promise<Table> => {
    return api.patch<Table>(`/tables/${id}/status`, { status });
  },

  deleteTable: async (id: string): Promise<void> => {
    await api.delete(`/tables/${id}`);
  },

  getTablesByFloorPlan: async (floorPlanId = DEFAULT_FLOOR_PLAN_ID): Promise<Table[]> => {
    return tableApi.getTables(floorPlanId);
  },

  assignToSection: async (tableId: string, sectionId: string): Promise<Table> => {
    return api.patch<Table>(`/tables/${tableId}`, { section: sectionId });
  },

  bulkUpdatePositions: async (
    positions: { id: string; position: { x: number; y: number } }[]
  ): Promise<Table[]> => {
    const results = await Promise.all(
      positions.map((p) =>
        api.patch<Table>(`/tables/${p.id}`, { x: p.position.x, y: p.position.y })
      )
    );
    return results;
  },
};
