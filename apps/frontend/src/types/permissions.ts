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
  'profit.view',
  'dues.view',
  'dues.manage',
  'expenses.view',
  'expenses.create',
  'expenses.manage',
  'payroll.view',
  'payroll.manage',
  'payroll.pay',
  'settings.manage',
  'backups.manage',
] as const;

export const FEATURES = [
  'pos',
  'tables',
  'orders',
  'payments',
  'invoices',
  'menu',
  'deals',
  'inventory',
  'kitchen',
  'employees',
  'customers',
  'dues',
  'roles',
  'analytics',
  'costing',
  'expenses',
  'payroll',
  'settings',
  'backups',
] as const;

export type FeatureKey = (typeof FEATURES)[number];
export type Permission = (typeof PERMISSIONS)[number];

export const MODULE_TO_FEATURE: Record<string, FeatureKey | null> = {
  dashboard: null,
  pos: 'pos',
  tables: 'tables',
  orders: 'orders',
  payments: 'payments',
  invoices: 'invoices',
  menu: 'menu',
  deals: 'deals',
  inventory: 'inventory',
  kitchen: 'kitchen',
  employees: 'employees',
  customers: 'customers',
  dues: 'dues',
  roles: 'roles',
  analytics: 'analytics',
  costing: 'costing',
  profit: 'costing',
  expenses: 'expenses',
  payroll: 'payroll',
  settings: 'settings',
  backups: 'backups',
};

export function getFeatureForPermission(permission: string): FeatureKey | null {
  const [mod] = permission.split('.');
  if (!mod || mod === 'dashboard') return null;
  return (MODULE_TO_FEATURE[mod] as FeatureKey) || null;
}

export function filterPermissionsByFeatures(
  permissions: string[],
  enabledFeatures: string[]
): string[] {
  const enabledSet = new Set(enabledFeatures);
  return permissions.filter((p) => {
    const [mod] = p.split('.');
    if (!mod || mod === 'dashboard') return true;
    const feat = MODULE_TO_FEATURE[mod];
    if (!feat) return true;
    return enabledSet.has(feat);
  });
}

