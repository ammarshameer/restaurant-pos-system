import React, { useState, useEffect } from 'react';
import { rolesApi, RoleItem } from '../api/roles.api';
import { PERMISSION_MODULES, Permission } from '../types/permissions';

export const RolesPage: React.FC = () => {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal State
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [activeRole, setActiveRole] = useState<RoleItem | null>(null);

  // Form State
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<Permission>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await rolesApi.getRoles();
      setRoles(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const openCreateModal = () => {
    setActiveRole(null);
    setRoleName('');
    setRoleDescription('');
    setSelectedPermissions(new Set());
    setFormError(null);
    setModalMode('create');
  };

  const openEditModal = (role: RoleItem, mode: 'edit' | 'view' = 'edit') => {
    setActiveRole(role);
    setRoleName(role.name);
    setRoleDescription(role.description || '');
    setSelectedPermissions(new Set(role.permissions || []));
    setFormError(null);
    setModalMode(mode);
  };

  const closeModal = () => {
    setModalMode(null);
    setActiveRole(null);
    setFormError(null);
  };

  const togglePermission = (perm: Permission) => {
    if (modalMode === 'view' || activeRole?.isOwnerRole) return;
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) {
        next.delete(perm);
      } else {
        next.add(perm);
      }
      return next;
    });
  };

  const toggleModuleAll = (modulePerms: Permission[]) => {
    if (modalMode === 'view' || activeRole?.isOwnerRole) return;
    const allSelected = modulePerms.every((p) => selectedPermissions.has(p));
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        modulePerms.forEach((p) => next.delete(p));
      } else {
        modulePerms.forEach((p) => next.add(p));
      }
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) {
      setFormError('Role name is required');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      if (modalMode === 'create') {
        await rolesApi.createRole({
          name: roleName.trim(),
          description: roleDescription.trim() || undefined,
          permissions: Array.from(selectedPermissions),
        });
        setSuccessMessage(`Role "${roleName.trim()}" created successfully!`);
      } else if (modalMode === 'edit' && activeRole) {
        await rolesApi.updateRole(activeRole.id, {
          name: roleName.trim(),
          description: roleDescription.trim() || undefined,
          permissions: Array.from(selectedPermissions),
        });
        setSuccessMessage(`Role "${roleName.trim()}" updated successfully!`);
      }

      closeModal();
      await fetchRoles();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setFormError(err?.response?.data?.message || err.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: RoleItem) => {
    if (role.isSystem || role.isOwnerRole) {
      alert('System and Owner roles cannot be deleted.');
      return;
    }
    if (role.employeeCount > 0) {
      alert(`Cannot delete role "${role.name}" because it is currently assigned to ${role.employeeCount} employee(s).`);
      return;
    }
    if (!window.confirm(`Are you sure you want to delete the role "${role.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeletingId(role.id);
      await rolesApi.deleteRole(role.id);
      setSuccessMessage(`Role "${role.name}" deleted successfully.`);
      await fetchRoles();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      alert(err?.response?.data?.message || err.message || 'Failed to delete role');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="page-container roles-page" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 6px 0' }}>
            Roles & Permissions Management
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '14px' }}>
            Configure access levels and module permissions for your restaurant staff.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={openCreateModal}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span>➕</span>
          <span>Create Custom Role</span>
        </button>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#22c55e',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
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
            color: '#ef4444',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Roles List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          Loading restaurant roles...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
          {roles.map((role) => {
            const isOwner = role.isOwnerRole;
            const isSystem = role.isSystem;

            return (
              <div
                key={role.id}
                style={{
                  background: 'var(--bg-card, #1e293b)',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700 }}>
                        {role.name}
                      </h3>
                      <code style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                        {role.key}
                      </code>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {isOwner && (
                        <span
                          style={{
                            background: 'rgba(234, 179, 8, 0.2)',
                            color: '#eab308',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '12px',
                            textTransform: 'uppercase',
                          }}
                        >
                          Owner
                        </span>
                      )}
                      {isSystem && !isOwner && (
                        <span
                          style={{
                            background: 'rgba(59, 130, 246, 0.2)',
                            color: '#60a5fa',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '12px',
                            textTransform: 'uppercase',
                          }}
                        >
                          System
                        </span>
                      )}
                      {!isSystem && (
                        <span
                          style={{
                            background: 'rgba(168, 85, 247, 0.2)',
                            color: '#c084fc',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '12px',
                            textTransform: 'uppercase',
                          }}
                        >
                          Custom
                        </span>
                      )}
                    </div>
                  </div>

                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', minHeight: '36px', margin: '0 0 16px 0', lineHeight: 1.4 }}>
                    {role.description || (isOwner ? 'Full unrestricted access to all restaurant modules and settings.' : 'Customized staff role.')}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      👥 Assigned Staff: <strong style={{ color: 'var(--text-primary, #fff)' }}>{role.employeeCount}</strong>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      🔑 Permissions: <strong style={{ color: isOwner ? '#eab308' : 'var(--text-primary, #fff)' }}>{isOwner ? 'All (Unrestricted)' : role.permissions.length}</strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-color, rgba(255,255,255,0.06))', paddingTop: '14px' }}>
                  {isOwner ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, opacity: 0.7, cursor: 'not-allowed' }}
                      title="Owner role has full permissions and cannot be modified"
                      disabled
                    >
                      🔒 Locked System Role
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => openEditModal(role, isSystem ? 'edit' : 'edit')}
                      >
                        ✏️ {isSystem ? 'Adjust Permissions' : 'Edit Role'}
                      </button>
                      {!isSystem && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(role)}
                          disabled={deletingId === role.id || role.employeeCount > 0}
                          title={role.employeeCount > 0 ? 'Cannot delete role with assigned employees' : 'Delete this role'}
                        >
                          🗑️
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create / Edit Role */}
      {modalMode && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
            overflowY: 'auto',
          }}
          onClick={closeModal}
        >
          <div
            style={{
              background: 'var(--bg-card, #1e293b)',
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              borderRadius: '16px',
              maxWidth: '850px',
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 4px 0' }}>
                  {modalMode === 'create'
                    ? 'Create Custom Staff Role'
                    : `Edit Role: ${activeRole?.name}`}
                </h2>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                  Select granular module permissions to grant or revoke for this role.
                </p>
              </div>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '20px',
                  cursor: 'pointer',
                }}
                onClick={closeModal}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '24px', flex: 1, minHeight: 0 }}>
              {formError && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#ef4444',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '20px',
                    fontSize: '13px',
                  }}
                >
                  ⚠ {formError}
                </div>
              )}

              {/* Basic Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Role Name *
                  </label>
                  <input
                    type="text"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    disabled={activeRole?.isSystem}
                    placeholder="e.g. Shift Lead / Supervisor"
                    className="form-control"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                      color: 'var(--text-primary, #fff)',
                      opacity: activeRole?.isSystem ? 0.7 : 1,
                    }}
                    required
                  />
                  {activeRole?.isSystem && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      System role names cannot be renamed.
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Description
                  </label>
                  <input
                    type="text"
                    value={roleDescription}
                    onChange={(e) => setRoleDescription(e.target.value)}
                    placeholder="Brief description of staff responsibilities"
                    className="form-control"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                      color: 'var(--text-primary, #fff)',
                    }}
                  />
                </div>
              </div>

              {/* Permission Modules */}
              <div style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <label style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                    Module Permissions ({selectedPermissions.size} selected)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const allKeys = PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => p.key));
                        setSelectedPermissions(new Set(allKeys));
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSelectedPermissions(new Set())}
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {PERMISSION_MODULES.map((module) => {
                    const modulePermKeys = module.permissions.map((p) => p.key);
                    const allSelected = modulePermKeys.every((p) => selectedPermissions.has(p));
                    const someSelected = modulePermKeys.some((p) => selectedPermissions.has(p));

                    return (
                      <div
                        key={module.id}
                        style={{
                          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                          borderRadius: '10px',
                          background: 'rgba(0,0,0,0.15)',
                          padding: '14px 16px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '10px',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            paddingBottom: '8px',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 700, fontSize: '14px' }}>{module.name}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                              — {module.description}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleModuleAll(modulePermKeys)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: allSelected ? '#60a5fa' : 'var(--text-muted)',
                              fontSize: '12px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            {allSelected ? 'Uncheck All' : 'Check All'}
                          </button>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: '10px',
                          }}
                        >
                          {module.permissions.map((perm) => {
                            const isChecked = selectedPermissions.has(perm.key);
                            return (
                              <label
                                key={perm.key}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '8px',
                                  padding: '8px',
                                  borderRadius: '6px',
                                  background: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                                  border: isChecked ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid transparent',
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => togglePermission(perm.key)}
                                  style={{ marginTop: '2px', cursor: 'pointer' }}
                                />
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{perm.name}</div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{perm.description}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '12px',
                  marginTop: '24px',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                }}
              >
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : modalMode === 'create' ? 'Create Role' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RolesPage;
