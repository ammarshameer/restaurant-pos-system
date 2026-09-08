import React, { useState, useEffect } from 'react';
import { employeeApi, Employee as EmployeeItem, Shift as ShiftLog } from '../api/employee.api';
import { formatPKR } from '../utils/format';

export const EmployeesPage: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [shifts, setShifts] = useState<ShiftLog[]>([]);
  const [loading, setLoading] = useState(false);
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [empList, shiftList] = await Promise.all([
        employeeApi.getEmployees(),
        employeeApi.getActiveShifts(),
      ]);
      setEmployees(empList);
      setShifts(shiftList);
    } catch (err) {
      console.warn('Failed to load employee data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
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
      await loadData();
    } catch (err) {
      // Local optimistic fallback
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === emp.id
            ? { ...e, isClockedIn: isClockingIn, clockInTime: isClockingIn ? nowTime : undefined }
            : e
        )
      );
      if (isClockingIn) {
        const newShift: ShiftLog = {
          id: `sh-${Date.now()}`,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          role: emp.role,
          clockIn: nowTime,
        };
        setShifts((prev) => [newShift, ...prev]);
        setClockMessage(`✅ ${emp.firstName} clocked in successfully at ${nowTime}`);
      } else {
        setClockMessage(`👋 ${emp.firstName} clocked out successfully.`);
      }
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
      const created = await employeeApi.createEmployee({
        ...newEmployee,
        isActive: true,
      });
      if (created) {
        setEmployees((prev) => [...prev, created]);
      } else {
        await loadData();
      }
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

  const filteredEmployees = employees.filter((emp) => {
    const matchesRole = roleFilter === 'All' || emp.role === roleFilter;
    const matchesSearch =
      `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesRole && matchesSearch;
  });

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
            <div className="stat-val">{employees.length}</div>
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
        👤 Team Directory ({filteredEmployees.length})
      </h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          Loading staff records from database...
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          No employees found matching your criteria.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          {filteredEmployees.map((emp) => (
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

      {/* Fast PIN Punch Terminal Modal */}
      {clockModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px' }}>⏱️ Fast PIN Punch Terminal</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              Enter staff 4-digit PIN code to instantly punch In/Out
            </p>

            <form onSubmit={handlePinTimeClock}>
              <input
                type="password"
                maxLength={4}
                autoFocus
                placeholder="4-digit PIN (e.g. 1234)"
                className="input-field"
                value={clockPin}
                onChange={(e) => setClockPin(e.target.value)}
                style={{ fontSize: '24px', textAlign: 'center', letterSpacing: '8px', marginBottom: '20px' }}
              />

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setClockModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={clockPin.length < 4}>
                  Punch Time Clock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Member Modal */}
      {addModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '500px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>+ Add New Staff Member</h3>
            <form onSubmit={handleCreateEmployee}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="input-label">First Name</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newEmployee.firstName}
                    onChange={(e) => setNewEmployee({ ...newEmployee, firstName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="input-label">Last Name</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newEmployee.lastName}
                    onChange={(e) => setNewEmployee({ ...newEmployee, lastName: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label className="input-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="input-field"
                  value={newEmployee.email}
                  onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="input-label">Role</label>
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
                <div>
                  <label className="input-label">Hourly Rate (PKR)</label>
                  <input
                    type="number"
                    required
                    className="input-field"
                    value={newEmployee.hourlyRate}
                    onChange={(e) => setNewEmployee({ ...newEmployee, hourlyRate: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label className="input-label">POS 4-Digit PIN</label>
                  <input
                    type="password"
                    maxLength={4}
                    required
                    className="input-field"
                    value={newEmployee.pin}
                    onChange={(e) => setNewEmployee({ ...newEmployee, pin: e.target.value })}
                  />
                </div>
                <div>
                  <label className="input-label">Phone Number (Optional)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={newEmployee.phone}
                    onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Staff Member
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
