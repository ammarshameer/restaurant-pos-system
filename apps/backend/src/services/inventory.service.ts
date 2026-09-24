import { PrismaClient } from '@prisma/client';
import { getIO } from '../websocket';

const prisma = new PrismaClient();

export class InventoryService {
  async getInventoryItems(restaurantId: string) {
    return prisma.inventoryItem.findMany({
      where: { restaurantId },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getInventoryItem(id: string) {
    return prisma.inventoryItem.findUnique({
      where: { id },
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

  async updateInventoryItem(id: string, data: any) {
    const item = await prisma.inventoryItem.update({
      where: { id },
      data,
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
    reason?: string
  ) {
    const item = await prisma.inventoryItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new Error('Inventory item not found');
    }

    const newQuantity = Number(item.quantity) + adjustmentQuantity;

    const [updatedItem] = await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id },
        data: {
          quantity: newQuantity,
          lastRestocked: adjustmentQuantity > 0 ? new Date() : item.lastRestocked,
        },
      }),
      prisma.inventoryTransaction.create({
        data: {
          inventoryItemId: id,
          quantity: Math.abs(adjustmentQuantity),
          type,
          reason: reason || `Manual adjustment: ${adjustmentQuantity > 0 ? '+' : ''}${adjustmentQuantity} ${item.unit}`,
        },
      }),
    ]);

    // Check if stock is low
    if (Number(updatedItem.quantity) <= Number(updatedItem.reorderPoint)) {
      this.emitLowStockAlert(updatedItem);
    }

    return updatedItem;
  }

  async deductForMenuItem(
    menuItemId: string | null,
    itemName: string,
    itemQuantity: number,
    orderReason: string,
    restaurantId: string
  ) {
    let resolvedMenuItemId = menuItemId;
    if (!resolvedMenuItemId && itemName) {
      const found = await prisma.menuItem.findFirst({
        where: { name: itemName, restaurantId },
      });
      if (found) {
        resolvedMenuItemId = found.id;
      }
    }

    if (!resolvedMenuItemId) {
      return;
    }

    // 1. Fetch menu item details with explicit MenuItemIngredient relations
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: resolvedMenuItemId },
      include: {
        ingredients: {
          include: {
            inventoryItem: true,
          },
        },
      },
    });

    // 2. If item has zero linked ingredients, that is valid (e.g. bottled drink with no recipe breakdown)
    if (!menuItem || !menuItem.ingredients || menuItem.ingredients.length === 0) {
      return;
    }

    // 3. Deduct inventory for each linked ingredient
    for (const recipeIng of menuItem.ingredients) {
      const invItem = recipeIng.inventoryItem;
      if (!invItem) continue;

      const qtyPerUnit = Number(recipeIng.quantityUsed);
      if (qtyPerUnit <= 0) continue;

      const totalDeduction = qtyPerUnit * itemQuantity;
      const newQty = Math.max(0, Number(invItem.quantity) - totalDeduction);

      const [updated] = await prisma.$transaction([
        prisma.inventoryItem.update({
          where: { id: invItem.id },
          data: {
            quantity: newQty,
          },
        }),
        prisma.inventoryTransaction.create({
          data: {
            inventoryItemId: invItem.id,
            quantity: totalDeduction,
            type: 'USAGE',
            reason: orderReason,
          },
        }),
      ]);

      console.log(
        `✓ [Inventory] Deducted ${totalDeduction} ${invItem.unit} for "${invItem.name}" (Stock: ${invItem.quantity} -> ${newQty}) [${orderReason}]`
      );

      // Emit real-time inventory update
      const io = getIO();
      io?.to(`restaurant:${restaurantId}`).emit('inventory:updated', {
        id: updated.id,
        quantity: Number(updated.quantity),
        name: updated.name,
        unit: updated.unit,
        reorderPoint: Number(updated.reorderPoint),
      });

      if (Number(updated.quantity) <= Number(updated.reorderPoint)) {
        this.emitLowStockAlert(updated);
      }
    }
  }

  async getLowStockItems(restaurantId: string) {
    const allItems = await prisma.inventoryItem.findMany({
      where: { restaurantId },
      orderBy: { quantity: 'asc' },
    });

    return allItems.filter(
      (item) => Number(item.quantity) <= Number(item.reorderPoint)
    );
  }

  async getInventoryTransactions(itemId: string, limit = 50) {
    return prisma.inventoryTransaction.findMany({
      where: { inventoryItemId: itemId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async deleteInventoryItem(id: string) {
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