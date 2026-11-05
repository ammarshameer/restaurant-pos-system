import { PrismaClient } from '@prisma/client';
import { ValidationError } from '../lib/errors';

const prisma = new PrismaClient();

export class CustomerService {
  normalizePhone(phone?: string | null): string | null {
    if (!phone) return null;
    const trimmed = phone.trim();
    const normalized = trimmed.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
    return normalized || null;
  }

  normalizeData(data: any) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > 120) throw new ValidationError('Customer name is required and must be 120 characters or fewer');
    const phone = this.normalizePhone(data.phone);
    if (phone && phone.length > 30) throw new ValidationError('Phone must be 30 characters or fewer');
    return {
      name,
      phone,
      email: typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null,
      address: typeof data.address === 'string' && data.address.trim() ? data.address.trim() : null,
      notes: typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : null,
    };
  }

  async listCustomers(restaurantId: string, options: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.max(1, Number(options.limit) || 20);
    const search = String(options.search || '').trim();
    const where: any = { restaurantId };
    if (search) where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { email: { contains: search } },
    ];
    const [data, totalCount] = await Promise.all([
      prisma.customer.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ lastOrderAt: 'desc' }, { createdAt: 'desc' }] }),
      prisma.customer.count({ where }),
    ]);
    return { data, page, limit, totalCount, hasMore: page * limit < totalCount };
  }

  async getCustomer(id: string, restaurantId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, restaurantId },
      include: { orders: { take: 20, orderBy: { createdAt: 'desc' }, include: { payments: true } } },
    });
    if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
    return customer;
  }

  async createCustomer(restaurantId: string, data: any) {
    const normalized = this.normalizeData(data);
    if (normalized.phone) {
      const duplicate = await prisma.customer.findFirst({ where: { restaurantId, phone: normalized.phone } });
      if (duplicate) throw Object.assign(new Error('A customer with this phone already exists'), { statusCode: 409 });
    }
    return prisma.customer.create({ data: { restaurantId, ...normalized } });
  }

  async updateCustomer(id: string, restaurantId: string, data: any) {
    const existing = await prisma.customer.findFirst({ where: { id, restaurantId } });
    if (!existing) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
    const normalized = this.normalizeData({ ...existing, ...data });
    if (normalized.phone) {
      const duplicate = await prisma.customer.findFirst({ where: { restaurantId, phone: normalized.phone, id: { not: id } } });
      if (duplicate) throw Object.assign(new Error('A customer with this phone already exists'), { statusCode: 409 });
    }
    return prisma.customer.update({ where: { id }, data: normalized });
  }

  async deleteCustomer(id: string, restaurantId: string) {
    const customer = await prisma.customer.findFirst({ where: { id, restaurantId } });
    if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
    await prisma.customer.delete({ where: { id } });
  }

  async recordOrderCustomer(restaurantId: string, order: any) {
    const name = typeof order.customerName === 'string' ? order.customerName.trim() : '';
    const phone = this.normalizePhone(order.customerPhone);
    if (!name && !phone) return null;
    let customer = phone
      ? await prisma.customer.findFirst({ where: { restaurantId, phone } })
      : await prisma.customer.findFirst({ where: { restaurantId, name, phone: null } });
    const now = order.createdAt ? new Date(order.createdAt) : new Date();
    if (!customer) {
      customer = await prisma.customer.create({ data: { restaurantId, name: name || phone!, phone, totalOrders: 1, totalSpent: Number(order.total || 0), lastOrderAt: now } });
    } else {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { ...(name ? { name } : {}), ...(phone ? { phone } : {}), totalOrders: { increment: 1 }, totalSpent: { increment: Number(order.total || 0) }, lastOrderAt: now },
      });
    }
    return customer.id;
  }

  async recalculateCustomerStats(customerId: string, restaurantId: string) {
    const aggregate = await prisma.order.aggregate({ where: { customerId, restaurantId }, _count: true, _sum: { total: true } });
    await prisma.customer.updateMany({
      where: { id: customerId, restaurantId },
      data: { totalOrders: aggregate._count, totalSpent: aggregate._sum.total || 0 },
    });
  }
}
