import { Router } from 'express';
import { EmployeeService } from '../services/employee.service';
import { authorize } from '../middleware/auth';

const router = Router();
const employeeService = new EmployeeService();

// Get all employees
router.get('/restaurant/:restaurantId', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const employees = await employeeService.getEmployees(req.params.restaurantId);
    res.json(employees);
  } catch (error) {
    next(error);
  }
});

// Get single employee
router.get('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const employee = await employeeService.getEmployee(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

// Create employee
router.post('/', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const employee = await employeeService.createEmployee(req.body);
    res.status(201).json(employee);
  } catch (error) {
    next(error);
  }
});

// Update employee
router.patch('/:id', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const employee = await employeeService.updateEmployee(req.params.id, req.body);
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

// Deactivate employee
router.post('/:id/deactivate', authorize(['ADMIN']), async (req, res, next) => {
  try {
    const employee = await employeeService.deactivateEmployee(req.params.id);
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

// Clock in
router.post('/:id/clock-in', async (req, res, next) => {
  try {
    const shift = await employeeService.clockIn(req.params.id);
    res.json(shift);
  } catch (error) {
    next(error);
  }
});

// Clock out
router.post('/:id/clock-out', async (req, res, next) => {
  try {
    const shift = await employeeService.clockOut(req.params.id);
    res.json(shift);
  } catch (error) {
    next(error);
  }
});

// Get employee shifts
router.get('/:id/shifts', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const shifts = await employeeService.getEmployeeShifts(req.params.id, startDate, endDate);
    res.json(shifts);
  } catch (error) {
    next(error);
  }
});

// Get active shifts
router.get('/restaurant/:restaurantId/active-shifts', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const shifts = await employeeService.getActiveShifts(req.params.restaurantId);
    res.json(shifts);
  } catch (error) {
    next(error);
  }
});

export default router;
