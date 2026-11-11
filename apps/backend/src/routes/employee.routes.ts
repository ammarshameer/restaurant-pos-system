import { Router, Response, NextFunction } from 'express';
import { EmployeeService } from '../services/employee.service';
import { redactSalaryIfUnauthorized, redactSalary } from '../services/salary-redaction.service';
import {
  AuthRequest,
  getAuthenticatedRestaurantId,
  requirePermission,
} from '../middleware/auth';

const router = Router();
const employeeService = new EmployeeService();

// Automatically redact sensitive compensation/salary fields unless requester has payroll.view
router.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    try {
      const restaurantId = getAuthenticatedRestaurantId(req);
      void redactSalaryIfUnauthorized(restaurantId, body, req.user)
        .then((redacted) => {
          originalJson(redacted);
        })
        .catch(() => {
          originalJson(redactSalary(body));
        });
    } catch {
      originalJson(redactSalary(body));
    }
    return res;
  }) as any;
  next();
});

function hasManagePermission(req: AuthRequest): boolean {
  if (req.user?.isOwnerRole || req.user?.role === 'OWNER') return true;
  return Boolean(req.user?.permissions?.includes('employees.manage'));
}

// Get all employees with pagination
router.get('/', requirePermission('employees.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const role = req.query.role as string;
    const roleId = req.query.roleId as string;
    const canManage = hasManagePermission(req);

    const result = await employeeService.getEmployees(restaurantId, {
      page,
      limit,
      search,
      role,
      roleId,
      canManage,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/restaurant/:restaurantId', requirePermission('employees.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string;
    const role = req.query.role as string;
    const roleId = req.query.roleId as string;
    const canManage = hasManagePermission(req);

    const result = await employeeService.getEmployees(restaurantId, {
      page,
      limit,
      search,
      role,
      roleId,
      canManage,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Time clock PIN punch (server-side PIN verification)
router.post('/time-clock/punch', async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { pin } = req.body;
    const ip = req.ip || (req.socket?.remoteAddress as string) || '0.0.0.0';
    const result = await employeeService.punchTimeClock(pin, restaurantId, ip);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Time clock punch failed' });
  }
});

router.post('/punch', async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { pin } = req.body;
    const ip = req.ip || (req.socket?.remoteAddress as string) || '0.0.0.0';
    const result = await employeeService.punchTimeClock(pin, restaurantId, ip);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Time clock punch failed' });
  }
});

// Get single employee
router.get('/:id', requirePermission('employees.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const canManage = hasManagePermission(req);
    const employee = await employeeService.getEmployee(req.params.id, restaurantId, canManage);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

// Create employee
router.post('/', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const employee = await employeeService.createEmployee(
      {
        ...req.body,
        restaurantId,
      },
      req.user
    );
    res.status(201).json(employee);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to create employee' });
  }
});

// Get employee permissions (role permissions, overrides, effective)
router.get('/:id/permissions', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const result = await employeeService.getEmployeePermissions(req.params.id, restaurantId);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to get permissions' });
  }
});

// Update employee permission overrides
router.put('/:id/permissions', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const overrides = Array.isArray(req.body.overrides) ? req.body.overrides : [];
    const result = await employeeService.updateEmployeePermissions(
      req.params.id,
      overrides,
      restaurantId,
      req.user
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to update permissions' });
  }
});

// Reset employee password
router.post('/:id/reset-password', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { temporaryPassword } = req.body;
    const result = await employeeService.resetPassword(
      req.params.id,
      restaurantId,
      temporaryPassword,
      req.user
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to reset password' });
  }
});

// Reset employee PIN
router.post('/:id/reset-pin', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const { pin } = req.body;
    const result = await employeeService.resetPin(req.params.id, restaurantId, pin);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to reset PIN' });
  }
});

// Update employee
router.patch('/:id', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const employee = await employeeService.updateEmployee(
      req.params.id,
      req.body,
      restaurantId,
      req.user
    );
    res.json(employee);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to update employee' });
  }
});

// Deactivate employee
router.post('/:id/deactivate', requirePermission('employees.manage'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const employee = await employeeService.deactivateEmployee(req.params.id, restaurantId);
    res.json(employee);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to deactivate employee' });
  }
});

// Clock in
router.post('/:id/clock-in', async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const isSelf = req.user?.id === req.params.id;
    const canManage =
      req.user?.isOwnerRole === true ||
      (req.user?.permissions || []).includes('employees.manage');
    if (!isSelf && !canManage) {
      return res.status(403).json({ error: 'You are only authorized to clock in for yourself' });
    }
    const shift = await employeeService.clockIn(req.params.id, restaurantId, req.user);
    res.json(shift);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to clock in' });
  }
});

// Clock out
router.post('/:id/clock-out', async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const isSelf = req.user?.id === req.params.id;
    const canManage =
      req.user?.isOwnerRole === true ||
      (req.user?.permissions || []).includes('employees.manage');
    if (!isSelf && !canManage) {
      return res.status(403).json({ error: 'You are only authorized to clock out for yourself' });
    }
    const shift = await employeeService.clockOut(req.params.id, restaurantId, req.user);
    res.json(shift);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to clock out' });
  }
});

// Get employee shifts
router.get('/:id/shifts', requirePermission('employees.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const shifts = await employeeService.getEmployeeShifts(req.params.id, startDate, endDate, restaurantId);
    res.json(shifts);
  } catch (error) {
    next(error);
  }
});

// Get active shifts
router.get('/restaurant/:restaurantId/active-shifts', requirePermission('employees.view'), async (req: AuthRequest, res, next) => {
  try {
    const restaurantId = getAuthenticatedRestaurantId(req);
    const shifts = await employeeService.getActiveShifts(restaurantId);
    res.json(shifts);
  } catch (error) {
    next(error);
  }
});

export default router;
