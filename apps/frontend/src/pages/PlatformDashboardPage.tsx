import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  platformApi,
  PlatformTenant,
  CreateBusinessPayload,
} from '../api/platform.api';
import {
  getPlatformUser,
  clearPlatformSession,
  enterSupportMode,
} from '../lib/session';
import { loginSuccess } from '../store/slices/authSlice';
import PlatformThemeToggle from '../components/PlatformThemeToggle';
import { FEATURES, FeatureKey } from '../types/permissions';

const REQUIRED_MODULE_KEYS = ['pos', 'orders', 'payments', 'settings'];

const PRESET_MODULES: Record<'starter' | 'standard' | 'full', string[]> = {
  starter: ['pos', 'tables', 'orders', 'payments', 'invoices', 'menu', 'kitchen', 'settings'],
  standard: [
    'pos',
    'tables',
    'orders',
    'payments',
    'invoices',
    'menu',
    'kitchen',
    'settings',
    'deals',
    'customers',
    'dues',
    'inventory',
    'employees',
    'roles',
    'backups',
  ],
  full: [
    'pos',
    'tables',
    'orders',
    'payments',
    'invoices',
    'menu',
    'kitchen',
    'settings',
    'deals',
    'customers',
    'dues',
    'inventory',
    'employees',
    'roles',
    'backups',
    'analytics',
    'costing',
    'expenses',
    'payroll',
  ],
};

const MODULE_GROUPS = [
  {
    title: 'Operations & Floor',
    modules: [
      { key: 'pos', name: 'POS Terminal', required: true },
      { key: 'tables', name: 'Floor Plan & Tables' },
      { key: 'orders', name: 'Orders & Tickets', required: true },
      { key: 'payments', name: 'Cash Register & Payments', required: true },
      { key: 'invoices', name: 'Sale Invoices' },
      { key: 'kitchen', name: 'Kitchen Display (KDS)' },
    ],
  },
  {
    title: 'Menu & Inventory',
    modules: [
      { key: 'menu', name: 'Menu & Recipes' },
      { key: 'deals', name: 'Deals & Combos' },
      { key: 'inventory', name: 'Inventory Stock' },
      { key: 'costing', name: 'Food Costing', hint: 'Auto-enables inventory & menu' },
    ],
  },
  {
    title: 'Staff & Customers',
    modules: [
      { key: 'customers', name: 'Customer Directory' },
      { key: 'dues', name: 'Dues & Udhaar', hint: 'Auto-enables customers' },
      { key: 'employees', name: 'Staff & Time Clock' },
      { key: 'payroll', name: 'Payroll & Salaries', hint: 'Auto-enables staff' },
      { key: 'roles', name: 'Roles & Permissions' },
    ],
  },
  {
    title: 'Analytics & Administration',
    modules: [
      { key: 'analytics', name: 'Analytics & Reports', hint: 'Auto-enables orders' },
      { key: 'expenses', name: 'Business Expenses' },
      { key: 'settings', name: 'Store Settings', required: true },
      { key: 'backups', name: 'Database Backups' },
    ],
  },
];

function applyModuleToggle(currentKeys: Set<string>, key: string, nextChecked: boolean): Set<string> {
  const next = new Set(currentKeys);
  if (REQUIRED_MODULE_KEYS.includes(key) && !nextChecked) {
    return next;
  }

  if (nextChecked) {
    next.add(key);
    if (key === 'dues') next.add('customers');
    if (key === 'costing') {
      next.add('inventory');
      next.add('menu');
    }
    if (key === 'payroll') next.add('employees');
    if (key === 'analytics') next.add('orders');
  } else {
    next.delete(key);
    if (key === 'customers') next.delete('dues');
    if (key === 'inventory' || key === 'menu') next.delete('costing');
    if (key === 'employees') next.delete('payroll');
  }

  for (const req of REQUIRED_MODULE_KEYS) {
    next.add(req);
  }
  return next;
}

