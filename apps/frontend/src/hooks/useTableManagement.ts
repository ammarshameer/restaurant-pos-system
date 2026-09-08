import { useState, useCallback } from 'react';
import { Table, CreateTableDto, UpdateTableDto, UpdateTableStatusDto } from '../types/table.types';
import { tableApi } from '../api/table.api';

export const useTableManagement = (floorPlanId: string) => {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTables = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await tableApi.getTables(floorPlanId);
      setTables(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tables');
    } finally {
      setLoading(false);
    }
  }, [floorPlanId]);

  const updateTableStatus = useCallback(async (tableId: string, statusUpdate: UpdateTableStatusDto) => {
    try {
      setLoading(true);
      setError(null);
      // Extract just the status value from the DTO
      const updatedTable = await tableApi.updateTableStatus(tableId, statusUpdate.status);
      setTables(prevTables =>
        prevTables.map(table =>
          table.id === tableId ? updatedTable : table
        )
      );
      return updatedTable;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update table status');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const moveTable = useCallback(async (tableId: string, x: number, y: number) => {
    try {
      setLoading(true);
      setError(null);
      const updatedTable = await tableApi.updateTable(tableId, { x, y });
      setTables(prevTables =>
        prevTables.map(table =>
          table.id === tableId ? updatedTable : table
        )
      );
      return updatedTable;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move table');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const bulkMoveTable = useCallback(async (updates: Array<{ id: string; x: number; y: number }>) => {
    try {
      setLoading(true);
      setError(null);
      // Transform flat structure to nested position structure
      const formattedUpdates = updates.map(({ id, x, y }) => ({
        id,
        position: { x, y }
      }));
      const updatedTables = await tableApi.bulkUpdatePositions(formattedUpdates);
      setTables((prevTables: Table[]) => {
        const updatedMap = new Map<string, Table>(updatedTables.map((t) => [t.id, t]));
        return prevTables.map((table) => updatedMap.get(table.id) || table);
      });
      return updatedTables;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk move tables');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createTable = useCallback(async (tableData: CreateTableDto) => {
    try {
      setLoading(true);
      setError(null);
      const newTable = await tableApi.createTable(tableData);
      setTables(prevTables => [...prevTables, newTable]);
      return newTable;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create table');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateTable = useCallback(async (tableId: string, updateData: UpdateTableDto) => {
    try {
      setLoading(true);
      setError(null);
      const updatedTable = await tableApi.updateTable(tableId, updateData);
      setTables(prevTables =>
        prevTables.map(table =>
          table.id === tableId ? updatedTable : table
        )
      );
      return updatedTable;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update table');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteTable = useCallback(async (tableId: string) => {
    try {
      setLoading(true);
      setError(null);
      await tableApi.deleteTable(tableId);
      setTables(prevTables => prevTables.filter(table => table.id !== tableId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete table');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const assignToSection = useCallback(async (tableId: string, sectionId: string) => {
    try {
      setLoading(true);
      setError(null);
      const updatedTable = await tableApi.assignToSection(tableId, sectionId);
      setTables(prevTables =>
        prevTables.map(table =>
          table.id === tableId ? updatedTable : table
        )
      );
      return updatedTable;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign table to section');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    tables,
    loading,
    error,
    fetchTables,
    updateTableStatus,
    moveTable,
    bulkMoveTable,
    createTable,
    updateTable,
    deleteTable,
    assignToSection,
  };
};
