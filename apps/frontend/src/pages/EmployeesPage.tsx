import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { employeeApi, Employee as EmployeeItem, Shift as ShiftLog } from '../api/employee.api';
import { rolesApi, RoleItem } from '../api/roles.api';
import { RootState } from '../store/store';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { formatPersonName, formatPKR } from '../utils/format';
import { PERMISSION_MODULES } from '../types/permissions';

export const EmployeesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useSelector((state: RootState) => state.auth);

  const canManageEmployees =
    user?.isOwnerRole === true ||
    (user?.permissions || []).includes('employees.manage');

  const [shifts, setShifts] = useState<ShiftLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [availableRoles, setAvailableRoles] = useState<RoleItem[]>([]);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [clockModalOpen, setClockModalOpen] = useState(false);
  const [clockPin, setClockPin] = useState('');
  const [clockMessage, setClockMessage] = useState<string | null>(null);

  // New Employee Form
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'WAITER' as EmployeeItem['role'],
    roleId: '',
    hourlyRate: 600,
    pin: '',
    phone: '',
  });

  // Edit Employee & Permissions Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeItem | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    hourlyRate: 600,
    role: 'WAITER',
    roleId: '',
    pin: '',
    password: '',
    isActive: true,
  });
  const [inheritedPerms, setInheritedPerms] = useState<string[]>([]);
  const [permissionOverrides, setPermissionOverrides] = useState<Record<string, boolean | null>>({});
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Temp Password Modal
  const [tempPasswordModalOpen, setTempPasswordModalOpen] = useState(false);
  const [tempPasswordData, setTempPasswordData] = useState<{
    name: string;
    email: string;
    temporaryPassword: string;
  } | null>(null);

  // Load dynamic roles from API
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const data = await rolesApi.getRoles();
        setAvailableRoles(data);
        if (data.length > 0 && !newEmployee.roleId) {
          const defaultRole = data.find((r) => !r.isOwnerRole) || data[0];
          setNewEmployee((prev) => ({
            ...prev,
            role: defaultRole.key as any,
            roleId: defaultRole.id,
          }));
        }
      } catch (e) {
        console.warn('Failed to load roles for employee filter:', e);
      }
    };
    fetchRoles();
  }, []);

  // 1. Infinite Query for Employees Directory
  const {
    data: employeesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: loadingEmployees,
  } = useInfiniteQuery({
    queryKey: ['employees', roleFilter, searchQuery],
    queryFn: ({ pageParam = 1 }) =>
      employeeApi.getEmployeesPaginated({
        page: pageParam,
        limit: 50,
        role: roleFilter !== 'All' ? roleFilter : undefined,
        search: searchQuery.trim() || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const employees = useMemo(() => {
    return employeesData?.pages.flatMap((p) => p.data) || [];
  }, [employeesData]);

  const totalEmployeesCount = employeesData?.pages[0]?.totalCount ?? 0;

  // Active Shifts
  useEffect(() => {
    const loadShifts = async () => {
      try {
        const shiftList = await employeeApi.getActiveShifts();
        setShifts(shiftList);
      } catch (e) {
        console.warn('Failed to load active shifts:', e);
      }
    };
    loadShifts();
  }, []);

  // Handle Clock In/Out via Fast PIN
  const handlePinTimeClock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clockPin || clockPin.length < 4) return;

    const matchedEmp = employees.find((emp) => emp.pin === clockPin && emp.isActive);
    if (!matchedEmp) {
      setClockMessage('❌ Invalid PIN or inactive employee. Please try again.');
      setTimeout(() => setClockMessage(null), 4000);
      setClockPin('');
      return;
    }

    try {
      if (matchedEmp.isClockedIn) {
        await employeeApi.clockOut(matchedEmp.id);
        setClockMessage(`👋 ${formatPersonName(`${matchedEmp.firstName} ${matchedEmp.lastName}`)} clocked out successfully.`);
      } else {
        await employeeApi.clockIn(matchedEmp.id);
        setClockMessage(`✅ ${formatPersonName(`${matchedEmp.firstName} ${matchedEmp.lastName}`)} clocked in successfully.`);
      }
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      const updatedShifts = await employeeApi.getActiveShifts();
      setShifts(updatedShifts);
      setClockModalOpen(false);
      setClockPin('');
      setTimeout(() => setClockMessage(null), 5000);
    } catch (err: any) {
      setClockMessage(`❌ Error: ${err?.response?.data?.error || err.message}`);
    }
  };

  const handleClockToggle = async (emp: EmployeeItem) => {
    try {
      if (emp.isClockedIn) {
        await employeeApi.clockOut(emp.id);
        setClockMessage(`👋 ${formatPersonName(`${emp.firstName} ${emp.lastName}`)} clocked out.`);
      } else {
        await employeeApi.clockIn(emp.id);
        setClockMessage(`✅ ${formatPersonName(`${emp.firstName} ${emp.lastName}`)} clocked in.`);
      }
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      const updatedShifts = await employeeApi.getActiveShifts();
      setShifts(updatedShifts);
      setTimeout(() => setClockMessage(null), 4000);
    } catch (err: any) {
      alert(`Clock error: ${err?.response?.data?.error || err.message}`);
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployee.firstName || !newEmployee.lastName || !newEmployee.email) return;

    try {
      const created = await employeeApi.createEmployee({
        ...newEmployee,
        password: newEmployee.password.trim() || undefined,
        isActive: true,
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setAddModalOpen(false);
      if (created?.pin && !newEmployee.pin.trim()) {
        alert(
          `${created.firstName} ${created.lastName} was created.\n\nTerminal PIN (auto-generated): ${created.pin}\nShare this with the staff member so they can sign in and clock in.`
        );
      }
      setNewEmployee({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        role: (availableRoles.find((r) => !r.isOwnerRole)?.key || 'WAITER') as any,
        roleId: availableRoles.find((r) => !r.isOwnerRole)?.id || '',
        hourlyRate: 600,
        pin: '',
        phone: '',
      });
    } catch (err: any) {
      alert(err.response?.data?.error || err.response?.data?.message || 'Failed to create employee');
    }
  };

  // Open Edit Staff Modal
  const handleOpenEdit = async (emp: EmployeeItem) => {
    setEditingEmployee(emp);
    setEditForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      phone: emp.phone || '',
      hourlyRate: emp.hourlyRate || 0,
      role: emp.role,
      roleId: emp.roleId || '',
      pin: emp.pin || '',
      password: '',
      isActive: emp.isActive,
    });
    setEditError(null);
    setLoadingPerms(true);
    setEditModalOpen(true);

    try {
      const res = await employeeApi.getPermissions(emp.id);
      setInheritedPerms(res.rolePermissions || []);
      const map: Record<string, boolean | null> = {};
      (res.overrides || []).forEach((ov) => {
        map[ov.permission] = ov.granted;
      });
      setPermissionOverrides(map);
    } catch (err) {
      console.warn('Failed to load employee permissions:', err);
      setInheritedPerms([]);
      setPermissionOverrides({});
    } finally {
      setLoadingPerms(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    setEditSaving(true);
    setEditError(null);

    try {
      // 1. Update basic employee data
      const updatePayload: any = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || undefined,
        hourlyRate: editForm.hourlyRate,
        roleId: editForm.roleId || undefined,
        role: editForm.role,
        pin: editForm.pin || undefined,
        isActive: editForm.isActive,
      };
      if (editForm.password.trim()) {
        updatePayload.password = editForm.password.trim();
      }

      await employeeApi.updateEmployee(editingEmployee.id, updatePayload);

      // 2. Update permission overrides if not owner
      if (!editingEmployee.isOwner) {
        const overridesPayload: Array<{ permission: string; granted: boolean }> = [];
        Object.entries(permissionOverrides).forEach(([perm, val]) => {
          if (val === true || val === false) {
            overridesPayload.push({ permission: perm, granted: val });
          }
        });
        await employeeApi.updatePermissions(editingEmployee.id, overridesPayload);
      }

      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setEditModalOpen(false);
    } catch (err: any) {
      setEditError(err?.response?.data?.error || err?.message || 'Failed to update employee');
    } finally {
      setEditSaving(false);
    }
  };

  // Reset Password for staff member
  const handleResetPassword = async (emp: EmployeeItem) => {
    if (!confirm(`Reset login password for ${emp.firstName} ${emp.lastName}?`)) return;
    try {
      const res = await employeeApi.resetPassword(emp.id);
      setTempPasswordData({
        name: `${emp.firstName} ${emp.lastName}`,
        email: emp.email,
        temporaryPassword: res.temporaryPassword,
      });
      setTempPasswordModalOpen(true);
    } catch (err: any) {
      alert(`Password reset error: ${err?.response?.data?.error || err.message}`);
    }
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'OWNER':
        return { background: 'rgba(234, 179, 8, 0.2)', color: '#eab308' };
      case 'ADMIN':
        return { background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' };
      case 'MANAGER':
        return { background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' };
      case 'CHEF':
      case 'KITCHEN':
        return { background: 'var(--warning-glow)', color: 'var(--warning)' };
      case 'CASHIER':
        return { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' };
      case 'WAITER':
      case 'SERVER':
        return { background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' };
      default:
        return { background: 'rgba(var(--primary-rgb), 0.15)', color: 'var(--primary)' };
    }
  };

  const tenantSlug = user?.restaurantSlug || localStorage.getItem('pos_tenant_slug') || '';

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>👥 Staff Directory & Time Clock</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live restaurant staff, PIN-based time punches, shifts, and per-employee access controls
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => setClockModalOpen(true)}>
            ⏱️ Fast PIN Punch Terminal
          </button>
          {canManageEmployees && (
            <button className="btn btn-primary" onClick={() => setAddModalOpen(true)}>
              + Add Staff Member
            </button>
          )}
        </div>
      </div>

      {/* Business Code Banner for Employee Login */}
      {tenantSlug && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 18px',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🏢</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>
                Employees need this Business Code to log in via PIN:
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Provide this Business Code ({tenantSlug}) + employee's 4-digit PIN for POS login.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <code
              style={{
                padding: '6px 12px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontWeight: 800,
                fontSize: '14px',
                letterSpacing: '1px',
                color: 'var(--primary)',
              }}
            >
              {tenantSlug}
            </code>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                navigator.clipboard.writeText(tenantSlug);
                setCopyNotice('Business Code copied!');
                setTimeout(() => setCopyNotice(null), 3000);
              }}
            >
              📋 {copyNotice || 'Copy Code'}
            </button>
          </div>
        </div>
      )}

      {/* Clock message banner */}
      {clockMessage && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid var(--success)',
            color: 'var(--success)',
            padding: '12px 18px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            fontWeight: 700,
          }}
        >
          {clockMessage}
        </div>
      )}

      {/* Top Stat Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(var(--primary-rgb), 0.15)', color: 'var(--primary)' }}>
            👥
          </div>
          <div>
            <div className="stat-val">{totalEmployeesCount || employees.length}</div>
            <div className="stat-label">Active Staff</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            🟢
          </div>
          <div>
            <div className="stat-val">{shifts.length}</div>
            <div className="stat-label">On Clock Right Now</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            💼
          </div>
          <div>
            <div className="stat-val">
              {shifts
                .reduce((acc, curr) => acc + (curr.hoursWorked || 0), 0)
                .toFixed(1)}{' '}
              hrs
            </div>
            <div className="stat-label">Total Shift Hours</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--accent)' }}>
            💵
          </div>
          <div>
            <div className="stat-val">
              {formatPKR(shifts.reduce((acc, curr) => acc + (curr.laborCost || 0), 0))}
            </div>
            <div className="stat-label">Estimated Labor Cost</div>
          </div>
        </div>
      </div>

      {/* Search & Role Filter */}
      <div className="card" style={{ marginBottom: '20px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input-field"
            placeholder="🔍 Search staff by name, email, or PIN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: '320px', padding: '8px 12px' }}
          />

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Role Filter:</span>
            {['All', ...availableRoles.map((r) => r.key)].map((rKey) => (
              <button
                key={rKey}
                className={`btn btn-sm ${roleFilter === rKey ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRoleFilter(rKey)}
              >
                {rKey}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Staff Grid */}
      {loadingEmployees ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading staff directory...</div>
      ) : employees.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          No staff members found matching criteria.
        </div>
      ) : (
        <div className="grid-cols-3" style={{ marginBottom: '20px' }}>
          {employees.map((emp) => {
            const roleStyle = getRoleBadgeStyle(emp.role);
            return (
              <div
                key={emp.id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  padding: '16px',
                  border: emp.isClockedIn ? '1px solid var(--success)' : '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '16px' }}>
                      {formatPersonName(`${emp.firstName} ${emp.lastName}`)}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{emp.email}</div>
                    {emp.phone && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>📞 {emp.phone}</div>}
                  </div>
                  <span
                    className="badge"
                    style={{ ...roleStyle, fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}
                  >
                    {emp.roleName || emp.role}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: 'var(--bg-secondary)', padding: '10px', borderRadius: 'var(--radius-md)', fontSize: '12px' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Hourly Wage</div>
                    <div style={{ fontWeight: 800, color: '#38bdf8' }}>{formatPKR(emp.hourlyRate)}/hr</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>POS PIN</div>
                    <div style={{ fontWeight: 800, letterSpacing: '2px' }}>
                      {canManageEmployees && emp.pin ? `•••• (${emp.pin})` : '••••'}
                    </div>
                  </div>
                </div>

                {/* Clock Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: emp.isClockedIn ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {emp.isClockedIn ? '🟢 On Clock' : '⚪ Clocked Out'}
                    </span>
                    {emp.clockInTime && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({emp.clockInTime})</span>}
                  </div>
                  <button
                    className={`btn btn-sm ${emp.isClockedIn ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                    onClick={() => handleClockToggle(emp)}
                  >
                    {emp.isClockedIn ? 'Clock Out' : 'Clock In'}
                  </button>
                </div>

                {/* Management Action Buttons */}
                {canManageEmployees && (
                  <div style={{ display: 'flex', gap: '6px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, fontSize: '11px', fontWeight: 600 }}
                      onClick={() => handleOpenEdit(emp)}
                    >
                      ✏️ Edit & Access
                    </button>
                    {!emp.isOwner && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '11px', fontWeight: 600 }}
                        onClick={() => handleResetPassword(emp)}
                        title="Generate temporary login password"
                      >
                        🔑 Reset PW
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <InfiniteScrollSentinel
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        totalCount={totalEmployeesCount}
        currentCount={employees.length}
        emptyText="No staff records found"
      />

      {/* Fast PIN Punch Terminal Modal */}
      {clockModalOpen && (
        <div className="modal-backdrop" onClick={() => setClockModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '420px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text" style={{ textAlign: 'left' }}>
                <h3 className="modal-title">⏱️ PIN Punch Terminal</h3>
                <p className="modal-subtitle">Instant shift Clock-In / Clock-Out</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setClockModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePinTimeClock}>
              <div className="modal-body" style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '18px' }}>
                  Enter employee 4-digit security PIN to punch time
                </p>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <input
                    type="password"
                    maxLength={4}
                    autoFocus
                    placeholder="••••"
                    className="input-field"
                    value={clockPin}
                    onChange={(e) => setClockPin(e.target.value)}
                    style={{ fontSize: '28px', textAlign: 'center', letterSpacing: '12px', padding: '14px', fontWeight: 800 }}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setClockModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={clockPin.length < 4}>
                  ⏱️ Punch Time Clock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Member Modal */}
      {addModalOpen && canManageEmployees && (
        <div className="modal-backdrop" onClick={() => setAddModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">👥 Add Staff Member</h3>
                <p className="modal-subtitle">Create a new restaurant team member and POS account</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAddModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateEmployee}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="input-label">
                      <span>First Name</span>
                      <span className="label-hint">Required</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Alex"
                      className="input-field"
                      value={newEmployee.firstName}
                      onChange={(e) => setNewEmployee({ ...newEmployee, firstName: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="input-label">
                      <span>Last Name</span>
                      <span className="label-hint">Required</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Morgan"
                      className="input-field"
                      value={newEmployee.lastName}
                      onChange={(e) => setNewEmployee({ ...newEmployee, lastName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="input-label">
                    <span>Email Address</span>
                    <span className="label-hint">Login username</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. alex@restaurant.com"
                    className="input-field"
                    value={newEmployee.email}
                    onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="input-label">
                    <span>Login Password</span>
                    <span className="label-hint">Optional (Email Login)</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Leave blank for PIN-only login"
                    className="input-field"
                    value={newEmployee.password}
                    onChange={(e) => setNewEmployee({ ...newEmployee, password: e.target.value })}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Leave blank to use PIN-only login. Set a password to allow email + password login.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="input-label">
                      <span>Assigned Role</span>
                      <span className="label-hint">Permissions</span>
                    </label>
                    <select
                      className="input-field"
                      value={newEmployee.roleId || newEmployee.role}
                      onChange={(e) => {
                        const val = e.target.value;
                        const matchedRole = availableRoles.find((r) => r.id === val || r.key === val);
                        if (matchedRole) {
                          setNewEmployee({
                            ...newEmployee,
                            role: matchedRole.key as any,
                            roleId: matchedRole.id,
                          });
                        } else {
                          setNewEmployee({
                            ...newEmployee,
                            role: val as any,
                          });
                        }
                      }}
                    >
                      {availableRoles
                        .filter((r) => !r.isOwnerRole)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.key})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="input-label">
                      <span>Hourly Pay Rate (PKR)</span>
                      <span className="label-hint">Payroll</span>
                    </label>
                    <input
                      type="number"
                      required
                      className="input-field"
                      value={newEmployee.hourlyRate}
                      onChange={(e) => setNewEmployee({ ...newEmployee, hourlyRate: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: 0 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">
                      <span>Terminal PIN (4–6 digits)</span>
                      <span className="label-hint">Optional</span>
                    </label>
                    <input
                      type="password"
                      maxLength={6}
                      placeholder="Leave blank to auto-generate"
                      className="input-field"
                      value={newEmployee.pin}
                      onChange={(e) => setNewEmployee({ ...newEmployee, pin: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">
                      <span>Contact Phone</span>
                      <span className="label-hint">Optional</span>
                    </label>
                    <input
                      type="text"
                      placeholder="+92 300 1234567"
                      className="input-field"
                      value={newEmployee.phone}
                      onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  ✓ Save Staff Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Member & Permissions Modal */}
      {editModalOpen && editingEmployee && (
        <div className="modal-backdrop" onClick={() => setEditModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">✏️ Edit Staff & Menu Access</h3>
                <p className="modal-subtitle">
                  Configure details and customize module permissions for {editingEmployee.firstName} {editingEmployee.lastName}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1, paddingRight: '12px' }}>
                {editError && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '13px', marginBottom: '14px' }}>
                    {editError}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="input-label">First Name *</label>
                    <input
                      type="text"
                      required
                      className="input-field"
                      value={editForm.firstName}
                      onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Last Name *</label>
                    <input
                      type="text"
                      required
                      className="input-field"
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="input-label">Email Address *</label>
                    <input
                      type="email"
                      required
                      className="input-field"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Contact Phone</label>
                    <input
                      type="text"
                      className="input-field"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="input-label">Role</label>
                    <select
                      className="input-field"
                      disabled={editingEmployee.isOwner}
                      value={editForm.roleId || editForm.role}
                      onChange={(e) => {
                        const val = e.target.value;
                        const matched = availableRoles.find((r) => r.id === val || r.key === val);
                        setEditForm({
                          ...editForm,
                          role: matched ? matched.key : val,
                          roleId: matched ? matched.id : '',
                        });
                      }}
                    >
                      {availableRoles
                        .filter((r) => !r.isOwnerRole || editingEmployee.isOwner)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.key})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="input-label">Hourly Rate (PKR)</label>
                    <input
                      type="number"
                      required
                      className="input-field"
                      value={editForm.hourlyRate}
                      onChange={(e) => setEditForm({ ...editForm, hourlyRate: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="input-label">Terminal PIN (4 Digits)</label>
                    <input
                      type="password"
                      maxLength={4}
                      className="input-field"
                      value={editForm.pin}
                      onChange={(e) => setEditForm({ ...editForm, pin: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="input-label">New Password (Optional)</label>
                    <input
                      type="password"
                      placeholder="Leave blank to keep unchanged"
                      className="input-field"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    />
                  </div>
                </div>

                {!editingEmployee.isOwner && (
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={editForm.isActive}
                        onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                      />
                      Active Account (uncheck to deactivate staff member)
                    </label>
                  </div>
                )}

                {/* Per-Employee Granular Module Access (Task 2) */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>🛡️ Module & Menu Access</h4>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Override default role permissions specifically for this staff member.
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '11px' }}
                        onClick={() => setPermissionOverrides({})}
                      >
                        Reset to Role Defaults
                      </button>
                      <Link to="/roles" style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>
                        Edit Roles →
                      </Link>
                    </div>
                  </div>

                  {editingEmployee.isOwner ? (
                    <div style={{ padding: '12px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', borderRadius: '6px', fontSize: '13px' }}>
                      👑 Business Owner has full, unrestricted access to all modules and menus.
                    </div>
                  ) : loadingPerms ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading permissions...</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {PERMISSION_MODULES.map((module) => (
                        <div
                          key={module.id}
                          style={{
                            background: 'var(--bg-secondary)',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            padding: '10px 14px',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', color: 'var(--text-primary)' }}>
                            {module.name}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {module.permissions.map((perm) => {
                              const isInherited = inheritedPerms.includes(perm.key);
                              const overrideVal = permissionOverrides[perm.key];
                              const effectiveGranted = overrideVal === true ? true : overrideVal === false ? false : isInherited;

                              return (
                                <div
                                  key={perm.key}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '12px',
                                    padding: '4px 0',
                                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                  }}
                                >
                                  <div>
                                    <span style={{ fontWeight: 600 }}>{perm.name}</span>
                                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px', fontSize: '11px' }}>
                                      ({perm.key})
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    <button
                                      type="button"
                                      className={`btn btn-sm ${overrideVal === undefined || overrideVal === null ? 'btn-primary' : 'btn-secondary'}`}
                                      style={{ padding: '2px 6px', fontSize: '10px' }}
                                      onClick={() => {
                                        const next = { ...permissionOverrides };
                                        delete next[perm.key];
                                        setPermissionOverrides(next);
                                      }}
                                    >
                                      Role ({isInherited ? '✓' : '✕'})
                                    </button>
                                    <button
                                      type="button"
                                      className={`btn btn-sm ${overrideVal === true ? 'btn-success' : 'btn-secondary'}`}
                                      style={{ padding: '2px 6px', fontSize: '10px' }}
                                      onClick={() => setPermissionOverrides({ ...permissionOverrides, [perm.key]: true })}
                                    >
                                      Grant (+)
                                    </button>
                                    <button
                                      type="button"
                                      className={`btn btn-sm ${overrideVal === false ? 'btn-danger' : 'btn-secondary'}`}
                                      style={{ padding: '2px 6px', fontSize: '10px' }}
                                      onClick={() => setPermissionOverrides({ ...permissionOverrides, [perm.key]: false })}
                                    >
                                      Deny (–)
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={editSaving}>
                  {editSaving ? 'Saving...' : '✓ Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Temporary Password Display Modal */}
      {tempPasswordModalOpen && tempPasswordData && (
        <div className="modal-backdrop" onClick={() => setTempPasswordModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">🔑 Temporary Login Password</h3>
                <p className="modal-subtitle">Share this password with the staff member</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setTempPasswordModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Staff Member:</div>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>{tempPasswordData.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{tempPasswordData.email}</div>
              </div>

              <div
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px dashed var(--border-color)',
                  borderRadius: '8px',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Temporary Password
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '2px', color: '#10b981', userSelect: 'all' }}>
                  {tempPasswordData.temporaryPassword}
                </div>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                This password has been set. The employee can now log in using their email and this password, and will be prompted to change it.
              </p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(tempPasswordData.temporaryPassword);
                  setTempPasswordModalOpen(false);
                }}
              >
                📋 Copy Password & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeesPage;
