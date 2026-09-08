import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class MenuService {
  async getMenuByRestaurant(restaurantId: string) {
    return prisma.category.findMany({
      where: { restaurantId },
      include: {
        menuItems: {
          include: {
            modifiers: {
              include: {
                modifiers: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getMenuItem(id: string) {
    return prisma.menuItem.findUnique({
      where: { id },
      include: {
        category: true,
        modifiers: {
          include: {
            modifiers: true,
          },
        },
        inventoryItems: true,
      },
    });
  }

  async createMenuItem(data: {
    name: string;
    description?: string;
    price: number;
    cost?: number;
    categoryId?: string;
    categoryName?: string;
    restaurantId: string;
    imageUrl?: string;
    preparationTime?: number;
    isAvailable?: boolean;
    is86d?: boolean;
  }) {
    let resolvedCategoryId = data.categoryId;

    // Check if categoryId exists
    if (resolvedCategoryId) {
      const existing = await prisma.category.findUnique({
        where: { id: resolvedCategoryId },
      });
      if (!existing) {
        // Maybe resolvedCategoryId was actually category name like "Mains"
        const byName = await prisma.category.findFirst({
          where: {
            restaurantId: data.restaurantId,
            name: { equals: resolvedCategoryId },
          },
        });
        if (byName) {
          resolvedCategoryId = byName.id;
        } else {
          // Create category with that name
          const newCat = await prisma.category.create({
            data: {
              name: resolvedCategoryId,
              restaurantId: data.restaurantId,
            },
          });
          resolvedCategoryId = newCat.id;
        }
      }
    } else if (data.categoryName) {
      const byName = await prisma.category.findFirst({
        where: {
          restaurantId: data.restaurantId,
          name: { equals: data.categoryName },
        },
      });
      if (byName) {
        resolvedCategoryId = byName.id;
      } else {
        const newCat = await prisma.category.create({
          data: {
            name: data.categoryName,
            restaurantId: data.restaurantId,
          },
        });
        resolvedCategoryId = newCat.id;
      }
    } else {
      // Find first category or create General
      let firstCat = await prisma.category.findFirst({
        where: { restaurantId: data.restaurantId },
      });
      if (!firstCat) {
        firstCat = await prisma.category.create({
          data: {
            name: 'General',
            restaurantId: data.restaurantId,
          },
        });
      }
      resolvedCategoryId = firstCat.id;
    }

    return prisma.menuItem.create({
      data: {
        name: data.name,
        description: data.description,
        price: data.price,
        cost: data.cost,
        categoryId: resolvedCategoryId,
        restaurantId: data.restaurantId,
        imageUrl: data.imageUrl,
        preparationTime: data.preparationTime,
        isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
        is86d: data.is86d !== undefined ? data.is86d : false,
      },
      include: {
        category: true,
      },
    });
  }

  async updateMenuItem(id: string, data: any) {
    return prisma.menuItem.update({
      where: { id },
      data,
      include: {
        category: true,
      },
    });
  }

  async deleteMenuItem(id: string) {
    return prisma.menuItem.delete({
      where: { id },
    });
  }

  async createCategory(data: {
    name: string;
    restaurantId: string;
    displayOrder?: number;
  }) {
    return prisma.category.create({
      data: {
        name: data.name,
        restaurantId: data.restaurantId,
        displayOrder: data.displayOrder || 0,
      },
    });
  }

  async updateCategory(id: string, data: any) {
    return prisma.category.update({
      where: { id },
      data,
    });
  }

  async deleteCategory(id: string) {
    return prisma.category.delete({
      where: { id },
    });
  }
}