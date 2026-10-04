import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export type EmployeeRole = 'ADMIN' | 'MANAGER' | 'SERVER' | 'KITCHEN' | 'CASHIER' | string;

const prisma = new PrismaClient();

export class AuthService {
  private JWT_SECRET = process.env.JWT_SECRET || 'secret';
  private JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret';
  private JWT_EXPIRES_IN = '24h'; // Convenient for POS shifts
  private JWT_REFRESH_EXPIRES_IN = '7d';

  async onboardRestaurant(data: {
    restaurantName: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    adminEmail: string;
    adminPassword: string;
    adminFirstName: string;
    adminLastName: string;
    adminPin?: string;
    adminPhone?: string;
  }) {
    const existingUser = await prisma.employee.findUnique({
      where: { email: data.adminEmail.trim().toLowerCase() },
    });

    if (existingUser) {
      throw new Error('An account with this administrator email already exists.');
    }

    const hashedPassword = await bcrypt.hash(data.adminPassword, 10);
    const pin = data.adminPin || '1234';

    return prisma.$transaction(async (tx) => {
      // 1. Create Restaurant record
      const restaurant = await tx.restaurant.create({
        data: {
          name: data.restaurantName.trim(),
          address: data.address?.trim() || 'Default Address',
          phone: data.phone?.trim() || '+1234567890',
          email: data.email?.trim() || data.adminEmail.trim().toLowerCase(),
          timezone: data.timezone || 'Asia/Karachi',
        },
      });

      // 2. Create initial Admin Employee
      const adminUser = await tx.employee.create({
        data: {
          email: data.adminEmail.trim().toLowerCase(),
          passwordHash: hashedPassword,
          firstName: data.adminFirstName.trim(),
          lastName: data.adminLastName.trim(),
          restaurantId: restaurant.id,
          role: 'ADMIN',
          pin,
          phone: data.adminPhone || data.phone,
          hourlyRate: 25.0,
          isActive: true,
        },
      });

      // 3. Create starter menu categories
      const starterCategories = ['Burgers & Fast Food', 'Pizzas & Platters', 'Beverages & Drinks', 'Desserts'];
      for (let i = 0; i < starterCategories.length; i++) {
        await tx.category.create({
          data: {
            name: starterCategories[i],
            displayOrder: i + 1,
            restaurantId: restaurant.id,
          },
        });
      }

      // 4. Create default floor plan and starter tables
      const floorPlan = await tx.floorPlan.create({
        data: {
          name: 'Main Dining Hall',
          restaurantId: restaurant.id,
          layout: JSON.stringify({ grid: 12 }),
          isActive: true,
        },
      });

      for (let t = 1; t <= 4; t++) {
        await tx.table.create({
          data: {
            number: `T-${t}`,
            floorPlanId: floorPlan.id,
            capacity: 4,
            minCapacity: 1,
            x: (t - 1) * 120 + 20,
            y: 50,
            status: 'AVAILABLE',
          },
        });
      }

      // 5. Generate tokens
      const { accessToken, refreshToken } = this.generateTokens({
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
        restaurantId: restaurant.id,
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await tx.refreshToken.create({
        data: {
          token: refreshToken,
          employeeId: adminUser.id,
          expiresAt,
        },
      });

      return {
        message: 'Restaurant onboarded successfully',
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          address: restaurant.address,
          phone: restaurant.phone,
          email: restaurant.email,
        },
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
        },
        accessToken,
        refreshToken,
      };
    });
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    restaurantId: string;
    role?: EmployeeRole;
    pin?: string;
  }) {
    const existingUser = await prisma.employee.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await prisma.employee.create({
      data: {
        email: data.email,
        passwordHash: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        restaurantId: data.restaurantId,
        role: data.role || 'SERVER',
        pin: data.pin || '1234',
        isActive: true,
      },
      include: {
        restaurant: true,
      },
    });

    const { accessToken, refreshToken } = this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      restaurantId: user.restaurantId,
    });

    await this.saveRefreshToken(user.id, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        restaurantId: user.restaurantId,
        restaurantName: user.restaurant?.name,
      },
      accessToken,
      refreshToken,
    };
  }

  async login(email: string, password: string) {
    const user = await prisma.employee.findUnique({
      where: { email },
      include: {
        restaurant: true,
      },
    });

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    const { accessToken, refreshToken } = this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      restaurantId: user.restaurantId,
    });

    await this.saveRefreshToken(user.id, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        restaurantId: user.restaurantId,
        restaurantName: user.restaurant?.name,
      },
      accessToken,
      refreshToken,
    };
  }

  async loginWithPin(pin: string, restaurantId?: string) {
    const where: any = { pin, isActive: true };
    if (restaurantId) where.restaurantId = restaurantId;

    const user = await prisma.employee.findFirst({
      where,
      include: {
        restaurant: true,
      },
    });

    if (!user) {
      throw new Error('Invalid PIN');
    }

    const { accessToken, refreshToken } = this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      restaurantId: user.restaurantId,
    });

    await this.saveRefreshToken(user.id, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        restaurantId: user.restaurantId,
        restaurantName: user.restaurant?.name,
      },
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, this.JWT_REFRESH_SECRET) as any;

      const storedToken = await prisma.refreshToken.findFirst({
        where: {
          token: refreshToken,
          employeeId: decoded.id,
          expiresAt: { gt: new Date() },
        },
      });

      if (!storedToken) {
        throw new Error('Invalid refresh token');
      }

      const user = await prisma.employee.findUnique({
        where: { id: decoded.id },
      });

      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      const { accessToken, refreshToken: newRefreshToken } = this.generateTokens({
        id: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId,
      });

      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      await this.saveRefreshToken(user.id, newRefreshToken);

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as any;
      const user = await prisma.employee.findUnique({
        where: { id: decoded.id },
        include: { restaurant: true },
      });

      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        restaurantId: user.restaurantId,
        restaurantName: user.restaurant?.name,
      };
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  private generateTokens(payload: {
    id: string;
    email: string;
    role: string;
    restaurantId?: string;
  }) {
    const accessToken = jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: '24h',
    } as jwt.SignOptions);

    const refreshToken = jwt.sign(payload, this.JWT_REFRESH_SECRET, {
      expiresIn: '7d',
    } as jwt.SignOptions);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(employeeId: string, token: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token,
        employeeId,
        expiresAt,
      },
    });
  }
}