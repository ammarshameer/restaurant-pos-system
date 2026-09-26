import React, { useState, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { employeeApi, Employee as EmployeeItem, Shift as ShiftLog } from '../api/employee.api';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { formatPKR } from '../utils/format';

export const EmployeesPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [shifts, setShifts] = useState<ShiftLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [clockModalOpen, setClockModalOpen] = useState(false);
  const [clockPin, setClockPin] = useState('');
  const [clockMessage, setClockMessage] = useState<string | null>(null);

  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'SERVER' as EmployeeItem['role'],
    hourlyRate: 600,
    pin: '1234',
    phone: '',
  });

  // 1. Infinite Query for Employees Directory: 50 records per page, resets on filter/search change
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
      const shiftList = await employeeApi.getActiveShifts();
      setShifts(shiftList);
    };
    loadShifts();
  }, []);

  const activeEmployees = employees.filter((e) => e.isClockedIn);
  const totalLaborCost = shifts.reduce((sum, s) => sum + (s.laborCost || 0), 0);

  const roles = ['All', 'ADMIN', 'MANAGER', 'SERVER', 'BARTENDER', 'HOST', 'KITCHEN', 'CASHIER'];

  const handleClockToggle = async (emp: EmployeeItem) => {
    const isClockingIn = !emp.isClockedIn;
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      if (isClockingIn) {
        await employeeApi.clockIn(emp.id);
        setClockMessage(`✅ ${emp.firstName} clocked in successfully at ${nowTime}`);
      } else {
        await employeeApi.clockOut(emp.id);
        setClockMessage(`👋 ${emp.firstName} clocked out successfully.`);
      }
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      const updatedShifts = await employeeApi.getActiveShifts();
      setShifts(updatedShifts);
    } catch (err) {
      console.warn('Clock in/out error:', err);
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    }

    setTimeout(() => setClockMessage(null), 4000);
  };

  const handlePinTimeClock = async (e: React.FormEvent) => {
    e.preventDefault();
    const matched = employees.find((emp) => emp.pin === clockPin.trim());
    if (matched) {
      await handleClockToggle(matched);
      setClockPin('');
      setClockModalOpen(false);
    } else {
      alert('Invalid PIN code. Please check your staff 4-digit PIN.');
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployee.firstName || !newEmployee.lastName || !newEmployee.email) return;

    try {
      await employeeApi.createEmployee({
        ...newEmployee,
        isActive: true,
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setAddModalOpen(false);
      setNewEmployee({
        firstName: '',
        lastName: '',
        email: '',
        role: 'SERVER',
        hourlyRate: 600,
        pin: '1234',
        phone: '',
      });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create employee');
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>👥 Staff Directory & Time Clock (PKR)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database staff, PIN-based time punches, shifts, and labor tracking
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => setClockModalOpen(true)}>
            ⏱️ Fast PIN Punch Terminal
          </button>
          <button className="btn btn-primary" onClick={() => setAddModalOpen(true)}>
            + Add Staff Member
          </button>
        </div>
      </div>

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
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
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
            <div className="stat-val" style={{ color: '#34d399' }}>{activeEmployees.length}</div>
            <div className="stat-label">Currently On Shift</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            ⏱️
          </div>
          <div>
            <div className="stat-val">{shifts.length}</div>
            <div className="stat-label">Logged Shift Records</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#fbbf24' }}>{formatPKR(totalLaborCost)}</div>
            <div className="stat-label">Est. Logged Labor Cost</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '12px', flex: 1, minWidth: '280px' }}>
            <input
              type="text"
              placeholder="🔍 Search staff by name or email..."
              className="input-field"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
            {roles.map((r) => (
              <button
                key={r}
                className={`btn btn-sm ${roleFilter === r ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRoleFilter(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Staff Grid */}
      <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
        👤 Team Directory ({totalEmployeesCount || employees.length})
      </h3>

      {loadingEmployees && employees.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          Loading staff records from database...
        </div>
      ) : employees.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          No employees found matching your criteria.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          {employees.map((emp) => (
            <div key={emp.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ fontSize: '16px', fontWeight: 800 }}>
                    {emp.firstName} {emp.lastName}
                  </h4>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{emp.email}</div>
                  {emp.phone && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{emp.phone}</div>}
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background:
                      emp.role === 'ADMIN'
                        ? 'rgba(239, 68, 68, 0.15)'
                        : emp.role === 'MANAGER'
                        ? 'rgba(168, 85, 247, 0.15)'
                        : emp.role === 'KITCHEN'
                        ? 'rgba(245, 158, 11, 0.15)'
                        : 'rgba(99, 102, 241, 0.15)',
                    color:
                      emp.role === 'ADMIN'
                        ? '#f87171'
                        : emp.role === 'MANAGER'
                        ? '#c084fc'
                        : emp.role === 'KITCHEN'
                        ? '#fbbf24'
                        : 'var(--primary)',
                  }}
                >
                  {emp.role}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: 'var(--bg-secondary)', padding: '10px', borderRadius: 'var(--radius-md)', fontSize: '12px' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Hourly Wage</div>
                  <div style={{ fontWeight: 800, color: '#38bdf8' }}>{formatPKR(emp.hourlyRate)}/hr</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>POS PIN</div>
                  <div style={{ fontWeight: 800, letterSpacing: '2px' }}>•••• ({emp.pin})</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '10px', color: emp.isClockedIn ? 'var(--success)' : 'var(--text-muted)' }}>
                    {emp.isClockedIn ? '🟢 On Clock' : '⚪ Clocked Out'}
                  </span>
                  {emp.clockInTime && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({emp.clockInTime})</span>}
                </div>

                <button
                  className={`btn btn-sm ${emp.isClockedIn ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => handleClockToggle(emp)}
                >
                  {emp.isClockedIn ? 'Clock Out' : 'Clock In'}
                </button>
              </div>
            </div>
          ))}
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
      {addModalOpen && (
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="input-label">
                      <span>Assigned Role</span>
                      <span className="label-hint">Permissions</span>
                    </label>
                    <select
                      className="input-field"
                      value={newEmployee.role}
                      onChange={(e) => setNewEmployee({ ...newEmployee, role: e.target.value as any })}
                    >
                      <option value="SERVER">Server</option>
                      <option value="MANAGER">Manager</option>
                      <option value="ADMIN">Admin</option>
                      <option value="KITCHEN">Kitchen / Chef</option>
                      <option value="CASHIER">Cashier</option>
                      <option value="BARTENDER">Bartender</option>
                      <option value="HOST">Host</option>
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
                      <span>Terminal 4-Digit PIN</span>
                      <span className="label-hint">Passcode</span>
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      required
                      placeholder="e.g. 1234"
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
    </div>
  );
};

export default EmployeesPage;
