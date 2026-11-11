import React, { useState, useEffect } from 'react';
import {
  payrollApi,
  PayrollRun,
  PayrollLineItem,
  PayrollSettings,
  EmployeeAdvance,
  PayrollTimeEntry,
  Payslip,
} from '../api/payroll.api';
import { employeeApi, Employee } from '../api/employee.api';
import { useSelector } from 'react-redux';
import { RootState } from '../store/store';

export const PayrollPage: React.FC = () => {
  const user = useSelector((state: RootState) => state.auth.user);
  const permissions = user?.permissions || [];
  const isOwner = Boolean(user?.isOwnerRole || user?.role === 'OWNER');
  const canManage = isOwner || permissions.includes('payroll.manage');
  const canPay = isOwner || permissions.includes('payroll.pay');

  const currentMonthStr = new Date().toISOString().slice(0, 7);

  // Active view tab
  const [activeTab, setActiveTab] = useState<'RUN' | 'ADVANCES' | 'TIME_ENTRIES' | 'SETTINGS'>('RUN');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);

  // Data
  const [currentRun, setCurrentRun] = useState<PayrollRun | null>(null);
  const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
  const [timeEntries, setTimeEntries] = useState<PayrollTimeEntry[]>([]);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Loading & Alerts
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [showEditLineModal, setShowEditLineModal] = useState<boolean>(false);
  const [activeEditLine, setActiveEditLine] = useState<PayrollLineItem | null>(null);
  const [editBase, setEditBase] = useState<string>('');
  const [editOtHours, setEditOtHours] = useState<string>('');
  const [editOtPay, setEditOtPay] = useState<string>('');
  const [editAllowances, setEditAllowances] = useState<string>('');
  const [editBonus, setEditBonus] = useState<string>('');
  const [editDeductions, setEditDeductions] = useState<string>('');
  const [editAdvanceRecovered, setEditAdvanceRecovered] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');

  const [showPayslipModal, setShowPayslipModal] = useState<boolean>(false);
  const [activePayslip, setActivePayslip] = useState<Payslip | null>(null);
  const [payslipFormat, setPayslipFormat] = useState<'A4' | 'THERMAL_80MM'>('A4');

  const [showPayModal, setShowPayModal] = useState<boolean>(false);
  const [payoutMethod, setPayoutMethod] = useState<string>('BANK_TRANSFER');

  const [showAdvanceModal, setShowAdvanceModal] = useState<boolean>(false);
  const [advEmpId, setAdvEmpId] = useState<string>('');
  const [advAmount, setAdvAmount] = useState<string>('');
  const [advInstalment, setAdvInstalment] = useState<string>('');
  const [advReason, setAdvReason] = useState<string>('');

  const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
  const [activeCorrectionEntry, setActiveCorrectionEntry] = useState<PayrollTimeEntry | null>(null);
  const [correctClockIn, setCorrectClockIn] = useState<string>('');
  const [correctClockOut, setCorrectClockOut] = useState<string>('');
  const [correctReason, setCorrectReason] = useState<string>('');

  // Settings form
  const [setWorkHours, setSetWorkHours] = useState<number>(8);
  const [setWorkDays, setSetWorkDays] = useState<number>(26);
  const [setOtMult, setSetOtMult] = useState<number>(1.5);
  const [setOtApproval, setSetOtApproval] = useState<boolean>(true);

  const loadRun = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const run = await payrollApi.getRunDetails(selectedMonth);
      setCurrentRun(run);
    } catch (err: any) {
      if (err.response?.status === 404) {
        setCurrentRun(null);
      } else {
        setErrorMsg(err.response?.data?.error || err.message || 'Failed to load payroll run');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadAdvances = async () => {
    try {
      const res = await payrollApi.getAdvances({ limit: 50 });
      setAdvances(res.data);
    } catch (err) {
      console.error('Failed to load advances:', err);
    }
  };

  const loadTimeEntries = async () => {
    try {
      const res = await payrollApi.getTimeEntries({ month: selectedMonth, limit: 50 });
      setTimeEntries(res.data);
    } catch (err) {
      console.error('Failed to load time entries:', err);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await payrollApi.getSettings();
      setSettings(s);
      setSetWorkHours(s.workdayHours);
      setSetWorkDays(s.workdaysPerMonth);
      setSetOtMult(s.overtimeMultiplier);
      setSetOtApproval(s.overtimeApprovalRequired);
    } catch (err) {
      console.error('Failed to load payroll settings:', err);
    }
  };

  const loadEmployees = async () => {
    try {
      const emps = await employeeApi.getEmployees();
      setEmployees(emps.filter((e) => e.isActive));
      if (emps.length > 0 && !advEmpId) {
        setAdvEmpId(emps[0].id);
      }
    } catch (err) {
      console.error('Failed to load employees:', err);
    }
  };

  useEffect(() => {
    loadSettings();
    loadEmployees();
  }, []);

  useEffect(() => {
    if (activeTab === 'RUN') {
      loadRun();
    } else if (activeTab === 'ADVANCES') {
      loadAdvances();
    } else if (activeTab === 'TIME_ENTRIES') {
      loadTimeEntries();
    } else if (activeTab === 'SETTINGS') {
      loadSettings();
    }
  }, [selectedMonth, activeTab]);

  const handleCalculateDraft = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const run = await payrollApi.createOrCalculateDraft(selectedMonth);
      setCurrentRun(run);
      setSuccessMsg(`Payroll draft generated for ${selectedMonth}`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to calculate draft');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditLine = (line: PayrollLineItem) => {
    setActiveEditLine(line);
    setEditBase(String(line.base));
    setEditOtHours(String(line.overtimeHours));
    setEditOtPay(String(line.overtimePay));
    setEditAllowances(String(line.allowances));
    setEditBonus(String(line.bonus));
    setEditDeductions(String(line.deductions));
    setEditAdvanceRecovered(String(line.advanceRecovered));
    setEditNote(line.note || '');
    setShowEditLineModal(true);
  };

  const handleSaveLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEditLine) return;
    setSubmitting(true);
    try {
      const updated = await payrollApi.updateLine(activeEditLine.id, {
        base: parseFloat(editBase) || 0,
        overtimeHours: parseFloat(editOtHours) || 0,
        overtimePay: parseFloat(editOtPay) || 0,
        allowances: parseFloat(editAllowances) || 0,
        bonus: parseFloat(editBonus) || 0,
        deductions: parseFloat(editDeductions) || 0,
        advanceRecovered: parseFloat(editAdvanceRecovered) || 0,
        note: editNote.trim() || undefined,
      });
      setCurrentRun(updated);
      setShowEditLineModal(false);
      setSuccessMsg('Payroll line updated');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to update line');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalizeRun = async () => {
    if (!currentRun) return;
    setSubmitting(true);
    try {
      const res = await payrollApi.finalizeRun(currentRun.id);
      setCurrentRun((prev) => (prev ? { ...prev, status: res.status, finalizedAt: res.finalizedAt } : prev));
      setSuccessMsg(`Payroll run for ${currentRun.month} is now FINALIZED`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to finalize run');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayRun = async () => {
    if (!currentRun) return;
    setSubmitting(true);
    try {
      const res = await payrollApi.payRun(currentRun.id, payoutMethod);
      setCurrentRun(res);
      setShowPayModal(false);
      setSuccessMsg(`Payroll run PAID. ${res.lines?.length || 0} locked salary expenses created in Expenses.`);
      setTimeout(() => setSuccessMsg(null), 4500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to execute payout');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewPayslip = async (lineId: string) => {
    try {
      const slip = await payrollApi.getPayslip(lineId);
      setActivePayslip(slip);
      setShowPayslipModal(true);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to load payslip');
    }
  };

  const handleCreateAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const amt = parseFloat(advAmount);
      if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid advance amount');
      const inst = advInstalment ? parseFloat(advInstalment) : undefined;

      await payrollApi.createAdvance({
        employeeId: advEmpId,
        amount: amt,
        monthlyInstalment: inst,
        reason: advReason.trim() || undefined,
        clientRef: `ADV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      });

      setSuccessMsg('Salary advance recorded');
      setTimeout(() => setSuccessMsg(null), 3500);
      setShowAdvanceModal(false);
      setAdvAmount('');
      setAdvInstalment('');
      setAdvReason('');
      loadAdvances();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to issue advance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCorrectionEntry) return;
    if (!correctReason.trim()) {
      setErrorMsg('Reason for time entry correction is required');
      return;
    }
    setSubmitting(true);
    try {
      await payrollApi.correctTimeEntry(activeCorrectionEntry.id, {
        clockIn: correctClockIn || undefined,
        clockOut: correctClockOut || undefined,
        reason: correctReason.trim(),
      });
      setSuccessMsg('Time entry corrected successfully');
      setTimeout(() => setSuccessMsg(null), 3000);
      setShowCorrectionModal(false);
      loadTimeEntries();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to correct time entry');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const updated = await payrollApi.updateSettings({
        workdayHours: setWorkHours,
        workdaysPerMonth: setWorkDays,
        overtimeMultiplier: setOtMult,
        overtimeApprovalRequired: setOtApproval,
      });
      setSettings(updated);
      setSuccessMsg('Payroll rules saved');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to save settings');
    } finally {
      setSubmitting(false);
    }
  };

  const isPaid = currentRun?.status === 'PAID';
  const isFinalized = currentRun?.status === 'FINALIZED';

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', color: 'var(--text-main, #f8fafc)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>💼</span> Employee Payroll & Compensation
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted, #94a3b8)', fontSize: '14px' }}>
            Manage monthly salary runs, overtime calculations, salary advances, and printable payslips.
          </p>
        </div>

        {/* View Tabs */}
        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-card, #1e293b)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          {[
            { id: 'RUN', label: 'Monthly Run', icon: '📅' },
            { id: 'ADVANCES', label: 'Salary Advances', icon: '💸' },
            { id: 'TIME_ENTRIES', label: 'Time & Overtime', icon: '⏱️' },
            { id: 'SETTINGS', label: 'Rules & Settings', icon: '⚙️' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
                background: activeTab === t.id ? 'var(--primary, #3b82f6)' : 'transparent',
                color: activeTab === t.id ? '#fff' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#fca5a5', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', borderRadius: '8px', color: '#6ee7b7', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
          <span>✅ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', color: '#6ee7b7', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* TAB 1: MONTHLY RUN */}
      {activeTab === 'RUN' && (
        <div>
          {/* Month Toolbar & Status */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card, #1e293b)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Payroll Month</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="form-control"
                  style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              {currentRun && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 800,
                      letterSpacing: '0.05em',
                      background: isPaid
                        ? 'rgba(16, 185, 129, 0.2)'
                        : isFinalized
                        ? 'rgba(56, 189, 248, 0.2)'
                        : 'rgba(245, 158, 11, 0.2)',
                      color: isPaid ? '#34d399' : isFinalized ? '#38bdf8' : '#fbbf24',
                      border: `1px solid ${isPaid ? '#10b981' : isFinalized ? '#38bdf8' : '#fbbf24'}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{isPaid ? '🔒 PAID & LOCKED' : isFinalized ? '📝 FINALIZED' : '✏️ DRAFT'}</span>
                  </span>
                  {isPaid && (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Paid on {currentRun.paidAt ? new Date(currentRun.paidAt).toLocaleDateString() : ''} via {currentRun.paymentMethod}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {!isPaid && canManage && (
                <button
                  onClick={handleCalculateDraft}
                  disabled={submitting}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>🔄</span> {currentRun ? 'Recalculate Draft' : 'Generate Draft'}
                </button>
              )}

              {currentRun && !isPaid && !isFinalized && canManage && (
                <button
                  onClick={handleFinalizeRun}
                  disabled={submitting}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8' }}
                >
                  <span>📝</span> Finalize Run
                </button>
              )}

              {currentRun && isFinalized && canPay && (
                <button
                  onClick={() => setShowPayModal(true)}
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#10b981', borderColor: '#10b981' }}
                >
                  <span>💰</span> Execute Payout
                </button>
              )}
            </div>
          </div>

          {/* KPI Cards */}
          {currentRun && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Gross Pay</div>
                <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '8px' }}>
                  Rs. {currentRun.totalGross.toLocaleString()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {currentRun.employeeCount} active staff
                </div>
              </div>

              <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '13px', color: '#38bdf8', textTransform: 'uppercase' }}>Overtime Pay</div>
                <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '8px', color: '#38bdf8' }}>
                  Rs. {currentRun.totalOvertime.toLocaleString()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Extra hours beyond {settings?.workdayHours || 8}h
                </div>
              </div>

              <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '13px', color: '#f59e0b', textTransform: 'uppercase' }}>Advances Recovered</div>
                <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '8px', color: '#fbbf24' }}>
                  Rs. {currentRun.totalAdvances.toLocaleString()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Deducted towards salary advances
                </div>
              </div>

              <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '13px', color: '#34d399', textTransform: 'uppercase' }}>Total Net Payout</div>
                <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '8px', color: '#10b981' }}>
                  Rs. {currentRun.totalNet.toLocaleString()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Net cash disbursement
                </div>
              </div>
            </div>
          )}

          {/* Lines Table */}
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '14px 16px' }}>Employee</th>
                    <th style={{ padding: '14px 16px' }}>Type</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Base Pay</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Reg. Hrs</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>OT (Hrs / Pay)</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Allowances/Bonus</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Deductions</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Adv. Recovered</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700 }}>Net Pay</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Loading payroll run...
                      </td>
                    </tr>
                  ) : !currentRun || !currentRun.lines || currentRun.lines.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No payroll run created for {selectedMonth} yet. Click "Generate Draft" to compute salaries.
                      </td>
                    </tr>
                  ) : (
                    currentRun.lines.map((line) => (
                      <tr key={line.id} style={{ borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.05))' }}>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontWeight: 700 }}>
                            {line.employee?.firstName} {line.employee?.lastName}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {line.employee?.role} • @{line.employee?.username || 'user'}
                          </div>
                        </td>

                        <td style={{ padding: '14px 16px' }}>
                          <span style={{ padding: '3px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.06)' }}>
                            {line.salaryType}
                          </span>
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          Rs. {line.base.toLocaleString()}
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          {line.regularHours}h
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ color: line.overtimePay > 0 ? '#38bdf8' : 'inherit' }}>
                            {line.overtimeHours}h
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Rs. {line.overtimePay.toLocaleString()}
                          </div>
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div>Rs. {(line.allowances + line.bonus).toLocaleString()}</div>
                          {line.bonus > 0 && <div style={{ fontSize: '10px', color: '#34d399' }}>Bonus: {line.bonus}</div>}
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right', color: line.deductions > 0 ? '#f87171' : 'inherit' }}>
                          Rs. {(line.deductions + line.absenceDeduction).toLocaleString()}
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right', color: line.advanceRecovered > 0 ? '#fbbf24' : 'inherit' }}>
                          Rs. {line.advanceRecovered.toLocaleString()}
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 800, fontSize: '14px', color: '#10b981' }}>
                          Rs. {line.netPay.toLocaleString()}
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            {!isPaid && !isFinalized && canManage && (
                              <button
                                onClick={() => handleOpenEditLine(line)}
                                className="btn btn-secondary btn-sm"
                                title="Edit Line"
                              >
                                ✏️
                              </button>
                            )}

                            <button
                              onClick={() => handleViewPayslip(line.id)}
                              className="btn btn-secondary btn-sm"
                              title="Print Payslip"
                            >
                              📄 Payslip
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SALARY ADVANCES */}
      {activeTab === 'ADVANCES' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 4px 0' }}>Employee Salary Advances</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                Issue salary advances and set up automatic monthly payroll instalment recovery.
              </p>
            </div>

            {canManage && (
              <button onClick={() => setShowAdvanceModal(true)} className="btn btn-primary btn-sm">
                ➕ Issue Advance
              </button>
            )}
          </div>

          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '14px 16px' }}>Date</th>
                  <th style={{ padding: '14px 16px' }}>Employee</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Total Advance</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Remaining Balance</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Monthly Deduction</th>
                  <th style={{ padding: '14px 16px' }}>Reason</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {advances.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No salary advances recorded.
                    </td>
                  </tr>
                ) : (
                  advances.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.05))' }}>
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {new Date(a.advanceDate).toLocaleDateString()}
                      </td>

                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {a.employee?.firstName} {a.employee?.lastName}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          @{a.employee?.username || 'user'}
                        </div>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700 }}>
                        Rs. {a.amount.toLocaleString()}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: a.remainingAmount > 0 ? '#fbbf24' : '#10b981' }}>
                        Rs. {a.remainingAmount.toLocaleString()}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {a.monthlyInstalment ? `Rs. ${a.monthlyInstalment.toLocaleString()} / mo` : 'Full in next run'}
                      </td>

                      <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {a.reason || '—'}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background:
                              a.status === 'FULLY_RECOVERED'
                                ? 'rgba(16, 185, 129, 0.2)'
                                : a.status === 'CANCELLED'
                                ? 'rgba(239, 68, 68, 0.2)'
                                : 'rgba(245, 158, 11, 0.2)',
                            color:
                              a.status === 'FULLY_RECOVERED'
                                ? '#34d399'
                                : a.status === 'CANCELLED'
                                ? '#f87171'
                                : '#fbbf24',
                          }}
                        >
                          {a.status}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {a.status === 'ACTIVE' && a.remainingAmount === a.amount && canManage && (
                          <button
                            onClick={async () => {
                              await payrollApi.cancelAdvance(a.id);
                              loadAdvances();
                            }}
                            className="btn btn-secondary btn-sm"
                            style={{ color: '#f87171' }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: TIME ENTRIES & OVERTIME */}
      {activeTab === 'TIME_ENTRIES' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 4px 0' }}>Time Clock & Overtime Logs</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                Review staff clock-in/out records, approve overtime, and correct forgotten punches with an audit reason.
              </p>
            </div>
            <div>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="form-control"
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              />
            </div>
          </div>

          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '14px 16px' }}>Employee</th>
                  <th style={{ padding: '14px 16px' }}>Clock In</th>
                  <th style={{ padding: '14px 16px' }}>Clock Out</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Hours Worked</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Overtime Hours</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center' }}>Overtime Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {timeEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No time entries logged for {selectedMonth}.
                    </td>
                  </tr>
                ) : (
                  timeEntries.map((te) => (
                    <tr key={te.id} style={{ borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.05))' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {te.employee?.firstName} {te.employee?.lastName}
                        </div>
                        {te.isCorrected && (
                          <div style={{ fontSize: '11px', color: '#fbbf24' }}>
                            ✏️ Corrected: {te.correctionReason}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {new Date(te.clockIn).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </td>

                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {te.clockOut ? (
                          new Date(te.clockOut).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                        ) : (
                          <span style={{ color: '#10b981', fontWeight: 600 }}>🟢 Clocked In</span>
                        )}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}>
                        {te.hoursWorked ? `${te.hoursWorked}h` : '—'}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: (te.overtimeHours || 0) > 0 ? '#38bdf8' : 'inherit' }}>
                        {te.overtimeHours ? `${te.overtimeHours}h` : '0h'}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        {(te.overtimeHours || 0) > 0 ? (
                          te.overtimeApproved ? (
                            <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: 'rgba(16, 185, 129, 0.2)', color: '#34d399' }}>
                              APPROVED
                            </span>
                          ) : (
                            <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24' }}>
                              PENDING
                            </span>
                          )
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {(te.overtimeHours || 0) > 0 && !te.overtimeApproved && canManage && (
                            <button
                              onClick={async () => {
                                await payrollApi.approveOvertime(te.id, true);
                                loadTimeEntries();
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ background: '#10b981', borderColor: '#10b981', fontSize: '12px', padding: '4px 8px' }}
                            >
                              Approve OT
                            </button>
                          )}

                          {canManage && (
                            <button
                              onClick={() => {
                                setActiveCorrectionEntry(te);
                                setCorrectClockIn(new Date(te.clockIn).toISOString().slice(0, 16));
                                setCorrectClockOut(te.clockOut ? new Date(te.clockOut).toISOString().slice(0, 16) : '');
                                setCorrectReason('');
                                setShowCorrectionModal(true);
                              }}
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '12px', padding: '4px 8px' }}
                            >
                              Correct
                            </button>
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

      {/* TAB 4: SETTINGS & RULES */}
      {activeTab === 'SETTINGS' && (
        <div style={{ maxWidth: '640px' }}>
          <div style={{ background: 'var(--bg-card, #1e293b)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px 0' }}>Payroll Calculation Rules</h2>
            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Standard Workday Hours
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={setWorkHours}
                  onChange={(e) => setSetWorkHours(parseFloat(e.target.value))}
                  required
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Default is 8 hours. Time worked beyond this on a shift is considered overtime.
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Workdays Per Month
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={setWorkDays}
                  onChange={(e) => setSetWorkDays(parseInt(e.target.value, 10))}
                  required
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Default is 26 days (excluding weekly off days). Used to calculate hourly equivalent for monthly staff.
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Overtime Multiplier Rate
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="3.0"
                  value={setOtMult}
                  onChange={(e) => setSetOtMult(parseFloat(e.target.value))}
                  required
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Default is 1.5x of normal hourly equivalent.
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                <input
                  type="checkbox"
                  id="otApproval"
                  checked={setOtApproval}
                  onChange={(e) => setSetOtApproval(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <label htmlFor="otApproval" style={{ fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                  Require manager approval for overtime hours before paying out
                </label>
              </div>

              {canManage && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button type="submit" disabled={submitting} className="btn btn-primary">
                    {submitting ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT PAYROLL LINE */}
      {showEditLineModal && activeEditLine && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowEditLineModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '580px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px 0' }}>
              Edit Payroll Line: {activeEditLine.employee?.firstName} {activeEditLine.employee?.lastName}
            </h2>

            <form onSubmit={handleSaveLine} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Base Salary / Pay (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editBase}
                    onChange={(e) => setEditBase(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Overtime Pay (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editOtPay}
                    onChange={(e) => setEditOtPay(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Allowances (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editAllowances}
                    onChange={(e) => setEditAllowances(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Performance Bonus (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editBonus}
                    onChange={(e) => setEditBonus(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Other Deductions (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editDeductions}
                    onChange={(e) => setEditDeductions(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Advance Recovery (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editAdvanceRecovered}
                    onChange={(e) => setEditAdvanceRecovered(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Notes</label>
                <input
                  type="text"
                  placeholder="Reason for adjustment..."
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button type="button" onClick={() => setShowEditLineModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Saving...' : 'Update Line'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PAYOUT / EXECUTE RUN */}
      {showPayModal && currentRun && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowPayModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '440px', width: '100%', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 12px 0' }}>Execute Salary Disbursement</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Disburse total net pay of <strong>Rs. {currentRun.totalNet.toLocaleString()}</strong> across {currentRun.lines?.length || 0} employees for month <strong>{currentRun.month}</strong>.
            </p>
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '12px', borderRadius: '8px', color: '#fbbf24', fontSize: '12px', marginBottom: '16px' }}>
              ⚠️ Once marked PAID, this month is permanently locked and cannot be edited. A locked salary expense will be created in Expenses for each line.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Disbursement Method</label>
              <select
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                className="form-control"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              >
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowPayModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handlePayRun} disabled={submitting} className="btn btn-primary" style={{ background: '#10b981', borderColor: '#10b981' }}>
                {submitting ? 'Processing...' : 'Confirm & Mark PAID'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PRINTABLE PAYSLIP (A4 & 80mm THERMAL) */}
      {showPayslipModal && activePayslip && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowPayslipModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '700px', width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }} className="no-print">
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setPayslipFormat('A4')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: payslipFormat === 'A4' ? 'var(--primary, #3b82f6)' : 'transparent',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Standard A4 Slip
                </button>
                <button
                  onClick={() => setPayslipFormat('THERMAL_80MM')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: payslipFormat === 'THERMAL_80MM' ? 'var(--primary, #3b82f6)' : 'transparent',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  80mm Thermal Receipt
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => window.print()} className="btn btn-primary btn-sm">
                  🖨️ Print Slip
                </button>
                <button onClick={() => setShowPayslipModal(false)} className="btn btn-secondary btn-sm">
                  ✕ Close
                </button>
              </div>
            </div>

            {/* A4 FORMAT */}
            {payslipFormat === 'A4' ? (
              <div style={{ background: '#fff', color: '#111827', padding: '32px', borderRadius: '8px', fontFamily: 'sans-serif' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e5e7eb', paddingBottom: '16px', marginBottom: '20px' }}>
                  <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 4px 0', color: '#111827' }}>
                      {activePayslip.business?.name || 'Restaurant POS'}
                    </h2>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>{activePayslip.business?.address}</div>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>Phone: {activePayslip.business?.phone}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#1e3a8a' }}>PAYSLIP</div>
                    <div style={{ fontSize: '13px', color: '#4b5563', fontWeight: 600 }}>{activePayslip.month}</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>{activePayslip.payslipNumber}</div>
                  </div>
                </div>

                {/* Employee Details Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: '#f9fafb', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Employee Name</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>{activePayslip.employee.name}</div>
                    <div style={{ fontSize: '13px', color: '#4b5563' }}>Role: {activePayslip.employee.role}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Compensation Type</div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{activePayslip.employee.salaryType}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Disbursement: {activePayslip.paymentMethod}</div>
                  </div>
                </div>

                {/* Earnings & Deductions Tables */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                  {/* Earnings */}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, borderBottom: '2px solid #10b981', paddingBottom: '6px', marginBottom: '10px', color: '#065f46' }}>
                      EARNINGS
                    </div>
                    <table style={{ width: '100%', fontSize: '13px' }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: '6px 0', color: '#4b5563' }}>Basic Salary / Wage</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.earnings.base.toLocaleString()}</td>
                        </tr>
                        {activePayslip.earnings.overtimePay > 0 && (
                          <tr>
                            <td style={{ padding: '6px 0', color: '#4b5563' }}>Overtime ({activePayslip.earnings.overtimeHours}h)</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.earnings.overtimePay.toLocaleString()}</td>
                          </tr>
                        )}
                        {activePayslip.earnings.allowances > 0 && (
                          <tr>
                            <td style={{ padding: '6px 0', color: '#4b5563' }}>Allowances</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.earnings.allowances.toLocaleString()}</td>
                          </tr>
                        )}
                        {activePayslip.earnings.bonus > 0 && (
                          <tr>
                            <td style={{ padding: '6px 0', color: '#4b5563' }}>Bonus</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.earnings.bonus.toLocaleString()}</td>
                          </tr>
                        )}
                        <tr style={{ borderTop: '1px solid #e5e7eb', fontWeight: 700 }}>
                          <td style={{ padding: '8px 0' }}>Total Gross</td>
                          <td style={{ textAlign: 'right' }}>Rs. {activePayslip.earnings.totalGross.toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Deductions */}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, borderBottom: '2px solid #ef4444', paddingBottom: '6px', marginBottom: '10px', color: '#991b1b' }}>
                      DEDUCTIONS
                    </div>
                    <table style={{ width: '100%', fontSize: '13px' }}>
                      <tbody>
                        {activePayslip.deductions.absenceDeduction > 0 && (
                          <tr>
                            <td style={{ padding: '6px 0', color: '#4b5563' }}>Absence ({activePayslip.deductions.absentDays} days)</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.deductions.absenceDeduction.toLocaleString()}</td>
                          </tr>
                        )}
                        {activePayslip.deductions.advanceRecovered > 0 && (
                          <tr>
                            <td style={{ padding: '6px 0', color: '#4b5563' }}>Salary Advance Recovery</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.deductions.advanceRecovered.toLocaleString()}</td>
                          </tr>
                        )}
                        {activePayslip.deductions.deductions > 0 && (
                          <tr>
                            <td style={{ padding: '6px 0', color: '#4b5563' }}>Other Deductions</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>Rs. {activePayslip.deductions.deductions.toLocaleString()}</td>
                          </tr>
                        )}
                        <tr style={{ borderTop: '1px solid #e5e7eb', fontWeight: 700 }}>
                          <td style={{ padding: '8px 0' }}>Total Deductions</td>
                          <td style={{ textAlign: 'right' }}>Rs. {activePayslip.deductions.totalDeductions.toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Net Pay Banner */}
                <div style={{ background: '#f0fdf4', border: '2px solid #86efac', padding: '16px 20px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#166534' }}>NET SALARY PAYOUT</div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: '#15803d' }}>
                    Rs. {activePayslip.netPay.toLocaleString()}
                  </div>
                </div>

                <div style={{ marginTop: '24px', fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
                  This is a computer-generated document. No signature is required.
                </div>
              </div>
            ) : (
              /* THERMAL 80MM FORMAT */
              <div style={{ background: '#fff', color: '#000', padding: '20px', width: '300px', margin: '0 auto', fontFamily: 'monospace', fontSize: '12px' }}>
                <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 800, fontSize: '15px' }}>{activePayslip.business?.name || 'Restaurant POS'}</div>
                  <div>SALARY RECEIPT ({activePayslip.month})</div>
                  <div style={{ fontSize: '10px' }}>{activePayslip.payslipNumber}</div>
                  <div>--------------------------------</div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div>EMP: {activePayslip.employee.name}</div>
                  <div>ROLE: {activePayslip.employee.role}</div>
                  <div>TYPE: {activePayslip.employee.salaryType}</div>
                  <div>--------------------------------</div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Base Pay:</span>
                    <span>Rs. {activePayslip.earnings.base}</span>
                  </div>
                  {activePayslip.earnings.overtimePay > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>OT ({activePayslip.earnings.overtimeHours}h):</span>
                      <span>Rs. {activePayslip.earnings.overtimePay}</span>
                    </div>
                  )}
                  {activePayslip.earnings.allowances > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Allowances:</span>
                      <span>Rs. {activePayslip.earnings.allowances}</span>
                    </div>
                  )}
                  {activePayslip.earnings.bonus > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Bonus:</span>
                      <span>Rs. {activePayslip.earnings.bonus}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>Gross:</span>
                    <span>Rs. {activePayslip.earnings.totalGross}</span>
                  </div>
                  <div>--------------------------------</div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  {activePayslip.deductions.advanceRecovered > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Adv. Recovery:</span>
                      <span>-Rs. {activePayslip.deductions.advanceRecovered}</span>
                    </div>
                  )}
                  {activePayslip.deductions.deductions > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Other Ded.:</span>
                      <span>-Rs. {activePayslip.deductions.deductions}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>Deductions:</span>
                    <span>-Rs. {activePayslip.deductions.totalDeductions}</span>
                  </div>
                  <div>================================</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800 }}>
                  <span>NET PAY:</span>
                  <span>Rs. {activePayslip.netPay}</span>
                </div>

                <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '10px' }}>
                  THANK YOU FOR YOUR WORK
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: ISSUE SALARY ADVANCE */}
      {showAdvanceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowAdvanceModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '480px', width: '100%', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px 0' }}>Issue Salary Advance</h2>
            <form onSubmit={handleCreateAdvance} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Employee *</label>
                <select
                  value={advEmpId}
                  onChange={(e) => setAdvEmpId(e.target.value)}
                  required
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName} ({e.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Advance Amount (PKR) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="e.g. 15000"
                  value={advAmount}
                  onChange={(e) => setAdvAmount(e.target.value)}
                  required
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Monthly Deduction Limit (Optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="Leave empty to deduct full in next payroll"
                  value={advInstalment}
                  onChange={(e) => setAdvInstalment(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  If set, maximum this amount will be recovered per month until paid off.
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Reason / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Medical emergency, family event"
                  value={advReason}
                  onChange={(e) => setAdvReason(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" onClick={() => setShowAdvanceModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Issuing...' : 'Issue Advance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TIME ENTRY CORRECTION */}
      {showCorrectionModal && activeCorrectionEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowCorrectionModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '480px', width: '100%', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px 0' }}>
              Correct Punch: {activeCorrectionEntry.employee?.firstName} {activeCorrectionEntry.employee?.lastName}
            </h2>

            <form onSubmit={handleSaveCorrection} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Clock In Time</label>
                <input
                  type="datetime-local"
                  value={correctClockIn}
                  onChange={(e) => setCorrectClockIn(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Clock Out Time</label>
                <input
                  type="datetime-local"
                  value={correctClockOut}
                  onChange={(e) => setCorrectClockOut(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Correction Reason *</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Employee forgot to clock out at 10 PM"
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" onClick={() => setShowCorrectionModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Saving...' : 'Save Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

