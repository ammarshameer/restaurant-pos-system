import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const formatDealResponse = (deal: any) => {
  if (!deal) return deal;
  const itemsList = deal.items || deal.dealItems || [];
  return {
    ...deal,
    items: itemsList,
    dealItems: itemsList,
  };
};

export class DealService {
  async getDeals(
    restaurantId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: boolean;
    }
  ) {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 50);
    const skip = (page - 1) * limit;

    const whereClause: any = { restaurantId };

    if (options?.isActive !== undefined) {
      whereClause.isActive = options.isActive;
    }

    if (options?.search && options.search.trim()) {
      const q = options.search.trim();
      whereClause.OR = [
        { name: { contains: q } },
        { description: { contains: q } },
      ];
    }

    const [totalCount, items] = await Promise.all([
      prisma.deal.count({ where: whereClause }),
      prisma.deal.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          items: {
            include: {
              menuItem: {
                include: {
                  category: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
      data: items.map(formatDealResponse),
      page,
      limit,
      totalCount,
      hasMore,
    };
  }

  async getActiveDeals(restaurantId: string) {
    const deals = await prisma.deal.findMany({
      where: {
        restaurantId,
        isActive: true,
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return deals.map(formatDealResponse);
  }

  async getDealById(id: string, restaurantId?: string) {
    const deal = await prisma.deal.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    return formatDealResponse(deal);
  }

  async createDeal(data: {
    id?: string;
    name: string;
    description?: string;
    price: number;
    isActive?: boolean;
    imageUrl?: string;
    restaurantId: string;
    items?: any[];
    dealItems?: any[];
  }) {
    const restaurantId = data.restaurantId;
    if (!restaurantId) {
      throw new Error('restaurantId is required to create a deal');
    }

    const rawList = data.items || data.dealItems || [];
    const validItems = rawList.filter(
      (item: any) => item && item.menuItemId && Number(item.quantity) > 0
    );

    const created = await prisma.deal.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        name: (data.name || '').trim(),
        description: data.description?.trim() || null,
        price: Number(data.price),
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
        imageUrl: data.imageUrl?.trim() || null,
        restaurantId,
        items:
          validItems.length > 0
            ? {
                create: validItems.map((item: any) => ({
                  menuItemId: item.menuItemId,
                  quantity: Number(item.quantity),
                })),
              }
            : undefined,
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    return formatDealResponse(created);
  }

  async updateDeal(id: string, data: any, restaurantId?: string) {
    const existing = await prisma.deal.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Deal not found or unauthorized');
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = (data.name || '').trim();
    if (data.description !== undefined) updateData.description = data.description?.trim() || null;
    if (data.price !== undefined) updateData.price = Number(data.price);
    if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl?.trim() || null;

    return prisma.$transaction(async (tx) => {
      const itemsList = data.items !== undefined ? data.items : data.dealItems;
      if (itemsList !== undefined && Array.isArray(itemsList)) {
        await tx.dealItem.deleteMany({
          where: { dealId: id },
        });

        const validItems = itemsList.filter(
          (item: any) => item && item.menuItemId && Number(item.quantity) > 0
        );

        if (validItems.length > 0) {
          await tx.dealItem.createMany({
            data: validItems.map((item: any) => ({
              dealId: id,
              menuItemId: item.menuItemId,
              quantity: Number(item.quantity),
            })),
          });
        }
      }

      const updated = await tx.deal.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              menuItem: {
                include: {
                  category: true,
                },
              },
            },
          },
        },
      });

      return formatDealResponse(updated);
    });
  }

  async toggleDealActive(id: string, isActive?: boolean, restaurantId?: string) {
    const existing = await prisma.deal.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Deal not found or unauthorized');
    }

    const nextState =
      typeof isActive === 'boolean'
        ? isActive
        : !existing.isActive;

    const updated = await prisma.deal.update({
      where: { id },
      data: { isActive: nextState },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    return formatDealResponse(updated);
  }

  async deleteDeal(id: string, restaurantId?: string) {
    const existing = await prisma.deal.findFirst({
      where: {
        id,
        ...(restaurantId ? { restaurantId } : {}),
      },
    });

    if (!existing) {
      throw new Error('Deal not found or unauthorized');
    }

    return prisma.deal.delete({
      where: { id },
    });
  }
}

export const dealService = new DealService();
