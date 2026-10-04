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
            ingredients: {
              include: {
                inventoryItem: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getMenuItems(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
      categoryId?: string;
    }
  ) {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = { restaurantId };

    if (options?.categoryId && options.categoryId !== 'All' && options.categoryId !== 'ALL') {
      whereClause.categoryId = options.categoryId;
    } else if (options?.category && options.category !== 'All' && options.category !== 'ALL') {
      whereClause.category = {
        name: options.category,
      };
    }

    if (options?.search && options.search.trim()) {
      const q = options.search.trim();
      whereClause.OR = [
        { name: { contains: q } },
        { description: { contains: q } },
      ];
    }

    const [totalCount, items] = await Promise.all([
      prisma.menuItem.count({ where: whereClause }),
      prisma.menuItem.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          category: true,
          modifiers: {
            include: {
              modifiers: true,
            },
          },
          ingredients: {
            include: {
              inventoryItem: true,
            },
          },
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

  async getMenuItem(id: string, restaurantId?: string) {
    return prisma.menuItem.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
      include: {
        category: true,
        modifiers: {
          include: {
            modifiers: true,
          },
        },
        ingredients: {
          include: {
            inventoryItem: true,
          },
        },
        inventoryItems: true,
      },
    });
  }

  async createMenuItem(data: {
    id?: string;
    name: string;
    description?: string;
    price: number;
    cost?: number;
    category?: string | { id?: string; name?: string };
    categoryId?: string;
    categoryName?: string;
    restaurantId: string;
    imageUrl?: string;
    preparationTime?: number;
    isAvailable?: boolean;
    is86d?: boolean;
    ingredients?: Array<{ inventoryItemId: string; quantityUsed: number }>;
  }) {
    if (!data.restaurantId) {
      throw new Error('restaurantId is required to create a menu item');
    }

    let resolvedCategoryId = data.categoryId;
    const categoryInput =
      data.categoryId ||
      data.categoryName ||
      (typeof data.category === 'string'
        ? data.category
        : data.category?.id || data.category?.name);

    if (categoryInput) {
      const existing = await prisma.category.findFirst({
        where: { id: categoryInput, restaurantId: data.restaurantId },
      });
      if (existing) {
        resolvedCategoryId = existing.id;
      } else {
        const allCats = await prisma.category.findMany({
          where: { restaurantId: data.restaurantId },
        });
        const byName = allCats.find(
          (c) => c.name.toLowerCase() === categoryInput.toLowerCase()
        );
        if (byName) {
          resolvedCategoryId = byName.id;
        } else {
          const newCat = await prisma.category.create({
            data: {
              name: categoryInput,
              restaurantId: data.restaurantId,
            },
          });
          resolvedCategoryId = newCat.id;
        }
      }
    } else {
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

    const validIngredients = (data.ingredients || []).filter(
      (ing) => ing && ing.inventoryItemId && Number(ing.quantityUsed) > 0
    );

    return prisma.menuItem.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        name: data.name,
        description: data.description,
        price: Number(data.price),
        cost: data.cost !== undefined && data.cost !== null ? Number(data.cost) : null,
        categoryId: resolvedCategoryId,
        restaurantId: data.restaurantId,
        imageUrl: data.imageUrl,
        preparationTime: data.preparationTime !== undefined && data.preparationTime !== null ? Number(data.preparationTime) : 10,
        isAvailable: data.isAvailable !== undefined ? Boolean(data.isAvailable) : true,
        is86d: data.is86d !== undefined ? Boolean(data.is86d) : false,
        ingredients:
          validIngredients.length > 0
            ? {
                create: validIngredients.map((ing) => ({
                  inventoryItemId: ing.inventoryItemId,
                  quantityUsed: Number(ing.quantityUsed),
                })),
              }
            : undefined,
      },
      include: {
        category: true,
        ingredients: {
          include: {
            inventoryItem: true,
          },
        },
      },
    });
  }

  async updateMenuItem(id: string, data: any, restaurantId?: string) {
    const existing = await prisma.menuItem.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Menu item not found or unauthorized');
    }

    const currentRestaurantId = existing.restaurantId;
    let resolvedCategoryId: string | undefined = undefined;

    const categoryInput =
      data.categoryId ||
      data.categoryName ||
      (typeof data.category === 'string'
        ? data.category
        : data.category?.id || data.category?.name);

    if (categoryInput) {
      const existingCat = await prisma.category.findFirst({
        where: { id: categoryInput, restaurantId: currentRestaurantId },
      });
      if (existingCat) {
        resolvedCategoryId = existingCat.id;
      } else {
        const allCats = await prisma.category.findMany({
          where: { restaurantId: currentRestaurantId },
        });
        const byName = allCats.find(
          (c) => c.name.toLowerCase() === categoryInput.toLowerCase()
        );
        if (byName) {
          resolvedCategoryId = byName.id;
        } else {
          const newCat = await prisma.category.create({
            data: {
              name: categoryInput,
              restaurantId: currentRestaurantId,
            },
          });
          resolvedCategoryId = newCat.id;
        }
      }
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.price !== undefined) updateData.price = Number(data.price);
    if (data.cost !== undefined) updateData.cost = data.cost !== null ? Number(data.cost) : null;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.preparationTime !== undefined) {
      updateData.preparationTime = data.preparationTime !== null ? Number(data.preparationTime) : null;
    }
    if (data.isAvailable !== undefined) updateData.isAvailable = Boolean(data.isAvailable);
    if (data.is86d !== undefined) updateData.is86d = Boolean(data.is86d);
    if (resolvedCategoryId) updateData.categoryId = resolvedCategoryId;

    return prisma.$transaction(async (tx) => {
      if (data.ingredients !== undefined && Array.isArray(data.ingredients)) {
        // Remove existing relations
        await tx.menuItemIngredient.deleteMany({
          where: { menuItemId: id },
        });

        const validIngredients = data.ingredients.filter(
          (ing: any) => ing && ing.inventoryItemId && Number(ing.quantityUsed) > 0
        );

        if (validIngredients.length > 0) {
          await tx.menuItemIngredient.createMany({
            data: validIngredients.map((ing: any) => ({
              menuItemId: id,
              inventoryItemId: ing.inventoryItemId,
              quantityUsed: Number(ing.quantityUsed),
            })),
          });
        }
      }

      return tx.menuItem.update({
        where: { id },
        data: updateData,
        include: {
          category: true,
          ingredients: {
            include: {
              inventoryItem: true,
            },
          },
        },
      });
    });
  }

  async deleteMenuItem(id: string, restaurantId?: string) {
    const existing = await prisma.menuItem.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Menu item not found or unauthorized');
    }

    return prisma.menuItem.delete({
      where: { id },
    });
  }

  async createCategory(data: {
    name: string;
    restaurantId: string;
    displayOrder?: number;
  }) {
    if (!data.restaurantId) {
      throw new Error('restaurantId is required to create a category');
    }
    return prisma.category.create({
      data: {
        name: data.name,
        restaurantId: data.restaurantId,
        displayOrder: data.displayOrder || 0,
      },
    });
  }

  async updateCategory(id: string, data: any, restaurantId?: string) {
    const existing = await prisma.category.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Category not found or unauthorized');
    }

    const { restaurantId: _, ...updateFields } = data;
    return prisma.category.update({
      where: { id },
      data: updateFields,
    });
  }

  async deleteCategory(id: string, restaurantId?: string) {
    const existing = await prisma.category.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Category not found or unauthorized');
    }

    return prisma.category.delete({
      where: { id },
    });
  }
}