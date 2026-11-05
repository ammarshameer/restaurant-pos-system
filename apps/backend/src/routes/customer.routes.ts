import { Router } from 'express';
import { CustomerService } from '../services/customer.service';
import { AuthRequest, getAuthenticatedRestaurantId, requireAnyPermission, requirePermission } from '../middleware/auth';

const router = Router();
const customers = new CustomerService();

router.get('/', requireAnyPermission(['customers.view', 'customers.manage']), async (req: AuthRequest, res, next) => {
  try {
    res.json(await customers.listCustomers(getAuthenticatedRestaurantId(req), {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      search: String(req.query.search || ''),
    }));
  } catch (error) { next(error); }
});

router.get('/:id', requireAnyPermission(['customers.view', 'customers.manage']), async (req: AuthRequest, res, next) => {
  try { res.json(await customers.getCustomer(req.params.id, getAuthenticatedRestaurantId(req))); } catch (error) { next(error); }
});

router.post('/', requirePermission('customers.manage'), async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await customers.createCustomer(getAuthenticatedRestaurantId(req), req.body)); } catch (error) { next(error); }
});

router.patch('/:id', requirePermission('customers.manage'), async (req: AuthRequest, res, next) => {
  try { res.json(await customers.updateCustomer(req.params.id, getAuthenticatedRestaurantId(req), req.body)); } catch (error) { next(error); }
});

router.delete('/:id', requirePermission('customers.manage'), async (req: AuthRequest, res, next) => {
  try { await customers.deleteCustomer(req.params.id, getAuthenticatedRestaurantId(req)); res.status(204).end(); } catch (error) { next(error); }
});

export default router;
