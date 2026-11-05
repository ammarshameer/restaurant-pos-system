export const PERMISSIONS = [
  'dashboard.view',
  'pos.use',
  'tables.view',
  'tables.manage',
  'orders.view',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'orders.discount',
  'orders.refund',
  'payments.view',
  'payments.process',
  'invoices.view',
  'menu.view',
  'menu.manage',
  'deals.view',
  'deals.manage',
  'inventory.view',
  'inventory.manage',
  'kitchen.view',
  'kitchen.manage',
  'employees.view',
  'employees.manage',
  'customers.view',
  'customers.manage',
  'roles.view',
  'roles.manage',
  'analytics.view',
  'costing.view',
  'costing.manage',
  'accounting.view',
  'accounting.manage',
  'settings.manage',
  'backups.manage',
] as const;

export const FEATURES = ['costing', 'accounting'] as const;
export type FeatureKey = typeof FEATURES[number];

export type Permission = typeof PERMISSIONS[number];

export interface PermissionModule {
  id: string;
  name: string;
  description: string;
  permissions: {
    key: Permission;
    name: string;
    description: string;
  }[];
}

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Overview and dashboard access',
    permissions: [
      { key: 'dashboard.view', name: 'View Dashboard', description: 'Access dashboard summary and quick links' },
    ],
  },
  {
    id: 'pos',
    name: 'POS Terminal',
    description: 'Point of sale operations and ordering',
    permissions: [
      { key: 'pos.use', name: 'Use POS', description: 'Access POS terminal and place customer orders' },
    ],
  },
  {
    id: 'tables',
    name: 'Floor Plan & Tables',
    description: 'Dine-in tables and layout management',
    permissions: [
      { key: 'tables.view', name: 'View Tables', description: 'See table layout, status, and occupancy' },
      { key: 'tables.manage', name: 'Manage Tables', description: 'Create, edit, move, combine, or split tables' },
    ],
  },
  {
    id: 'orders',
    name: 'Orders & Tickets',
    description: 'Order lifecycle management',
    permissions: [
      { key: 'orders.view', name: 'View Orders', description: 'View current and past order lists' },
      { key: 'orders.create', name: 'Create Orders', description: 'Create new dine-in, takeaway, or delivery orders' },
      { key: 'orders.update', name: 'Update Orders', description: 'Add items or update order status and notes' },
      { key: 'orders.cancel', name: 'Cancel Orders', description: 'Cancel, delete, or void orders' },
      { key: 'orders.discount', name: 'Apply Discounts', description: 'Apply discounts or adjust rates on orders' },
      { key: 'orders.refund', name: 'Authorize Refunds', description: 'Authorize refunds on orders or bills' },
    ],
  },
  {
    id: 'payments',
    name: 'Payments & Cash Register',
    description: 'Payment collection and settlement',
    permissions: [
      { key: 'payments.view', name: 'View Payments', description: 'View payment receipts and transaction records' },
      { key: 'payments.process', name: 'Process Payments', description: 'Collect cash, card, and split bill payments' },
    ],
  },
  {
    id: 'invoices',
    name: 'Sale Invoices',
    description: 'Billing history and invoices',
    permissions: [
      { key: 'invoices.view', name: 'View Invoices', description: 'Browse and print sale invoices' },
    ],
  },
  {
    id: 'menu',
    name: 'Menu & Recipes',
    description: 'Food and beverage items and categories',
    permissions: [
      { key: 'menu.view', name: 'View Menu', description: 'Browse categories and menu item details' },
      { key: 'menu.manage', name: 'Manage Menu', description: 'Create, update, and delete menu items and categories' },
    ],
  },
  {
    id: 'deals',
    name: 'Deals & Combos',
    description: 'Promotional combos and package deals',
    permissions: [
      { key: 'deals.view', name: 'View Deals', description: 'View active deals and combos' },
      { key: 'deals.manage', name: 'Manage Deals', description: 'Create, modify, and delete combo packages' },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory Stock',
    description: 'Ingredients, stock levels, and supply tracking',
    permissions: [
      { key: 'inventory.view', name: 'View Inventory', description: 'View ingredient quantities and stock logs' },
      { key: 'inventory.manage', name: 'Manage Inventory', description: 'Add stock items and make manual adjustments' },
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen Display (KDS)',
    description: 'Kitchen order preparation display',
    permissions: [
      { key: 'kitchen.view', name: 'View Kitchen', description: 'View kitchen display tickets' },
      { key: 'kitchen.manage', name: 'Manage Kitchen', description: 'Bump tickets and mark items prepared/ready' },
    ],
  },
  {
    id: 'employees',
    name: 'Staff & Time Clock',
    description: 'Staff directory and shifts',
    permissions: [
      { key: 'employees.view', name: 'View Staff', description: 'View employee roster and clock-in statuses' },
      { key: 'employees.manage', name: 'Manage Staff', description: 'Create, edit, and deactivate employee accounts' },
    ],
  },
  {
    id: 'customers',
    name: 'Customers',
    description: 'Customer directory and order history',
    permissions: [
      { key: 'customers.view', name: 'View Customers', description: 'View customer profiles and order history' },
      { key: 'customers.manage', name: 'Manage Customers', description: 'Create, edit, and delete customers' },
    ],
  },
  {
    id: 'roles',
    name: 'Roles & Permissions',
    description: 'Custom security roles and permission sets',
    permissions: [
      { key: 'roles.view', name: 'View Roles', description: 'View defined roles and assigned permissions' },
      { key: 'roles.manage', name: 'Manage Roles', description: 'Create, modify, and delete custom roles' },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics & Reports',
    description: 'Business metrics, revenue, and product sales',
    permissions: [
      { key: 'analytics.view', name: 'View Analytics', description: 'Access revenue reports and sales charts' },
    ],
  },
  {
    id: 'costing',
    name: 'Costing',
    description: 'Menu, recipe, and inventory cost data',
    permissions: [
      { key: 'costing.view', name: 'View Costs', description: 'View menu and inventory cost information' },
      { key: 'costing.manage', name: 'Manage Costs', description: 'Update recipe and inventory costs' },
    ],
  },
  {
    id: 'accounting',
    name: 'Accounting',
    description: 'Financial accounting reports',
    permissions: [
      { key: 'accounting.view', name: 'View Accounting', description: 'View financial accounting reports' },
      { key: 'accounting.manage', name: 'Manage Accounting', description: 'Manage accounting configuration and reports' },
    ],
  },
  {
    id: 'settings',
    name: 'Business Settings',
    description: 'Restaurant profile, branding, and preferences',
    permissions: [
      { key: 'settings.manage', name: 'Manage Settings', description: 'Update business details, hours, and branding' },
    ],
  },
  {
    id: 'backups',
    name: 'Data Backups',
    description: 'Database snapshot and backup management',
    permissions: [
      { key: 'backups.manage', name: 'Manage Backups', description: 'Trigger manual database backups and view logs' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSIONS;
