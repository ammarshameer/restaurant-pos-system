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