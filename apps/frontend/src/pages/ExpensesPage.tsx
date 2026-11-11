import React, { useState, useEffect } from 'react';
import {
  expensesApi,
  ExpenseItem,
  ExpenseCategory,
  RecurringTemplate,
  ExpensesSummary,
} from '../api/expenses.api';
import { useSelector } from 'react-redux';
import { RootState } from '../store/store';

export const ExpensesPage: React.FC = () => {
  const user = useSelector((state: RootState) => state.auth.user);
  const permissions = user?.permissions || [];
  const isOwner = Boolean(user?.isOwnerRole || user?.role === 'OWNER');
  const canCreate = isOwner || permissions.includes('expenses.create');
  const canManage = isOwner || permissions.includes('expenses.manage');

  const currentMonthStr = new Date().toISOString().slice(0, 7);

  // Filters & Pagination
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'UNPAID' | 'VOIDED'>('ALL');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // Data
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [summary, setSummary] = useState<ExpensesSummary>({
    totalAmount: 0,
    paidAmount: 0,
    unpaidAmount: 0,
    byCategory: [],
  });
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showPayModal, setShowPayModal] = useState<boolean>(false);
  const [activePayExpense, setActivePayExpense] = useState<ExpenseItem | null>(null);
  const [payMethod, setPayMethod] = useState<string>('CASH');
  const [showVoidModal, setShowVoidModal] = useState<boolean>(false);
  const [activeVoidExpense, setActiveVoidExpense] = useState<ExpenseItem | null>(null);
  const [voidReason, setVoidReason] = useState<string>('');
  const [showRecurringModal, setShowRecurringModal] = useState<boolean>(false);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false);
  const [newCatName, setNewCatName] = useState<string>('');
  const [newCatDesc, setNewCatDesc] = useState<string>('');

  // Add Expense Form State
  const [formCategory, setFormCategory] = useState<string>('');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [formDueDate, setFormDueDate] = useState<string>('');
  const [formMethod, setFormMethod] = useState<string>('CASH');
  const [formPayee, setFormPayee] = useState<string>('');
  const [formReferenceNo, setFormReferenceNo] = useState<string>('');
  const [formBillingPeriod, setFormBillingPeriod] = useState<string>(currentMonthStr);
  const [formStatus, setFormStatus] = useState<'PAID' | 'UNPAID'>('PAID');
  const [formNote, setFormNote] = useState<string>('');
  const [formBillPhoto, setFormBillPhoto] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Add Recurring Template Form State
  const [showAddRecForm, setShowAddRecForm] = useState<boolean>(false);
  const [recName, setRecName] = useState<string>('');
  const [recCat, setRecCat] = useState<string>('');
  const [recAmount, setRecAmount] = useState<string>('');
  const [recMethod, setRecMethod] = useState<string>('BANK_TRANSFER');
  const [recPayee, setRecPayee] = useState<string>('');
  const [recDay, setRecDay] = useState<number>(1);
  const [recNote, setRecNote] = useState<string>('');

  const loadCategories = async () => {
    try {
      const cats = await expensesApi.getCategories();
      setCategories(cats);
      if (cats.length > 0 && !formCategory) {
        const nonSal = cats.find((c) => !c.isSystem && c.name.toLowerCase() !== 'salaries');
        if (nonSal) setFormCategory(nonSal.id);
      }
    } catch (err: any) {
      console.error('Failed to load expense categories:', err);
    }
  };

  const loadExpenses = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await expensesApi.getExpenses({
        page,
        limit: 50,
        month: selectedMonth || undefined,
        categoryId: selectedCategory || undefined,
        status: statusFilter === 'ALL' || statusFilter === 'VOIDED' ? undefined : statusFilter,
        includeVoided: statusFilter === 'VOIDED' || statusFilter === 'ALL',
        search: search.trim() || undefined,
      });

      let displayData = res.data;
      if (statusFilter === 'VOIDED') {
        displayData = displayData.filter((e) => Boolean(e.voidedAt));
      } else if (statusFilter === 'ALL') {
        // keep all
      } else {
        displayData = displayData.filter((e) => !e.voidedAt);
      }

      setExpenses(displayData);
      setTotalCount(res.total);
      setTotalPages(res.totalPages);
      setSummary(res.summary);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  const loadRecurring = async () => {
    try {
      const temps = await expensesApi.getRecurringTemplates();
      setRecurringTemplates(temps);
    } catch (err) {
      console.error('Failed to load recurring templates:', err);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [selectedMonth, selectedCategory, statusFilter, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadExpenses();
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const amt = parseFloat(formAmount);
      if (isNaN(amt) || amt <= 0) {
        throw new Error('Please enter a valid amount in PKR');
      }
      if (!formCategory) {
        throw new Error('Please select an expense category');
      }

      const clientRef = `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      await expensesApi.createExpense({
        categoryId: formCategory,
        expenseDate: formDate,
        amount: amt,
        method: formMethod,
        payee: formPayee || undefined,
        referenceNo: formReferenceNo || undefined,
        billingPeriod: formBillingPeriod || undefined,
        dueDate: formDueDate || undefined,
        status: formStatus,
        paidAt: formStatus === 'PAID' ? formDate : undefined,
        note: formNote || undefined,
        billPhotoUrl: formBillPhoto || undefined,
        clientRef,
      });

      setSuccessMsg('Expense recorded successfully');
      setTimeout(() => setSuccessMsg(null), 3500);
      setShowAddModal(false);
      setFormAmount('');
      setFormNote('');
      setFormPayee('');
      setFormReferenceNo('');
      setFormBillPhoto('');
      loadExpenses();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to create expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPay = async () => {
    if (!activePayExpense) return;
    setSubmitting(true);
    try {
      await expensesApi.markPaid(activePayExpense.id, {
        method: payMethod,
        paidAt: new Date().toISOString(),
      });
      setSuccessMsg(`Expense #${activePayExpense.referenceNo || activePayExpense.id.slice(-4)} marked as PAID`);
      setTimeout(() => setSuccessMsg(null), 3500);
      setShowPayModal(false);
      setActivePayExpense(null);
      loadExpenses();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to mark expense paid');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (!activeVoidExpense) return;
    if (!voidReason.trim()) {
      setErrorMsg('A void reason is required');
      return;
    }
    setSubmitting(true);
    try {
      await expensesApi.voidExpense(activeVoidExpense.id, voidReason.trim());
      setSuccessMsg(`Expense #${activeVoidExpense.referenceNo || activeVoidExpense.id.slice(-4)} voided`);
      setTimeout(() => setSuccessMsg(null), 3500);
      setShowVoidModal(false);
      setActiveVoidExpense(null);
      setVoidReason('');
      loadExpenses();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to void expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateRecurring = async () => {
    setSubmitting(true);
    try {
      const res = await expensesApi.generateRecurring(selectedMonth);
      setSuccessMsg(`Generated ${res.generated} recurring expenses for ${selectedMonth}`);
      setTimeout(() => setSuccessMsg(null), 4000);
      loadRecurring();
      loadExpenses();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to generate recurring expenses');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amt = parseFloat(recAmount);
      if (isNaN(amt) || amt <= 0) throw new Error('Valid amount required');
      if (!recName.trim()) throw new Error('Name required');
      if (!recCat) throw new Error('Category required');

      await expensesApi.createRecurringTemplate({
        name: recName.trim(),
        categoryId: recCat,
        amount: amt,
        method: recMethod,
        payee: recPayee || undefined,
        dayOfMonth: recDay,
        note: recNote || undefined,
      });

      setSuccessMsg('Recurring template created');
      setTimeout(() => setSuccessMsg(null), 3000);
      setShowAddRecForm(false);
      setRecName('');
      setRecAmount('');
      setRecPayee('');
      setRecNote('');
      loadRecurring();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to create template');
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await expensesApi.createCategory({
        name: newCatName.trim(),
        description: newCatDesc.trim() || undefined,
      });
      setNewCatName('');
      setNewCatDesc('');
      loadCategories();
      setSuccessMsg('Category added');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to add category');
    }
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (selectedMonth) params.set('month', selectedMonth);
    if (selectedCategory) params.set('categoryId', selectedCategory);
    const token = localStorage.getItem('auth_token') || '';
    window.open(`/api/expenses/export/csv?${params.toString()}&token=${token}`, '_blank');
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', color: 'var(--text-main, #f8fafc)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>💸</span> Operational Expenses & Bills
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted, #94a3b8)', fontSize: '14px' }}>
            Track business overheads, recurring utilities, and bill payments in PKR.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleExportCsv}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>📥</span> Export CSV
          </button>

          {canManage && (
            <>
              <button
                onClick={() => {
                  loadRecurring();
                  setShowRecurringModal(true);
                }}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>🔄</span> Recurring Templates
              </button>

              <button
                onClick={() => setShowCategoryModal(true)}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>🏷️</span> Categories
              </button>
            </>
          )}

          {canCreate && (
            <button
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
            >
              <span>➕</span> Add Expense
            </button>
          )}
        </div>
      </div>

      {/* Alert Messages */}
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

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total Month Expenses
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#f8fafc' }}>
            Rs. {summary.totalAmount.toLocaleString()}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px' }}>
            Across {totalCount} records in {selectedMonth}
          </div>
        </div>

        <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' }}>
          <div style={{ fontSize: '13px', color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Settled / Paid Bills
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#10b981' }}>
            Rs. {summary.paidAmount.toLocaleString()}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px' }}>
            Cash outlay settled
          </div>
        </div>

        <div style={{ background: 'var(--bg-card, #1e293b)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' }}>
          <div style={{ fontSize: '13px', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Unpaid / Due Bills
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#fbbf24' }}>
            Rs. {summary.unpaidAmount.toLocaleString()}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px' }}>
            Pending payment
          </div>
        </div>
      </div>

      {/* Category Breakdown Bar */}
      {summary.byCategory.length > 0 && (
        <div style={{ background: 'var(--bg-card, #1e293b)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))', marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted, #94a3b8)', marginBottom: '12px' }}>
            TOP EXPENSE CATEGORIES ({selectedMonth}):
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {summary.byCategory.slice(0, 6).map((c) => (
              <div
                key={c.categoryId}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                }}
              >
                <span style={{ fontWeight: 600 }}>{c.name}:</span>
                <span style={{ color: '#38bdf8' }}>Rs. {c.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters & Search Toolbar */}
      <div style={{ background: 'var(--bg-card, #1e293b)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))', marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Month</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  setPage(1);
                }}
                className="form-control"
                style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPage(1);
                }}
                className="form-control"
                style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Status</label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['ALL', 'PAID', 'UNPAID', 'VOIDED'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setStatusFilter(s);
                      setPage(1);
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid var(--border-color)',
                      background: statusFilter === s ? 'var(--primary, #3b82f6)' : 'rgba(255, 255, 255, 0.05)',
                      color: '#fff',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Search payee, bill #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-control"
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff', minWidth: '220px' }}
            />
            <button type="submit" className="btn btn-secondary btn-sm">Search</button>
          </form>
        </div>
      </div>

      {/* Expenses Table */}
      <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))', background: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-muted, #94a3b8)' }}>
                <th style={{ padding: '14px 16px' }}>Date</th>
                <th style={{ padding: '14px 16px' }}>Category</th>
                <th style={{ padding: '14px 16px' }}>Payee & Reference</th>
                <th style={{ padding: '14px 16px' }}>Period / Due</th>
                <th style={{ padding: '14px 16px' }}>Method</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>Amount (PKR)</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>Source</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Loading expenses...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No expenses found for this month and filter.
                  </td>
                </tr>
              ) : (
                expenses.map((e) => {
                  const isVoided = Boolean(e.voidedAt);
                  const isPaid = e.status === 'PAID' && !isVoided;
                  const isUnpaid = e.status === 'UNPAID' && !isVoided;

                  return (
                    <tr
                      key={e.id}
                      style={{
                        borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.05))',
                        opacity: isVoided ? 0.6 : 1,
                      }}
                    >
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {new Date(e.expenseDate).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>

                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            background: e.category?.isSystem ? 'rgba(168, 85, 247, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                            color: e.category?.isSystem ? '#c084fc' : '#38bdf8',
                          }}
                        >
                          {e.category?.name || 'Uncategorized'}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{e.payee || '—'}</div>
                        {e.referenceNo && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Ref: {e.referenceNo}</div>
                        )}
                        {e.note && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{e.note}</div>
                        )}
                      </td>

                      <td style={{ padding: '14px 16px', fontSize: '13px' }}>
                        {e.billingPeriod && <div>Period: {e.billingPeriod}</div>}
                        {e.dueDate && (
                          <div style={{ color: '#fbbf24', fontSize: '12px' }}>
                            Due: {new Date(e.dueDate).toLocaleDateString()}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '14px 16px', fontSize: '13px' }}>
                        <span style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                          {e.method.replace('_', ' ')}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, fontSize: '15px' }}>
                        Rs. {e.amount.toLocaleString()}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {e.source}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        {isVoided ? (
                          <span
                            title={`Reason: ${e.voidReason || 'None'}`}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: 'rgba(239, 68, 68, 0.2)',
                              color: '#f87171',
                            }}
                          >
                            VOIDED
                          </span>
                        ) : isPaid ? (
                          <span
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: 'rgba(16, 185, 129, 0.2)',
                              color: '#34d399',
                            }}
                          >
                            PAID
                          </span>
                        ) : (
                          <span
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: 'rgba(245, 158, 11, 0.2)',
                              color: '#fbbf24',
                            }}
                          >
                            UNPAID
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {e.billPhotoUrl && (
                            <a
                              href={e.billPhotoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary btn-sm"
                              title="View Bill Photo"
                            >
                              📷
                            </a>
                          )}

                          {isUnpaid && canManage && (
                            <button
                              onClick={() => {
                                setActivePayExpense(e);
                                setPayMethod(e.method || 'CASH');
                                setShowPayModal(true);
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ background: '#10b981', borderColor: '#10b981' }}
                            >
                              Mark Paid
                            </button>
                          )}

                          {!isVoided && e.source !== 'PAYROLL' && canManage && (
                            <button
                              onClick={() => {
                                setActiveVoidExpense(e);
                                setVoidReason('');
                                setShowVoidModal(true);
                              }}
                              className="btn btn-secondary btn-sm"
                              style={{ color: '#f87171' }}
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Page {page} of {totalPages} ({totalCount} total)
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="btn btn-secondary btn-sm"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="btn btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: ADD EXPENSE */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowAddModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 16px 0' }}>Record New Expense</h2>
            <form onSubmit={handleCreateExpense} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Category *</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="form-control"
                  required
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                >
                  <option value="">Select Category</option>
                  {categories
                    .filter((c) => !c.isSystem && c.name.toLowerCase() !== 'salaries')
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  ℹ️ Salaries are generated through the Payroll module.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Amount (PKR) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="e.g. 5000"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    required
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Expense Date *</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Payment Method</label>
                  <select
                    value={formMethod}
                    onChange={(e) => setFormMethod(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CARD">Credit / Debit Card</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  >
                    <option value="PAID">Paid</option>
                    <option value="UNPAID">Unpaid (Bill Due)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Payee / Vendor</label>
                  <input
                    type="text"
                    placeholder="e.g. LESCO, Sui Gas, Landlord"
                    value={formPayee}
                    onChange={(e) => setFormPayee(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Reference / Bill #</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-99214"
                    value={formReferenceNo}
                    onChange={(e) => setFormReferenceNo(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Billing Period (YYYY-MM)</label>
                  <input
                    type="month"
                    value={formBillingPeriod}
                    onChange={(e) => setFormBillingPeriod(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Due Date (if unpaid)</label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="form-control"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Bill Photo URL / Receipt Link</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={formBillPhoto}
                  onChange={(e) => setFormBillPhoto(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Notes</label>
                <textarea
                  rows={2}
                  placeholder="Additional notes..."
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: MARK AS PAID */}
      {showPayModal && activePayExpense && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowPayModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '420px', width: '100%', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 12px 0' }}>Settle Unpaid Expense</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Mark expense of <strong>Rs. {activePayExpense.amount.toLocaleString()}</strong> ({activePayExpense.category?.name}) as fully paid.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Payment Method</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="form-control"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              >
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CARD">Credit / Debit Card</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowPayModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmPay} disabled={submitting} className="btn btn-primary" style={{ background: '#10b981', borderColor: '#10b981' }}>
                {submitting ? 'Updating...' : 'Confirm Paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: VOID EXPENSE */}
      {showVoidModal && activeVoidExpense && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowVoidModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '440px', width: '100%', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 12px 0', color: '#f87171' }}>Void Expense</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Are you sure you want to void expense of <strong>Rs. {activeVoidExpense.amount.toLocaleString()}</strong>? This action cannot be reversed.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Reason for Voiding *</label>
              <textarea
                rows={3}
                required
                placeholder="e.g. Duplicate entry, incorrect amount, billed to other branch..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="form-control"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowVoidModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmVoid} disabled={submitting} className="btn btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }}>
                {submitting ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: RECURRING TEMPLATES */}
      {showRecurringModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowRecurringModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '750px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 4px 0' }}>Recurring Expenses Templates</h2>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                  Auto-generate monthly recurring expenses for rent, internet, utilities, etc.
                </p>
              </div>
              <button
                onClick={handleGenerateRecurring}
                disabled={submitting}
                className="btn btn-primary btn-sm"
              >
                {submitting ? 'Generating...' : `⚡ Generate for ${selectedMonth}`}
              </button>
            </div>

            {!showAddRecForm ? (
              <div style={{ marginBottom: '16px' }}>
                <button onClick={() => setShowAddRecForm(true)} className="btn btn-secondary btn-sm">
                  ➕ Add New Recurring Template
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateRecurring} style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '10px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 12px 0' }}>New Template</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="Template Name (e.g. Office Rent)"
                    value={recName}
                    onChange={(e) => setRecName(e.target.value)}
                    required
                    className="form-control"
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                  <select
                    value={recCat}
                    onChange={(e) => setRecCat(e.target.value)}
                    required
                    className="form-control"
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  >
                    <option value="">Select Category</option>
                    {categories.filter((c) => !c.isSystem).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount (PKR)"
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    required
                    className="form-control"
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                  <input
                    type="number"
                    min="1"
                    max="28"
                    placeholder="Day of Month (1-28)"
                    value={recDay}
                    onChange={(e) => setRecDay(parseInt(e.target.value, 10))}
                    required
                    className="form-control"
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  />
                  <select
                    value={recMethod}
                    onChange={(e) => setRecMethod(e.target.value)}
                    className="form-control"
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
                  >
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CASH">Cash</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowAddRecForm(false)} className="btn btn-secondary btn-sm">
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm">
                    Save Template
                  </button>
                </div>
              </form>
            )}

            {/* Recurring List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recurringTemplates.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No recurring templates defined yet.
                </div>
              ) : (
                recurringTemplates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{t.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {t.category?.name} • Day {t.dayOfMonth} of month • Last: {t.lastGeneratedMonth || 'Never'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ fontWeight: 700, fontSize: '15px' }}>Rs. {t.amount.toLocaleString()}</div>
                      <button
                        onClick={async () => {
                          await expensesApi.deleteRecurringTemplate(t.id);
                          loadRecurring();
                        }}
                        style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '16px' }}
                        title="Delete template"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" onClick={() => setShowRecurringModal(false)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CATEGORIES MANAGEMENT */}
      {showCategoryModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }} onClick={() => setShowCategoryModal(false)}>
          <div style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '16px', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 16px 0' }}>Expense Categories</h2>

            {/* Add Category Form */}
            <form onSubmit={handleCreateCategory} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input
                type="text"
                placeholder="New Category Name..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                required
                className="form-control"
                style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: '#fff' }}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Add
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '350px', overflowY: 'auto' }}>
              {categories.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {c.name} {c.isSystem && <span style={{ fontSize: '11px', color: '#c084fc', marginLeft: '6px' }}>[System Locked]</span>}
                  </span>

                  {!c.isSystem && (
                    <button
                      onClick={async () => {
                        await expensesApi.deleteCategory(c.id);
                        loadCategories();
                      }}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" onClick={() => setShowCategoryModal(false)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

