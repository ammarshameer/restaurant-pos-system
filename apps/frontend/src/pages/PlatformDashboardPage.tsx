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
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [resetPwModalOpen, setResetPwModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenant | null>(null);
  const [featuresModalOpen, setFeaturesModalOpen] = useState(false);
  const [tenantFeatures, setTenantFeatures] = useState<Array<{ key: string; enabled: boolean; expiresAt?: string | null }>>([]);

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
    try {
      await platformApi.createRestaurant(createForm);
      showSuccess(`Business "${createForm.businessName}" created successfully!`);
      setCreateModalOpen(false);
      setCreateForm(initialCreateForm);
      loadTenants();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to create business');
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
      setTenantFeatures(data.features || []);
      setFeaturesModalOpen(true);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to load tenant features');
    }
  };

  const saveTenantFeatures = async () => {
    if (!selectedTenant) return;
    try {
      await platformApi.updateTenantFeatures(selectedTenant.id, tenantFeatures);
      showSuccess(`Features updated for "${selectedTenant.name}".`);
      setFeaturesModalOpen(false);
      setSelectedTenant(null);
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
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Created</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                      Loading businesses...
                    </td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
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
                        <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: '4px', color: '#60a5fa' }}>
                          {t.slug}
                        </code>
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
                  <label style={{ fontSize: '12px', color: '#cbd5e1' }}>POS Quick PIN (4 Digits, auto-generated if blank)</label>
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
            style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', width: '420px', padding: '24px' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>Features: {selectedTenant.name}</h2>
            {tenantFeatures.map((feature, index) => (
              <label key={feature.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
                <span>{feature.key}</span>
                <input
                  type="checkbox"
                  checked={feature.enabled}
                  onChange={(event) => setTenantFeatures((current) => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, enabled: event.target.checked } : item
                  ))}
                />
              </label>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button type="button" onClick={() => setFeaturesModalOpen(false)} style={{ background: '#334155', color: '#fff', border: 0, padding: '9px 18px', borderRadius: 6 }}>
                Cancel
              </button>
              <button type="button" onClick={() => void saveTenantFeatures()} style={{ background: '#2563eb', color: '#fff', border: 0, padding: '9px 18px', borderRadius: 6, fontWeight: 700 }}>
                Save Features
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
