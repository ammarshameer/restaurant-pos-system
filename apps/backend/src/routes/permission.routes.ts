import { Router } from 'express';
import { PERMISSION_MODULES, ALL_PERMISSIONS } from '../permissions';

const router = Router();

// GET /api/permissions -> catalogue grouped by module
router.get('/', (req, res) => {
  res.json({
    modules: PERMISSION_MODULES,
    permissions: ALL_PERMISSIONS,
  });
});

export default router;

