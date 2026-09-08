import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Table, TableStatus } from '../../types/table.types';
import { tableApi } from '../../api/table.api';

interface TableState {
  tables: Table[];
  selectedTable: Table | null;
  loading: boolean;
  error: string | null;
}

const initialState: TableState = {
  tables: [],
  selectedTable: null,
  loading: false,
  error: null,
};

// Async thunks
export const fetchTables = createAsyncThunk(
  'tables/fetchTables',
  async (floorPlanId: string) => {
    return await tableApi.getTables(floorPlanId);
  }
);

export const fetchTable = createAsyncThunk(
  'tables/fetchTable',
  async (id: string) => {
    return await tableApi.getTable(id);
  }
);

export const createTable = createAsyncThunk(
  'tables/createTable',
  async (tableData: Partial<Table>) => {
    return await tableApi.createTable(tableData);
  }
);

export const updateTable = createAsyncThunk(
  'tables/updateTable',
  async ({ id, data }: { id: string; data: Partial<Table> }) => {
    return await tableApi.updateTable(id, data);
  }
);

export const updateTableStatusAsync = createAsyncThunk(
  'tables/updateTableStatus',
  async ({ id, status }: { id: string; status: TableStatus }) => {
    return await tableApi.updateTableStatus(id, status);
  }
);

export const updateTablePosition = createAsyncThunk(
  'tables/updateTablePosition',
  async ({ id, data }: { id: string; data: Partial<Table> }) => {
    return await tableApi.updateTable(id, data);
  }
);

export const deleteTable = createAsyncThunk(
  'tables/deleteTable',
  async (id: string) => {
    await tableApi.deleteTable(id);
    return id;
  }
);

export const bulkUpdatePositions = createAsyncThunk(
  'tables/bulkUpdatePositions',
  async (positions: { id: string; position: { x: number; y: number } }[]) => {
    return await tableApi.bulkUpdatePositions(positions);
  }
);

const tableSlice = createSlice({
  name: 'tables',
  initialState,
  reducers: {
    selectTable: (state, action: PayloadAction<Table | null>) => {
      state.selectedTable = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    optimisticUpdatePosition: (state, action: PayloadAction<{ id: string; x: number; y: number }>) => {
      const table = state.tables.find(t => t.id === action.payload.id);
      if (table) {
        table.x = action.payload.x;
        table.y = action.payload.y;
      }
      if (state.selectedTable && state.selectedTable.id === action.payload.id) {
        state.selectedTable.x = action.payload.x;
        state.selectedTable.y = action.payload.y;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch tables
      .addCase(fetchTables.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTables.fulfilled, (state, action) => {
        state.loading = false;
        state.tables = action.payload;
      })
      .addCase(fetchTables.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch tables';
      })
      // Fetch single table
      .addCase(fetchTable.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTable.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedTable = action.payload;
      })
      .addCase(fetchTable.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch table';
      })
      // Create table
      .addCase(createTable.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createTable.fulfilled, (state, action) => {
        state.loading = false;
        state.tables.push(action.payload);
      })
      .addCase(createTable.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to create table';
      })
      // Update table
      .addCase(updateTable.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateTable.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.tables.findIndex(t => t.id === action.payload.id);
        if (index !== -1) {
          state.tables[index] = action.payload;
        }
        if (state.selectedTable?.id === action.payload.id) {
          state.selectedTable = action.payload;
        }
      })
      .addCase(updateTable.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to update table';
      })
      // Update table status
      .addCase(updateTableStatusAsync.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateTableStatusAsync.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.tables.findIndex(t => t.id === action.payload.id);
        if (index !== -1) {
          state.tables[index] = action.payload;
        }
        if (state.selectedTable?.id === action.payload.id) {
          state.selectedTable = action.payload;
        }
      })
      .addCase(updateTableStatusAsync.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to update table status';
      })
      // Update table position
      .addCase(updateTablePosition.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateTablePosition.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.tables.findIndex(t => t.id === action.payload.id);
        if (index !== -1) {
          state.tables[index] = action.payload;
        }
        if (state.selectedTable?.id === action.payload.id) {
          state.selectedTable = action.payload;
        }
      })
      .addCase(updateTablePosition.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to update table position';
      })
      // Delete table
      .addCase(deleteTable.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteTable.fulfilled, (state, action) => {
        state.loading = false;
        state.tables = state.tables.filter(t => t.id !== action.payload);
        if (state.selectedTable?.id === action.payload) {
          state.selectedTable = null;
        }
      })
      .addCase(deleteTable.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to delete table';
      })
      // Bulk update positions
      .addCase(bulkUpdatePositions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(bulkUpdatePositions.fulfilled, (state, action) => {
        state.loading = false;
        action.payload.forEach(updatedTable => {
          const index = state.tables.findIndex(t => t.id === updatedTable.id);
          if (index !== -1) {
            state.tables[index] = updatedTable;
          }
        });
      })
      .addCase(bulkUpdatePositions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to bulk update positions';
      });
  },
});

export const { selectTable, clearError, optimisticUpdatePosition } = tableSlice.actions;
export default tableSlice.reducer;