export interface PermissionModule {
  id: string;
  name: string;
  description: string;
  featureKey?: FeatureKey;
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
    featureKey: 'pos',
    permissions: [
      { key: 'pos.use', name: 'Use POS', description: 'Access POS terminal and place customer orders' },
    ],
  },
  {
    id: 'tables',
    name: 'Floor Plan & Tables',
    description: 'Dine-in tables and layout management',
    featureKey: 'tables',
    permissions: [
      { key: 'tables.view', name: 'View Tables', description: 'See table layout, status, and occupancy' },
      { key: 'tables.manage', name: 'Manage Tables', description: 'Create, edit, move, combine, or split tables' },
    ],
  },
  {
    id: 'orders',
    name: 'Orders & Tickets',
    description: 'Order lifecycle management',
    featureKey: 'orders',
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
    featureKey: 'payments',
    permissions: [
      { key: 'payments.view', name: 'View Payments', description: 'View payment receipts and transaction records' },
      { key: 'payments.process', name: 'Process Payments', description: 'Collect cash, card, and split bill payments' },
    ],
  },
  {
    id: 'invoices',
    name: 'Sale Invoices',
    description: 'Billing history and invoices',
    featureKey: 'invoices',
    permissions: [
      { key: 'invoices.view', name: 'View Invoices', description: 'Browse and print sale invoices' },
    ],
  },
  {
    id: 'menu',
    name: 'Menu & Recipes',
    description: 'Food and beverage items and categories',
    featureKey: 'menu',
    permissions: [
      { key: 'menu.view', name: 'View Menu', description: 'Browse categories and menu item details' },
      { key: 'menu.manage', name: 'Manage Menu', description: 'Create, update, and delete menu items and categories' },
    ],
  },
  {
    id: 'deals',
    name: 'Deals & Combos',
    description: 'Promotional combos and package deals',
    featureKey: 'deals',
    permissions: [
      { key: 'deals.view', name: 'View Deals', description: 'View active deals and combos' },
      { key: 'deals.manage', name: 'Manage Deals', description: 'Create, modify, and delete combo packages' },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory Stock',
    description: 'Ingredients, stock levels, and supply tracking',
    featureKey: 'inventory',
    permissions: [
      { key: 'inventory.view', name: 'View Inventory', description: 'View ingredient quantities and stock logs' },
      { key: 'inventory.manage', name: 'Manage Inventory', description: 'Add stock items and make manual adjustments' },
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen Display (KDS)',
    description: 'Kitchen order preparation display',
    featureKey: 'kitchen',
    permissions: [
      { key: 'kitchen.view', name: 'View Kitchen', description: 'View kitchen display tickets' },
      { key: 'kitchen.manage', name: 'Manage Kitchen', description: 'Bump tickets and mark items prepared/ready' },
    ],
  },
  {
    id: 'employees',
    name: 'Staff & Time Clock',
    description: 'Staff directory and shifts',
    featureKey: 'employees',
    permissions: [
      { key: 'employees.view', name: 'View Staff', description: 'View employee roster and clock-in statuses' },
      { key: 'employees.manage', name: 'Manage Staff', description: 'Create, edit, and deactivate employee accounts' },
    ],
  },
  {
    id: 'customers',
    name: 'Customers',
    description: 'Customer directory and order history',
    featureKey: 'customers',
    permissions: [
      { key: 'customers.view', name: 'View Customers', description: 'View customer profiles and order history' },
      { key: 'customers.manage', name: 'Manage Customers', description: 'Create, edit, and delete customers' },
    ],
  },
  {
    id: 'dues',
    name: 'Dues & Receivables',
    description: 'Customer credit, balance dues, and ledger management',
    featureKey: 'dues',
    permissions: [
      { key: 'dues.view', name: 'View Dues', description: 'View customer balance dues, ledger, and statements' },
      { key: 'dues.manage', name: 'Manage Dues', description: 'Receive dues payments and make balance adjustments' },
    ],
  },
  {
    id: 'roles',
    name: 'Roles & Permissions',
    description: 'Custom security roles and permission sets',
    featureKey: 'roles',
    permissions: [
      { key: 'roles.view', name: 'View Roles', description: 'View defined roles and assigned permissions' },
      { key: 'roles.manage', name: 'Manage Roles', description: 'Create, modify, and delete custom roles' },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics & Reports',
    description: 'Business metrics, revenue, and product sales',
    featureKey: 'analytics',
    permissions: [
      { key: 'analytics.view', name: 'View Analytics', description: 'Access revenue reports and sales charts' },
    ],
  },
  {
    id: 'costing',
    name: 'Costing & Profit',
    description: 'Menu, recipe, inventory cost data, and profit & loss',
    featureKey: 'costing',
    permissions: [
      { key: 'costing.view', name: 'View Costs', description: 'View menu and inventory cost information' },
      { key: 'costing.manage', name: 'Manage Costs', description: 'Update recipe and inventory costs' },
      { key: 'profit.view', name: 'View Profit & Loss', description: 'Access monthly profit and loss financial statements' },
    ],
  },
  {
    id: 'expenses',
    name: 'Expenses',
    description: 'Track and manage operational and business expenses',
    featureKey: 'expenses',
    permissions: [
      { key: 'expenses.view', name: 'View Expenses', description: 'Browse business expense records and reports' },
      { key: 'expenses.create', name: 'Create Expenses', description: 'Submit new expense receipts and recurring templates' },
      { key: 'expenses.manage', name: 'Manage Expenses', description: 'Approve, pay, and void expense records' },
    ],
  },
  {
    id: 'payroll',
    name: 'Payroll',
    description: 'Employee wages, salaries, advances, and payroll processing',
    featureKey: 'payroll',
    permissions: [
      { key: 'payroll.view', name: 'View Payroll', description: 'View salary sheets, time entries, and payslips' },
      { key: 'payroll.manage', name: 'Manage Payroll', description: 'Edit payroll drafts, advances, and time entry corrections' },
      { key: 'payroll.pay', name: 'Pay Payroll', description: 'Execute final payroll payout and generate salary expenses' },
    ],
  },
  {
    id: 'settings',
    name: 'Business Settings',
    description: 'Restaurant profile, branding, and preferences',
    featureKey: 'settings',
    permissions: [
      { key: 'settings.manage', name: 'Manage Settings', description: 'Update business details, hours, and branding' },
    ],
  },
  {
    id: 'backups',
    name: 'Data Backups',
    description: 'Database snapshot and backup management',
    featureKey: 'backups',
    permissions: [
      { key: 'backups.manage', name: 'Manage Backups', description: 'Trigger manual database backups and view logs' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSIONS;
