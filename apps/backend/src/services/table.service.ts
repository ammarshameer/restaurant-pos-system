import { PrismaClient } from '@prisma/client';
import { CreateTableDto, UpdateTableDto, UpdateTableStatusDto, TableStatus, TableShape } from '../types/table.types';

const prisma = new PrismaClient();

export class TableService {
  /**
   * Get all tables for a floor plan
   */
  async getTablesByFloorPlan(floorPlanId: string) {
    return prisma.table.findMany({
      where: { floorPlanId },
      include: {
        orders: {
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          include: {
            items: true,
            server: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { number: 'asc' },
    });
  }

  /**
   * Get a single table by ID
   */
  async getTableById(id: string) {
    const table = await prisma.table.findUnique({
      where: { id },
      include: {
        orders: {
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          include: {
            items: {
              include: {
                menuItem: true,
                modifiers: true,
              },
            },
            payments: true,
            server: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!table) {
      throw new Error('Table not found');
    }

    return table;
  }

  /**
   * Create a new table
   */
  async createTable(data: CreateTableDto) {
    // Check if table number already exists in this floor plan
    const existing = await prisma.table.findFirst({
      where: {
        floorPlanId: data.floorPlanId,
        number: data.number,
      },
    });

    if (existing) {
      throw new Error(`Table ${data.number} already exists in this floor plan`);
    }

    return prisma.table.create({
      data: {
        ...data,
        status: 'AVAILABLE',
      },
    });
  }

  /**
   * Update table details (position, capacity, etc.)
   */
  async updateTable(id: string, data: UpdateTableDto) {
    return prisma.table.update({
      where: { id },
      data,
    });
  }

  /**
   * Update table status
   */
  async updateTableStatus(id: string, data: UpdateTableStatusDto) {
    const table = await prisma.table.findUnique({ where: { id } });
    
    if (!table) {
      throw new Error('Table not found');
    }

    // Validate status transitions
    if (data.status === 'OCCUPIED' && !data.currentOrder) {
      throw new Error('Cannot set table to OCCUPIED without an order');
    }

    if (data.status === 'AVAILABLE' && table.currentOrder) {
      throw new Error('Cannot set table to AVAILABLE while it has an active order');
    }

    return prisma.table.update({
      where: { id },
      data: {
        status: data.status,
        currentOrder: data.currentOrder,
      },
    });
  }

  /**
   * Assign table to server section
   */
  async assignTableToSection(id: string, section: string) {
    return prisma.table.update({
      where: { id },
      data: { section },
    });
  }

  /**
   * Bulk update table positions (for drag-and-drop)
   */
  async updateTablePositions(updates: Array<{ id: string; x: number; y: number }>) {
    const operations = updates.map((update) =>
      prisma.table.update({
        where: { id: update.id },
        data: { x: update.x, y: update.y },
      })
    );

    return prisma.$transaction(operations);
  }

  /**
   * Delete a table
   */
  async deleteTable(id: string) {
    const table = await prisma.table.findUnique({
      where: { id },
      include: {
        orders: {
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        },
      },
    });

    if (!table) {
      throw new Error('Table not found');
    }

    if (table.orders.length > 0) {
      throw new Error('Cannot delete table with active orders');
    }

    return prisma.table.delete({
      where: { id },
    });
  }

  /**
   * Get tables by status
   */
  async getTablesByStatus(floorPlanId: string, status: TableStatus) {
    return prisma.table.findMany({
      where: {
        floorPlanId,
        status,
      },
      include: {
        orders: {
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        },
      },
    });
  }

  /**
   * Get available tables for party size
   */
  async getAvailableTablesForParty(floorPlanId: string, partySize: number) {
    return prisma.table.findMany({
      where: {
        floorPlanId,
        status: 'AVAILABLE',
        capacity: { gte: partySize },
        minCapacity: { lte: partySize },
      },
      orderBy: [
        { capacity: 'asc' }, // Prefer smaller tables that fit
        { number: 'asc' },
      ],
    });
  }

  /**
   * Get table occupancy stats
   */
  async getOccupancyStats(floorPlanId: string) {
    const tables = await prisma.table.findMany({
      where: { floorPlanId },
    });

    const totalTables = tables.length;
    const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;
    const dirtyTables = tables.filter((t) => t.status === 'DIRTY').length;
    const availableTables = tables.filter((t) => t.status === 'AVAILABLE').length;

    return {
      total: totalTables,
      occupied: occupiedTables,
      dirty: dirtyTables,
      available: availableTables,
      occupancyRate: totalTables > 0 ? (occupiedTables / totalTables) * 100 : 0,
    };
  }

  /**
   * Calculate average turn time
   */
  async getAverageTurnTime(floorPlanId: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const orders = await prisma.order.findMany({
      where: {
        table: {
          floorPlanId,
        },
        status: 'COMPLETED',
        completedAt: {
          gte: since,
        },
      },
      select: {
        createdAt: true,
        completedAt: true,
      },
    });

    if (orders.length === 0) {
      return null;
    }

    const totalMinutes = orders.reduce((sum, order) => {
      if (!order.completedAt) return sum;
      const duration = order.completedAt.getTime() - order.createdAt.getTime();
      return sum + duration / 1000 / 60; // Convert to minutes
    }, 0);

    return totalMinutes / orders.length;
  }

  /**
   * Combine multiple tables for larger parties
   */
  async combineTables(tableIds: string[]) {
    if (tableIds.length < 2) {
      throw new Error('At least two tables are required to combine');
    }

    const tables = await prisma.table.findMany({
      where: { id: { in: tableIds } },
    });

    if (tables.length !== tableIds.length) {
      throw new Error('One or more tables not found');
    }

    // Set first table as primary occupied and others as occupied
    const primaryTable = tables[0];
    const otherTableIds = tableIds.slice(1);

    await prisma.table.updateMany({
      where: { id: { in: otherTableIds } },
      data: {
        status: 'OCCUPIED',
        section: `Combined with #${primaryTable.number}`,
      },
    });

    return {
      primaryTableId: primaryTable.id,
      combinedTableNumbers: tables.map((t) => t.number),
      totalCapacity: tables.reduce((sum, t) => sum + t.capacity, 0),
    };
  }

  /**
   * Split previously combined table back to individual status
   */
  async splitTable(tableId: string) {
    const table = await prisma.table.findUnique({
      where: { id: tableId },
    });

    if (!table) {
      throw new Error('Table not found');
    }

    return prisma.table.update({
      where: { id: tableId },
      data: {
        status: 'AVAILABLE',
        section: null,
      },
    });
  }
}

export const tableService = new TableService();