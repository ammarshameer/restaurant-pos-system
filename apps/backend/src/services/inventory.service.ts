import { PrismaClient } from '@prisma/client';
import { getIO } from '../websocket';

const prisma = new PrismaClient();

export class InventoryService {
  async getInventoryItems(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
    }
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = { restaurantId };

    if (options?.category && options.category !== 'All' && options.category !== 'ALL') {
      whereClause.category = options.category;
    }

    if (options?.search && options.search.trim()) {
      const q = options.search.trim();
      whereClause.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
      ];
    }

    const [totalCount, items] = await Promise.all([
      prisma.inventoryItem.count({ where: whereClause }),
      prisma.inventoryItem.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          menuItem: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
      data: items,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async getInventoryItem(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    return prisma.inventoryItem.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: {
        menuItem: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  async createInventoryItem(data: {
    name: string;
    restaurantId: string;
    unit: string;
    quantity: number;
    reorderPoint: number;
    costPerUnit: number;
    sku?: string;
    category?: string;
    menuItemId?: string;
  }) {
    if (!data.restaurantId || !data.restaurantId.trim()) {
      throw new Error('restaurantId is required to create an inventory item');
    }

    const item = await prisma.inventoryItem.create({
      data: {
        name: data.name,
        restaurantId: data.restaurantId,
        unit: data.unit,
        quantity: data.quantity,
        reorderPoint: data.reorderPoint,
        costPerUnit: data.costPerUnit,
        sku: data.sku,
        category: data.category,
        menuItemId: data.menuItemId || null,
      },
    });

    // Initial stock transaction
    if (data.quantity > 0) {
      await prisma.inventoryTransaction.create({
        data: {
          inventoryItemId: item.id,
          quantity: data.quantity,
          type: 'RESTOCK',
          reason: 'Initial inventory entry',
        },
      });
    }

    // Check if stock is low
    if (Number(item.quantity) <= Number(item.reorderPoint)) {
      this.emitLowStockAlert(item);
    }

    return item;
  }

  async updateInventoryItem(id: string, data: any, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to update an inventory item');
    }

    const existing = await prisma.inventoryItem.findFirst({
      where: {
        id,
        restaurantId,
      },
    });

    if (!existing) {
      throw new Error('Inventory item not found or unauthorized');
    }

    const { restaurantId: _, ...updateFields } = data;
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: updateFields,
    });

    // Check if stock is low
    if (Number(item.quantity) <= Number(item.reorderPoint)) {
      this.emitLowStockAlert(item);
    }

    return item;
  }

  async adjustStock(
    id: string,
    adjustmentQuantity: number,
    type: 'RESTOCK' | 'USAGE' | 'WASTE' | 'ADJUSTMENT' = 'ADJUSTMENT',
    reason?: string,
    restaurantId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to adjust stock');
    }

    const item = await prisma.inventoryItem.findFirst({
      where: {
        id,
        restaurantId,
      },
    });

    if (!item) {
      throw new Error('Inventory item not found or unauthorized');
    }

    const currentQty = Number(item.quantity);
    const newQty = Math.max(0, +(currentQty + adjustmentQuantity).toFixed(3));

    const [updatedItem] = await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id },
        data: { quantity: newQty },
      }),
      prisma.inventoryTransaction.create({
        data: {
          inventoryItemId: id,
          quantity: adjustmentQuantity,
          type,
          reason: reason || `Manual adjustment: ${adjustmentQuantity > 0 ? '+' : ''}${adjustmentQuantity} ${item.unit}`,
        },
      }),
    ]);

    // Check if stock is low after adjustment
    if (Number(updatedItem.quantity) <= Number(updatedItem.reorderPoint)) {
      this.emitLowStockAlert(updatedItem);
    }

    return updatedItem;
  }

  /**
   * Automatically deduct inventory ingredients when a menu item is ordered
   */
  async deductForMenuItem(
    menuItemId: string | null,
    name: string,
    quantitySold: number,
    reason?: string,
    restaurantId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to deduct for menu item');
    }

    let resolvedMenuItemId = menuItemId;

    if (!resolvedMenuItemId && name) {
      const found = await prisma.menuItem.findFirst({
        where: { name: name.trim(), restaurantId },
      });
      if (found) {
        resolvedMenuItemId = found.id;
      }
    }

    if (!resolvedMenuItemId) return;

    const menuItem = await prisma.menuItem.findFirst({
      where: { id: resolvedMenuItemId, restaurantId },
      include: {
        ingredients: {
          include: {
            inventoryItem: true,
          },
        },
        inventoryItems: true,
      },
    });

    if (!menuItem) return;

    // Deduct explicit recipe ingredients
    if (menuItem.ingredients && menuItem.ingredients.length > 0) {
      for (const recipeItem of menuItem.ingredients) {
        const qtyToDeduct = Number(recipeItem.quantityUsed) * quantitySold;
        const currentQty = Number(recipeItem.inventoryItem.quantity);
        const newQty = Math.max(0, +(currentQty - qtyToDeduct).toFixed(3));

        const [updated] = await prisma.$transaction([
          prisma.inventoryItem.update({
            where: { id: recipeItem.inventoryItemId },
            data: { quantity: newQty },
          }),
          prisma.inventoryTransaction.create({
            data: {
              inventoryItemId: recipeItem.inventoryItemId,
              quantity: -qtyToDeduct,
              type: 'USAGE',
              reason: reason || `Order deduction: ${quantitySold}x ${menuItem.name} (${recipeItem.inventoryItem.name})`,
            },
          }),
        ]);

        if (Number(updated.quantity) <= Number(updated.reorderPoint)) {
          this.emitLowStockAlert(updated);
        }
      }
    } else if (menuItem.inventoryItems && menuItem.inventoryItems.length > 0) {
      // Deduct 1:1 linked inventory items
      for (const invItem of menuItem.inventoryItems) {
        const qtyToDeduct = quantitySold;
        const currentQty = Number(invItem.quantity);
        const newQty = Math.max(0, +(currentQty - qtyToDeduct).toFixed(3));

        const [updated] = await prisma.$transaction([
          prisma.inventoryItem.update({
            where: { id: invItem.id },
            data: { quantity: newQty },
          }),
          prisma.inventoryTransaction.create({
            data: {
              inventoryItemId: invItem.id,
              quantity: -qtyToDeduct,
              type: 'USAGE',
              reason: reason || `Order deduction: ${quantitySold}x ${menuItem.name}`,
            },
          }),
        ]);

        if (Number(updated.quantity) <= Number(updated.reorderPoint)) {
          this.emitLowStockAlert(updated);
        }
      }
    }
  }

  /**
   * Automatically restore inventory ingredients when an order or item is cancelled/restocked
   */
  async restoreForMenuItem(
    menuItemId: string | null,
    name: string,
    quantityRestored: number,
    reason?: string,
    restaurantId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to restore menu item stock');
    }

    let resolvedMenuItemId = menuItemId;

    if (!resolvedMenuItemId && name) {
      const found = await prisma.menuItem.findFirst({
        where: { name: name.trim(), restaurantId },
      });
      if (found) {
        resolvedMenuItemId = found.id;
      }
    }

    if (!resolvedMenuItemId) return;

    const menuItem = await prisma.menuItem.findFirst({
      where: { id: resolvedMenuItemId, restaurantId },
      include: {
        ingredients: {
          include: {
            inventoryItem: true,
          },
        },
        inventoryItems: true,
      },
    });

    if (!menuItem) return;

    // Restore explicit recipe ingredients
    if (menuItem.ingredients && menuItem.ingredients.length > 0) {
      for (const recipeItem of menuItem.ingredients) {
        const qtyToRestore = Number(recipeItem.quantityUsed) * quantityRestored;
        const currentQty = Number(recipeItem.inventoryItem.quantity);
        const newQty = +(currentQty + qtyToRestore).toFixed(3);

        const [updated] = await prisma.$transaction([
          prisma.inventoryItem.update({
            where: { id: recipeItem.inventoryItemId },
            data: { quantity: newQty },
          }),
          prisma.inventoryTransaction.create({
            data: {
              inventoryItemId: recipeItem.inventoryItemId,
              quantity: qtyToRestore,
              type: 'RESTOCK',
              reason: reason || `Restock/Cancellation: ${quantityRestored}x ${menuItem.name} (${recipeItem.inventoryItem.name})`,
            },
          }),
        ]);

        if (Number(updated.quantity) <= Number(updated.reorderPoint)) {
          this.emitLowStockAlert(updated);
        }
      }
    } else if (menuItem.inventoryItems && menuItem.inventoryItems.length > 0) {
      // Restore 1:1 linked inventory items
      for (const invItem of menuItem.inventoryItems) {
        const qtyToRestore = quantityRestored;
        const currentQty = Number(invItem.quantity);
        const newQty = +(currentQty + qtyToRestore).toFixed(3);

        const [updated] = await prisma.$transaction([
          prisma.inventoryItem.update({
            where: { id: invItem.id },
            data: { quantity: newQty },
          }),
          prisma.inventoryTransaction.create({
            data: {
              inventoryItemId: invItem.id,
              quantity: qtyToRestore,
              type: 'RESTOCK',
              reason: reason || `Restock/Cancellation: ${quantityRestored}x ${menuItem.name}`,
            },
          }),
        ]);

        if (Number(updated.quantity) <= Number(updated.reorderPoint)) {
          this.emitLowStockAlert(updated);
        }
      }
    }
  }

  /**
   * Automatically deduct inventory for Deal items
   */
  async deductForDeal(
    dealId: string | null,
    dealName: string,
    quantitySold: number,
    reason?: string,
    restaurantId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to deduct for deal');
    }

    let resolvedDealId = dealId;

    if (!resolvedDealId && dealName) {
      const found = await (prisma as any).deal.findFirst({
        where: { name: dealName.trim(), restaurantId },
      });
      if (found) {
        resolvedDealId = found.id;
      }
    }

    if (!resolvedDealId) return;

    const deal = await (prisma as any).deal.findFirst({
      where: { id: resolvedDealId, restaurantId },
      include: {
        items: {
          include: {
            menuItem: true,
          },
        },
      },
    });

    if (!deal || !deal.items) return;

    for (const dItem of deal.items) {
      const itemQty = Number(dItem.quantity) * quantitySold;
      const subReason = reason
        ? `${reason} (Deal: ${deal.name})`
        : `Deal deduction: ${quantitySold}x ${deal.name} -> ${itemQty}x ${dItem.menuItem?.name || 'Item'}`;
      await this.deductForMenuItem(dItem.menuItemId, dItem.menuItem?.name || '', itemQty, subReason, restaurantId);
    }
  }

  /**
   * Automatically restore inventory for Deal items
   */
  async restoreForDeal(
    dealId: string | null,
    dealName: string,
    quantityRestored: number,
    reason?: string,
    restaurantId?: string
  ) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to restore deal stock');
    }

    let resolvedDealId = dealId;

    if (!resolvedDealId && dealName) {
      const found = await (prisma as any).deal.findFirst({
        where: { name: dealName.trim(), restaurantId },
      });
      if (found) {
        resolvedDealId = found.id;
      }
    }

    if (!resolvedDealId) return;

    const deal = await (prisma as any).deal.findFirst({
      where: { id: resolvedDealId, restaurantId },
      include: {
        items: {
          include: {
            menuItem: true,
          },
        },
      },
    });

    if (!deal || !deal.items) return;

    for (const dItem of deal.items) {
      const itemQty = Number(dItem.quantity) * quantityRestored;
      const subReason = reason
        ? `${reason} (Deal: ${deal.name})`
        : `Deal restock: ${quantityRestored}x ${deal.name} -> ${itemQty}x ${dItem.menuItem?.name || 'Item'}`;
      await this.restoreForMenuItem(dItem.menuItemId, dItem.menuItem?.name || '', itemQty, subReason, restaurantId);
    }
  }

  async getLowStockItems(restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required');
    }

    const allItems = await prisma.inventoryItem.findMany({
      where: { restaurantId },
      orderBy: { quantity: 'asc' },
    });

    return allItems.filter(
      (item) => Number(item.quantity) <= Number(item.reorderPoint)
    );
  }

  async getInventoryTransactions(
    itemIdOrOptions?: string | {
      restaurantId: string;
      page?: number;
      limit?: number;
    },
    options?: {
      restaurantId: string;
      page?: number;
      limit?: number;
    },
    explicitRestaurantId?: string
  ) {
    let itemId: string | undefined;
    let opts: any = options;
    if (typeof itemIdOrOptions === 'string') {
      itemId = itemIdOrOptions;
    } else if (itemIdOrOptions && typeof itemIdOrOptions === 'object') {
      opts = itemIdOrOptions;
      itemId = undefined;
    }

    const restaurantId = explicitRestaurantId || opts?.restaurantId;
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to retrieve inventory transactions');
    }

    const page = Math.max(1, Number(opts?.page) || 1);
    const limit = Math.max(1, Number(opts?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = {
      inventoryItem: { restaurantId },
    };
    if (itemId && itemId !== 'all') {
      whereClause.inventoryItemId = itemId;
    }

    const [totalCount, transactions] = await Promise.all([
      prisma.inventoryTransaction.count({ where: whereClause }),
      prisma.inventoryTransaction.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          inventoryItem: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
      data: transactions,
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async deleteInventoryItem(id: string, restaurantId: string) {
    if (!restaurantId || !restaurantId.trim()) {
      throw new Error('restaurantId is required to delete an inventory item');
    }

    const existing = await prisma.inventoryItem.findFirst({
      where: {
        id,
        restaurantId,
      },
    });

    if (!existing) {
      throw new Error('Inventory item not found or unauthorized');
    }

    return prisma.inventoryItem.delete({
      where: { id },
    });
  }

  emitLowStockAlert(item: any) {
    const io = getIO();
    io?.to(`restaurant:${item.restaurantId}`).emit('inventory:alert', {
      itemId: item.id,
      name: item.name,
      quantity: Number(item.quantity),
      reorderPoint: Number(item.reorderPoint),
      unit: item.unit,
      message: `⚠️ Low Stock Alert: ${item.name} is running low (${Number(item.quantity)} ${item.unit} remaining, reorder threshold is ${Number(item.reorderPoint)})`,
    });
  }
}