export const PlatformDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const platformUser = getPlatformUser();
  const isSuperAdmin = platformUser?.role === 'SUPER_ADMIN';

  const [activeTab, setActiveTab] = useState<'tenants' | 'support' | 'audit'>('tenants');
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSuccessData, setCreatedSuccessData] = useState<{
    businessName: string;
    slug: string;
    ownerEmail: string;
    ownerPin: string;
    loginUrl: string;
  } | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [resetPwModalOpen, setResetPwModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenant | null>(null);
  const [featuresModalOpen, setFeaturesModalOpen] = useState(false);
  const [tenantFeatureKeys, setTenantFeatureKeys] = useState<Set<string>>(new Set());
  const [tenantExpiresAt, setTenantExpiresAt] = useState<string>('');

  // Module checklist in create business modal
  const [createModules, setCreateModules] = useState<Set<string>>(new Set(PRESET_MODULES.standard));
  const [createExpiresAt, setCreateExpiresAt] = useState<string>('');

  // Forms
  const initialCreateForm: CreateBusinessPayload = {
    businessName: '',
    address: '',
    phone: '',
    businessEmail: '',
    timezone: 'Asia/Karachi',
    logoUrl: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerEmail: '',
    ownerPhone: '',
    ownerPassword: '',
    ownerPin: '',
  };
  const [createForm, setCreateForm] = useState<CreateBusinessPayload>(initialCreateForm);
  const [editForm, setEditForm] = useState<Partial<PlatformTenant>>({});
  const [newOwnerPassword, setNewOwnerPassword] = useState('');

  // Support Account Form
  const [supportAccountForm, setSupportAccountForm] = useState({
    name: 'Global Platform Support',
    email: '',
    password: '',
    isActive: true,
  });

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const data = await platformApi.getRestaurants();
      setTenants(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load business tenants');
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setLoadingLogs(true);
      const data = await platformApi.getAuditLogs({ limit: 50 });
      setAuditLogs(data?.data || []);
    } catch (err: any) {
      console.warn('Failed to load audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    if (activeTab === 'audit' && isSuperAdmin) {
      loadAuditLogs();
    }
  }, [activeTab]);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleLogout = () => {
    clearPlatformSession();
    navigate('/platform/login');
  };

  // Image Upload Helper (reject SVG, max 2MB)
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
      alert('SVG images are not allowed for security reasons. Please upload PNG, JPG, or WebP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('Logo image exceeds the maximum permitted size of 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (isEdit) {
        setEditForm((prev) => ({ ...prev, logoUrl: dataUrl }));
      } else {
        setCreateForm((prev) => ({ ...prev, logoUrl: dataUrl }));
      }
    };
    reader.readAsDataURL(file);
  };

  // Create Tenant
  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    try {
      const payload: CreateBusinessPayload = {
        ...createForm,
        features: Array.from(createModules).map((key) => ({
          key,
          enabled: true,
          expiresAt: createExpiresAt ? new Date(createExpiresAt).toISOString() : null,
        })),
        featureExpiresAt: createExpiresAt || null,
      };
      const res: any = await platformApi.createRestaurant(payload);
      setCreatedSuccessData({
        businessName: res?.restaurant?.name || createForm.businessName,
        slug: res?.restaurant?.slug || '',
        ownerEmail: res?.owner?.email || createForm.ownerEmail,
        ownerPin: res?.owner?.pin || createForm.ownerPin || '',
        loginUrl: `${window.location.origin}/login`,
      });
      setCreateModalOpen(false);
      setCreateForm(initialCreateForm);
      setCreateModules(new Set(PRESET_MODULES.standard));
      setCreateExpiresAt('');
      loadTenants();
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || err?.response?.data?.message || 'Failed to create business');
    }
  };

  // Edit Tenant
  const handleEditBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    try {
      await platformApi.updateRestaurant(selectedTenant.id, editForm);
      showSuccess(`Business "${editForm.name || selectedTenant.name}" updated successfully!`);
      setEditModalOpen(false);
      setSelectedTenant(null);
      loadTenants();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to update business');
    }
  };

  // Toggle Suspend / Activate
  const handleToggleActive = async (tenant: PlatformTenant) => {
    const nextState = !tenant.isActive;
    const confirmMsg = nextState
      ? `Activate business "${tenant.name}"? Staff will regain access.`
      : `Suspend business "${tenant.name}"? All staff access will be immediately blocked.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await platformApi.updateRestaurant(tenant.id, { isActive: nextState });
      showSuccess(`Business "${tenant.name}" is now ${nextState ? 'ACTIVE' : 'SUSPENDED'}.`);
      loadTenants();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to update status');
    }
  };

  // Reset Owner Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !newOwnerPassword) return;
    try {
      await platformApi.resetOwnerPassword(selectedTenant.id, newOwnerPassword);
      showSuccess(`Owner password for "${selectedTenant.name}" has been reset!`);
      setResetPwModalOpen(false);
      setSelectedTenant(null);
      setNewOwnerPassword('');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to reset password');
    }
  };

  const openFeatureModal = async (tenant: PlatformTenant) => {
    setSelectedTenant(tenant);
    try {
      const data = await platformApi.getTenantFeatures(tenant.id);
      const activeKeys = new Set<string>();
      let foundExpiry = '';
      for (const f of data.features || []) {
        if (f.enabled) activeKeys.add(f.key);
        if (f.expiresAt && !foundExpiry) {
          foundExpiry = String(f.expiresAt).slice(0, 10);
        }
      }
      for (const req of REQUIRED_MODULE_KEYS) {
        activeKeys.add(req);
      }
      setTenantFeatureKeys(activeKeys);
      setTenantExpiresAt(foundExpiry);
      setFeaturesModalOpen(true);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to load tenant features');
    }
  };

  const saveTenantFeatures = async () => {
    if (!selectedTenant) return;
    try {
      const updates = (FEATURES as readonly string[]).map((key) => ({
        key,
        enabled: REQUIRED_MODULE_KEYS.includes(key) ? true : tenantFeatureKeys.has(key),
        expiresAt: tenantExpiresAt ? new Date(tenantExpiresAt).toISOString() : null,
      }));
      await platformApi.updateTenantFeatures(selectedTenant.id, updates);
      showSuccess(`Modules updated for "${selectedTenant.name}".`);
      setFeaturesModalOpen(false);
      setSelectedTenant(null);
      loadTenants();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to update tenant features');
    }
  };

  // Enter Support Mode (Impersonation)
  const handleEnterTenant = async (tenant: PlatformTenant) => {
    if (!tenant.isActive) {
      alert('Cannot enter a suspended business. Please activate it first.');
      return;
    }

    try {
      const session = await platformApi.enterTenant(tenant.id, 'Support session');
      enterSupportMode({
        accessToken: session.accessToken,
        user: session.user,
      });
      dispatch(loginSuccess({ user: session.user, token: session.accessToken }));
      navigate('/pos');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to enter support mode');
    }
  };

  // Update Global Support Account
  const handleSaveSupportAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await platformApi.upsertSupportAccount(supportAccountForm);
      showSuccess('Global Support user account updated successfully!');
      setSupportAccountForm((prev) => ({ ...prev, password: '' }));
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to update support account');
    }
  };

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()) ||
      (t.owner?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.owner?.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = tenants.filter((t) => t.isActive).length;
  const suspendedCount = tenants.filter((t) => !t.isActive).length;
  const totalStaff = tenants.reduce((sum, t) => sum + (t.userCount || 0), 0);

  return (
    <div className="platform-page platform-dashboard-page" style={{ minHeight: '100vh', padding: '24px 32px' }}>
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #1e293b',
          paddingBottom: '20px',
          marginBottom: '28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
            }}
          >
            🛡️
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Platform Super Admin Dashboard
            </h1>
            <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Multi-Tenant SaaS Management &amp; Support Console
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <PlatformThemeToggle />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>{platformUser?.name || 'Administrator'}</div>
            <div style={{ fontSize: '12px', color: '#60a5fa' }}>{platformUser?.role || 'SUPER_ADMIN'}</div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: '#1e293b',
              color: '#f87171',
              border: '1px solid #334155',
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Alerts */}
      {successMessage && (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#4ade80',
            padding: '12px 18px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✓ {successMessage}
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            padding: '12px 18px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Businesses</div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '6px' }}>{tenants.length}</div>
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Tenants</div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '6px', color: '#4ade80' }}>{activeCount}</div>
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Suspended Tenants</div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '6px', color: '#f87171' }}>{suspendedCount}</div>
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Staff Users</div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '6px', color: '#60a5fa' }}>{totalStaff}</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #1e293b', marginBottom: '24px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('tenants')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'tenants' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'tenants' ? '#f8fafc' : '#94a3b8',
            padding: '10px 18px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          🏢 Restaurant Tenants ({tenants.length})
        </button>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('support')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'support' ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === 'support' ? '#f8fafc' : '#94a3b8',
              padding: '10px 18px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            👤 Global Support User
          </button>
        )}

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'audit' ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === 'audit' ? '#f8fafc' : '#94a3b8',
              padding: '10px 18px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            📋 Platform Audit Logs
          </button>
        )}
      </div>

      {/* TAB 1: TENANTS LIST */}
      {activeTab === 'tenants' && (
        <div>
          {/* Action Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <input
              type="text"
              placeholder="Search by business name, code, owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#f8fafc',
                padding: '9px 16px',
                borderRadius: '8px',
                width: '360px',
                fontSize: '13px',
              }}
            />

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                + Create New Business
              </button>
            )}
          </div>

          {/* Tenants Table */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#1e293b', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                  <th style={{ padding: '12px 16px' }}>Business</th>
                  <th style={{ padding: '12px 16px' }}>Business Code</th>
                  <th style={{ padding: '12px 16px' }}>Owner Details</th>
                  <th style={{ padding: '12px 16px' }}>Staff</th>
                  <th style={{ padding: '12px 16px' }}>Enabled Modules</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Created</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                      Loading businesses...
                    </td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                      No business tenants found.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {t.logoUrl ? (
                            <img
                              src={t.logoUrl}
                              alt={t.name}
                              style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '6px',
                                background: '#334155',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '16px',
                              }}
                            >
                              🍽️
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 700 }}>{t.name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{t.phone || t.email}</div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: '4px', color: '#60a5fa' }}>
                            {t.slug}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(t.slug);
                              showSuccess(`Copied Business Code "${t.slug}"!`);
                            }}
                            style={{
                              background: '#334155',
                              border: 'none',
                              color: '#fff',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              padding: '2px 6px',
                              fontSize: '11px',
                            }}
                            title="Copy Business Code"
                          >
                            📋 Copy
                          </button>
                        </div>
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        {t.owner ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{t.owner.name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{t.owner.email}</div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontWeight: 600 }}>{t.userCount}</span> staff
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#60a5fa',
                              padding: '3px 8px',
                              borderRadius: '12px',
                              fontWeight: 700,
                              fontSize: '11px',
                            }}
                          >
                            {(t.enabledFeatures || []).length} / {FEATURES.length} active
                          </span>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => openFeatureModal(t)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                fontSize: '11px',
                                textDecoration: 'underline',
                                padding: 0,
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            background: t.isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: t.isActive ? '#4ade80' : '#f87171',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            fontSize: '11px',
                          }}
                        >
                          {t.isActive ? 'ACTIVE' : 'SUSPENDED'}
                        </span>
                      </td>

                      <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                        {new Date(t.createdAt).toLocaleDateString()}
                      </td>

                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => handleEnterTenant(t)}
                            title="Enter business as owner in support mode"
                            aria-label={`Enter ${t.name}`}
                            className="platform-action-button"
                            style={{
                              background: '#d97706',
                              color: '#ffffff',
                              border: 'none',
                              padding: '5px',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '16px',
                              cursor: 'pointer',
                            }}
                          >
                            ↗
                          </button>

                          {isSuperAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => void openFeatureModal(t)}
                                title={`Manage features for ${t.name}`}
                                aria-label={`Manage features for ${t.name}`}
                                className="platform-action-button"
                                style={{
                                  background: '#1d4ed8',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '5px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                }}
                              >
                                ⚙
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedTenant(t);
                                  setEditForm({
                                    name: t.name,
                                    address: t.address,
                                    phone: t.phone,
                                    email: t.email,
                                    timezone: t.timezone,
                                    logoUrl: t.logoUrl,
                                  });
                                  setEditModalOpen(true);
                                }}
                                title={`Edit ${t.name}`}
                                aria-label={`Edit ${t.name}`}
                                className="platform-action-button"
                                style={{
                                  background: '#334155',
                                  color: '#f8fafc',
                                  border: 'none',
                                  padding: '5px',
                                  borderRadius: '6px',
                                  fontWeight: 600,
                                  fontSize: '16px',
                                  cursor: 'pointer',
                                }}
                              >
                                ✎
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleActive(t)}
                                title={t.isActive ? `Suspend ${t.name}` : `Activate ${t.name}`}
                                aria-label={t.isActive ? `Suspend ${t.name}` : `Activate ${t.name}`}
                                className="platform-action-button"
                                style={{
                                  background: t.isActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                                  color: t.isActive ? '#f87171' : '#4ade80',
                                  border: 'none',
                                  padding: '5px',
                                  borderRadius: '6px',
                                  fontWeight: 600,
                                  fontSize: '16px',
                                  cursor: 'pointer',
                                }}
                              >
                                {t.isActive ? '⏸' : '▶'}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedTenant(t);
                                  setNewOwnerPassword('');
                                  setResetPwModalOpen(true);
                                }}
                                title={`Reset password for ${t.name}`}
                                aria-label={`Reset password for ${t.name}`}
                                className="platform-action-button"
                                style={{
                                  background: '#1e293b',
                                  color: '#cbd5e1',
                                  border: '1px solid #334155',
                                  padding: '5px',
                                  borderRadius: '6px',
                                  fontWeight: 600,
                                  fontSize: '16px',
                                  cursor: 'pointer',
                                }}
                              >
                                🔑
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SUPPORT ACCOUNT (SUPER_ADMIN ONLY) */}
      {activeTab === 'support' && isSuperAdmin && (
        <div style={{ maxWidth: '540px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '6px' }}>Global Support Account</h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '20px' }}>
            There is exactly one global support account. It has tenant-crossing access but never appears inside any tenant's directory.
          </p>

          <form onSubmit={handleSaveSupportAccount}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>Support Agent Name</label>
              <input
                type="text"
                value={supportAccountForm.name}
                onChange={(e) => setSupportAccountForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>Support Email Address</label>
              <input
                type="email"
                value={supportAccountForm.email}
                onChange={(e) => setSupportAccountForm((prev) => ({ ...prev, email: e.target.value }))}
                required
                style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>
                Password (leave blank to keep current)
              </label>
              <input
                type="password"
                value={supportAccountForm.password}
                onChange={(e) => setSupportAccountForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="••••••••••••"
                style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px' }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={supportAccountForm.isActive}
                  onChange={(e) => setSupportAccountForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                />
                Support account enabled
              </label>
            </div>

            <button
              type="submit"
              style={{
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                padding: '9px 18px',
                borderRadius: '6px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save Support Account
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: PLATFORM AUDIT LOGS (SUPER_ADMIN ONLY) */}
      {activeTab === 'audit' && isSuperAdmin && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '12px 16px' }}>Timestamp</th>
                <th style={{ padding: '12px 16px' }}>Platform User</th>
                <th style={{ padding: '12px 16px' }}>Action</th>
                <th style={{ padding: '12px 16px' }}>Target Business</th>
                <th style={{ padding: '12px 16px' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {loadingLogs ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                    Loading audit trail...
                  </td>
                </tr>
              ) : auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                    No audit logs recorded yet.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log: any) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600 }}>{log.platformUser?.name}</div>
                      <div style={{ fontSize: '11px', color: '#60a5fa' }}>{log.platformUser?.role}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: '4px', color: '#f59e0b' }}>
                        {log.action}
                      </code>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {log.restaurant?.name || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>
                      {log.details || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: CREATE BUSINESS */}
      {createModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '28px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Create Business &amp; Owner</h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBusiness}>
              {createError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  ⚠️ {createError}
                </div>
              )}

              <h3 style={{ fontSize: '14px', color: '#60a5fa', borderBottom: '1px solid #1e293b', paddingBottom: '6px', marginBottom: '14px' }}>
                1. Restaurant Business Information
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Business Name *</label>
                  <input
                    type="text"
                    required
                    value={createForm.businessName}
                    onChange={(e) => setCreateForm((p) => ({ ...p, businessName: e.target.value }))}
                    placeholder="e.g. Olive Garden"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Business Phone</label>
                  <input
                    type="text"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+92 300 1234567"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Business Address</label>
                  <input
                    type="text"
                    value={createForm.address}
                    onChange={(e) => setCreateForm((p) => ({ ...p, address: e.target.value }))}
                    placeholder="Street, City"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Timezone</label>
                  <input
                    type="text"
                    value={createForm.timezone}
                    onChange={(e) => setCreateForm((p) => ({ ...p, timezone: e.target.value }))}
                    placeholder="Asia/Karachi"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
              </div>

              {/* Logo Upload & Preview */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Business Logo (PNG, JPG, WebP max 2MB)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => handleLogoUpload(e, false)}
                  style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}
                />
                {createForm.logoUrl && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img src={createForm.logoUrl} alt="Preview" style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
                    <button
                      type="button"
                      onClick={() => setCreateForm((p) => ({ ...p, logoUrl: '' }))}
                      style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '12px', cursor: 'pointer' }}
                    >
                      Remove Logo
                    </button>
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: '14px', color: '#60a5fa', borderBottom: '1px solid #1e293b', paddingBottom: '6px', marginBottom: '14px' }}>
                2. Owner (Tenant Admin) Account
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Owner First Name *</label>
                  <input
                    type="text"
                    required
                    value={createForm.ownerFirstName}
                    onChange={(e) => setCreateForm((p) => ({ ...p, ownerFirstName: e.target.value }))}
                    placeholder="e.g. Sarah"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Owner Last Name *</label>
                  <input
                    type="text"
                    required
                    value={createForm.ownerLastName}
                    onChange={(e) => setCreateForm((p) => ({ ...p, ownerLastName: e.target.value }))}
                    placeholder="e.g. Jenkins"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Owner Email (Login Username) *</label>
                  <input
                    type="email"
                    required
                    value={createForm.ownerEmail}
                    onChange={(e) => setCreateForm((p) => ({ ...p, ownerEmail: e.target.value }))}
                    placeholder="owner@restaurant.com"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Owner Phone</label>
                  <input
                    type="text"
                    value={createForm.ownerPhone}
                    onChange={(e) => setCreateForm((p) => ({ ...p, ownerPhone: e.target.value }))}
                    placeholder="+92 300 9998877"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '24px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Initial Password (min 6 chars) *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={createForm.ownerPassword}
                    onChange={(e) => setCreateForm((p) => ({ ...p, ownerPassword: e.target.value }))}
                    placeholder="••••••••••••"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>POS Quick PIN (6 Digits, auto-generated if blank)</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={createForm.ownerPin}
                    onChange={(e) => setCreateForm((p) => ({ ...p, ownerPin: e.target.value }))}
                    placeholder="Auto-generated if empty"
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
              </div>

              <h3 style={{ fontSize: '14px', color: '#60a5fa', borderBottom: '1px solid #1e293b', paddingBottom: '6px', marginBottom: '14px' }}>
                3. Business Modules &amp; Package Preset
              </h3>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                  Choose Package Preset:
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setCreateModules(new Set(PRESET_MODULES.starter))}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Starter (8 modules)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateModules(new Set(PRESET_MODULES.standard))}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Standard (15 modules)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateModules(new Set(PRESET_MODULES.full))}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Full (19 modules)
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Module Access Expiry Date (Optional)</label>
                <input
                  type="date"
                  value={createExpiresAt}
                  onChange={(e) => setCreateExpiresAt(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                {MODULE_GROUPS.map((group) => (
                  <div
                    key={group.title}
                    style={{
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.02)',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa', marginBottom: '6px' }}>
                      {group.title}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      {group.modules.map((m) => {
                        const isChecked = createModules.has(m.key);
                        const isRequired = m.required;
                        return (
                          <label
                            key={m.key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '11px',
                              color: isChecked ? '#f8fafc' : '#94a3b8',
                              cursor: isRequired ? 'default' : 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isRequired}
                              onChange={(e) =>
                                setCreateModules((prev) => applyModuleToggle(prev, m.key, e.target.checked))
                              }
                            />
                            <span>
                              {m.name}
                              {isRequired && <span style={{ color: '#eab308', fontSize: '10px', marginLeft: '4px' }}>*req</span>}
                              {m.hint && <span style={{ color: '#64748b', fontSize: '9px', display: 'block' }}>{m.hint}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  style={{ background: '#334155', color: '#f8fafc', border: 'none', padding: '9px 18px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ background: '#2563eb', color: '#ffffff', border: 'none', padding: '9px 20px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Create Business Tenant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUCCESS MODAL: NEW BUSINESS CREDENTIALS (TASK 5) */}
      {createdSuccessData && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #10b981',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '520px',
              padding: '28px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9)',
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎉</div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: '#10b981' }}>
                Business Created Successfully!
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '6px' }}>
                Share these initial credentials with the business owner:
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: '#1e293b', padding: '16px', borderRadius: '10px', fontSize: '13px' }}>
              <div>
                <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>Business Name</span>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{createdSuccessData.businessName}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>Business Code (Slug)</span>
                  <div style={{ fontWeight: 800, fontSize: '15px', color: '#60a5fa' }}>{createdSuccessData.slug}</div>
                </div>
                <button
                  type="button"
                  style={{ background: '#334155', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(createdSuccessData.slug);
                    showSuccess('Business Code copied!');
                  }}
                >
                  📋 Copy Code
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>Owner Email</span>
                  <div style={{ fontWeight: 700 }}>{createdSuccessData.ownerEmail}</div>
                </div>
                <button
                  type="button"
                  style={{ background: '#334155', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(createdSuccessData.ownerEmail);
                    showSuccess('Owner Email copied!');
                  }}
                >
                  📋 Copy Email
                </button>
              </div>

              <div>
                <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>Owner POS PIN</span>
                <div style={{ fontWeight: 800, fontSize: '16px', letterSpacing: '2px', color: '#fbbf24' }}>{createdSuccessData.ownerPin}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>Login URL</span>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>{createdSuccessData.loginUrl}</div>
                </div>
                <button
                  type="button"
                  style={{ background: '#334155', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(createdSuccessData.loginUrl);
                    showSuccess('Login URL copied!');
                  }}
                >
                  📋 Copy URL
                </button>
              </div>
            </div>

            <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '8px', fontSize: '12px', color: '#fbbf24' }}>
              ℹ️ The owner must log in and change their password upon first access.
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                style={{ background: '#10b981', color: '#fff', border: 'none', padding: '10px 28px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                onClick={() => setCreatedSuccessData(null)}
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT BUSINESS */}
      {editModalOpen && selectedTenant && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '560px',
              padding: '28px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Edit Business: {selectedTenant.name}</h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditBusiness}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Business Name</label>
                <input
                  type="text"
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Address</label>
                <input
                  type="text"
                  value={editForm.address || ''}
                  onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Phone</label>
                  <input
                    type="text"
                    value={editForm.phone || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Email</label>
                  <input
                    type="email"
                    value={editForm.email || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}
                  />
                </div>
              </div>

              {/* Logo Upload in Edit */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1' }}>Replace Logo (PNG, JPG, WebP max 2MB)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => handleLogoUpload(e, true)}
                  style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}
                />
                {editForm.logoUrl && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img src={editForm.logoUrl} alt="Logo" style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
                    <button
                      type="button"
                      onClick={() => setEditForm((p) => ({ ...p, logoUrl: null }))}
                      style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '12px', cursor: 'pointer' }}
                    >
                      Remove Logo
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  style={{ background: '#334155', color: '#f8fafc', border: 'none', padding: '9px 18px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ background: '#2563eb', color: '#ffffff', border: 'none', padding: '9px 20px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TENANT FEATURES */}
      {featuresModalOpen && selectedTenant && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setFeaturesModalOpen(false)}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '600px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: '24px',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Modules: {selectedTenant.name}</h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  Enable or disable modules for this business. Required modules and dependencies are enforced.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFeaturesModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {/* Presets */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                  Apply Package Preset:
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setTenantFeatureKeys(new Set(PRESET_MODULES.starter))}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Starter (8 modules)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTenantFeatureKeys(new Set(PRESET_MODULES.standard))}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Standard (15 modules)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTenantFeatureKeys(new Set(PRESET_MODULES.full))}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Full (19 modules)
                  </button>
                </div>
              </div>

              {/* Expiry Date */}
              <div style={{ marginBottom: '16px', padding: '12px', background: '#1e293b', borderRadius: '8px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px', fontWeight: 600 }}>
                  Module Access Expiration Date (Optional)
                </label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="date"
                    value={tenantExpiresAt}
                    onChange={(e) => setTenantExpiresAt(e.target.value)}
                    style={{
                      background: '#0f172a',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  {tenantExpiresAt && (
                    <button
                      type="button"
                      onClick={() => setTenantExpiresAt('')}
                      style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Clear Expiry
                    </button>
                  )}
                </div>
              </div>

              {/* Grouped Modules */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {MODULE_GROUPS.map((group) => (
                  <div
                    key={group.title}
                    style={{
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.02)',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa', marginBottom: '6px' }}>
                      {group.title}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      {group.modules.map((m) => {
                        const isChecked = tenantFeatureKeys.has(m.key);
                        const isRequired = m.required;
                        return (
                          <label
                            key={m.key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '11px',
                              color: isChecked ? '#f8fafc' : '#94a3b8',
                              cursor: isRequired ? 'default' : 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isRequired}
                              onChange={(e) =>
                                setTenantFeatureKeys((prev) => applyModuleToggle(prev, m.key, e.target.checked))
                              }
                            />
                            <span>
                              {m.name}
                              {isRequired && <span style={{ color: '#eab308', fontSize: '10px', marginLeft: '4px' }}>*req</span>}
                              {m.hint && <span style={{ color: '#64748b', fontSize: '9px', display: 'block' }}>{m.hint}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #1e293b' }}>
              <button
                type="button"
                onClick={() => setFeaturesModalOpen(false)}
                style={{ background: '#334155', color: '#f8fafc', border: 0, padding: '9px 18px', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTenantFeatures()}
                style={{ background: '#2563eb', color: '#fff', border: 0, padding: '9px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
              >
                Save Modules
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: RESET OWNER PASSWORD */}
      {resetPwModalOpen && selectedTenant && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '440px',
              padding: '28px',
            }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 8px 0' }}>Reset Owner Password</h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '18px' }}>
              Reset password for <strong>{selectedTenant.owner?.email || selectedTenant.name}</strong>.
            </p>

            <form onSubmit={handleResetPassword}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1', display: 'block', marginBottom: '6px' }}>New Password (min 6 chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newOwnerPassword}
                  onChange={(e) => setNewOwnerPassword(e.target.value)}
                  placeholder="••••••••••••"
                  style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setResetPwModalOpen(false)}
                  style={{ background: '#334155', color: '#f8fafc', border: 'none', padding: '9px 18px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ background: '#2563eb', color: '#ffffff', border: 'none', padding: '9px 20px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Set New Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformDashboardPage;
