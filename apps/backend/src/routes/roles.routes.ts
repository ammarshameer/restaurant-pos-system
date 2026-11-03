import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';
import { PERMISSIONS, slugify } from '../permissions';

const router = Router();
const prisma = new PrismaClient();

const FORBIDDEN_ROLE_KEYS = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'SUPPORT'];

// List all roles for the authenticated tenant
router.get('/', requirePermission('roles.view'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const roles = await prisma.role.findMany({
      where: { restaurantId },
      include: {
        permissions: {
          select: { permission: true },
        },
        _count: {
          select: { employees: true },
        },
      },
      orderBy: [{ isOwnerRole: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
    });

    const formatted = roles.map((r) => ({
      id: r.id,
      restaurantId: r.restaurantId,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isOwnerRole: r.isOwnerRole,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      employeeCount: r._count.employees,
      permissions: r.permissions.map((p) => p.permission),
    }));

    res.json(formatted);
  } catch (error) {
    next(error);
  }
});

// Create custom role
router.post('/', requirePermission('roles.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { name, description, permissions } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const trimmedName = name.trim();
    const candidateKey = (req.body.key ? req.body.key.trim() : slugify(trimmedName)).toUpperCase();

    if (FORBIDDEN_ROLE_KEYS.includes(candidateKey)) {
      return res.status(400).json({
        error: `Cannot create role with reserved key "${candidateKey}"`,
      });
    }

    // Check key and name uniqueness in this tenant
    const existingRole = await prisma.role.findFirst({
      where: {
        restaurantId,
        OR: [{ key: candidateKey }, { name: trimmedName }],
      },
    });

    if (existingRole) {
      return res.status(400).json({
        error: `A role with key "${candidateKey}" or name "${trimmedName}" already exists in your restaurant.`,
      });
    }

    // Validate permissions array
    const validPermSet = new Set(PERMISSIONS);
    const permsToAssign: string[] = Array.isArray(permissions)
      ? permissions.filter((p: string) => validPermSet.has(p as any))
      : [];

    // R3: Privilege ceiling check when non-owner / non-support creates a role
    if (!req.user?.isOwnerRole && !req.user?.supportMode) {
      const userPerms = new Set(req.user?.permissions || []);
      const forbidden = permsToAssign.filter((p) => !userPerms.has(p));
      if (forbidden.length > 0) {
        return res.status(403).json({
          error: `Cannot grant permissions you do not possess: ${forbidden.join(', ')}`,
          forbidden,
        });
      }
    }

    const newRole = await prisma.role.create({
      data: {
        restaurantId,
        key: candidateKey,
        name: trimmedName,
        description: description ? description.trim() : null,
        isSystem: false,
        isOwnerRole: false,
        permissions: {
          create: permsToAssign.map((p) => ({ permission: p })),
        },
      },
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { employees: true } },
      },
    });

    res.status(201).json({
      id: newRole.id,
      restaurantId: newRole.restaurantId,
      key: newRole.key,
      name: newRole.name,
      description: newRole.description,
      isSystem: newRole.isSystem,
      isOwnerRole: newRole.isOwnerRole,
      createdAt: newRole.createdAt,
      updatedAt: newRole.updatedAt,
      employeeCount: newRole._count.employees,
      permissions: newRole.permissions.map((p) => p.permission),
    });
  } catch (error) {
    next(error);
  }
});

// Update role
router.patch('/:id', requirePermission('roles.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const roleId = req.params.id;

    const role = await prisma.role.findFirst({
      where: { id: roleId, restaurantId },
    });

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isOwnerRole || role.key === 'OWNER') {
      return res.status(403).json({ error: 'The Owner role cannot be modified' });
    }

    const { name, description, permissions } = req.body;
    const updateData: any = {};

    if (name && typeof name === 'string' && name.trim() !== role.name) {
      if (role.isSystem) {
        return res.status(400).json({ error: 'Cannot rename built-in system role' });
      }
      const existingName = await prisma.role.findFirst({
        where: { restaurantId, name: name.trim(), id: { not: roleId } },
      });
      if (existingName) {
        return res.status(400).json({ error: 'Another role already has this name' });
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description ? description.trim() : null;
    }

    // Update permissions atomically if supplied
    if (Array.isArray(permissions)) {
      const validPermSet = new Set(PERMISSIONS);
      const sanitizedPerms = permissions.filter((p: string) => validPermSet.has(p as any));

      // R3: Privilege ceiling check when non-owner / non-support patches a role
      if (!req.user?.isOwnerRole && !req.user?.supportMode) {
        const userPerms = new Set(req.user?.permissions || []);
        const forbidden = sanitizedPerms.filter((p) => !userPerms.has(p));
        if (forbidden.length > 0) {
          return res.status(403).json({
            error: `Cannot grant permissions you do not possess: ${forbidden.join(', ')}`,
            forbidden,
          });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (sanitizedPerms.length > 0) {
          await tx.rolePermission.createMany({
            data: sanitizedPerms.map((p) => ({ roleId, permission: p })),
          });
        }
        if (Object.keys(updateData).length > 0) {
          await tx.role.update({ where: { id: roleId }, data: updateData });
        }
      });
    } else if (Object.keys(updateData).length > 0) {
      await prisma.role.update({ where: { id: roleId }, data: updateData });
    }

    const updated = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { employees: true } },
      },
    });

    res.json({
      id: updated!.id,
      restaurantId: updated!.restaurantId,
      key: updated!.key,
      name: updated!.name,
      description: updated!.description,
      isSystem: updated!.isSystem,
      isOwnerRole: updated!.isOwnerRole,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
      employeeCount: updated!._count.employees,
      permissions: updated!.permissions.map((p) => p.permission),
    });
  } catch (error) {
    next(error);
  }
});

// Delete role
router.delete('/:id', requirePermission('roles.manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const roleId = req.params.id;

    const role = await prisma.role.findFirst({
      where: { id: roleId, restaurantId },
      include: {
        _count: { select: { employees: true } },
      },
    });

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isOwnerRole || role.key === 'OWNER') {
      return res.status(403).json({ error: 'The Owner role cannot be deleted' });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: 'System roles cannot be deleted' });
    }

    if (role._count.employees > 0) {
      return res.status(409).json({
        error: `Cannot delete role "${role.name}" because ${role._count.employees} staff member(s) are currently assigned to it. Please reassign them first.`,
      });
    }

    await prisma.role.delete({ where: { id: roleId } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;

