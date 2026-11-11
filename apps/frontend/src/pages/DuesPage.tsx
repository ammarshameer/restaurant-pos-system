import React, { useState, useEffect } from 'react';
import {
  duesApi,
  CustomerDueItem,
  CustomerStatementResponse,
} from '../api/dues.api';
import { formatPKR } from '../utils/format';

export const DuesPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerDueItem[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [customersWithDues, setCustomersWithDues] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Receive Payment Modal
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDueItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentNote, setPaymentNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Statement / Ledger Drawer
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statement, setStatement] = useState<CustomerStatementResponse | null>(null);

  // Notification
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    loadDues();
  }, [search, page]);

  const loadDues = async () => {
    setLoading(true);
    try {
      const res = await duesApi.listDues({ search: search.trim() || undefined, page, limit: 50 });
      setCustomers(res.data);
      setTotalOutstanding(res.totalOutstanding);
      setCustomersWithDues(res.customersWithDues);
    } catch (err) {
      console.error('Failed to load dues:', err);
    } finally {
      setLoading(false);
    }
  };

  const openPaymentModal = (cust: CustomerDueItem) => {
    setSelectedCustomer(cust);
    setPaymentAmount(cust.balanceDue);
    setPaymentMethod('CASH');
    setPaymentNote(`Payment for outstanding balance`);
    setPaymentModalOpen(true);
  };

  const handleReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || paymentAmount <= 0) return;
    setIsSubmitting(true);
    try {
      const res = await duesApi.receivePayment(selectedCustomer.id, {
        amount: paymentAmount,
        method: paymentMethod,
        note: paymentNote,
      });
      setNotification(`✅ Received ${formatPKR(paymentAmount)} from ${selectedCustomer.name}. Remaining dues: ${formatPKR(res.balanceAfter)}`);
      setPaymentModalOpen(false);
      setSelectedCustomer(null);
      loadDues();
      setTimeout(() => setNotification(null), 5000);
    } catch (err: any) {
      alert(err?.response?.data?.error || err.message || 'Payment processing failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openStatement = async (cust: CustomerDueItem) => {
    setSelectedCustomer(cust);
    setStatementModalOpen(true);
    setStatementLoading(true);
    try {
      const res = await duesApi.getCustomerStatement(cust.id);
      setStatement(res);
    } catch (err) {
      console.error('Failed to load statement:', err);
    } finally {
      setStatementLoading(false);
    }
  };

  return (
    <div className="page-container">
      {/* Toast Alert */}
      {notification && (
        <div
          style={{
            padding: '12px 18px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(var(--primary-rgb), 0.2))',
            border: '1px solid #10b981',
            color: '#34d399',
            fontWeight: 700,
            fontSize: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{notification}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setNotification(null)}>✕</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>💳 Customer Dues & Receivables (Udhaar)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Track customer credit balances, receive dues payments with automatic FIFO order settlement, and view statements
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid-cols-3" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
            💳
          </div>
          <div>
            <div className="stat-val" style={{ color: '#f87171' }}>{formatPKR(totalOutstanding)}</div>
            <div className="stat-label">Total Outstanding Dues</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
            👥
          </div>
          <div>
            <div className="stat-val" style={{ color: '#fbbf24' }}>{customersWithDues}</div>
            <div className="stat-label">Customers with Active Dues</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
            ⚡
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>FIFO Auto-Settled</div>
            <div className="stat-label">Oldest unpaid bills cleared first</div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          className="form-input"
          placeholder="🔍 Search customers with dues by Name, Phone, or Email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '420px' }}
        />
      </div>

      {/* Dues Data Table */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Phone</th>
              <th>Total Orders</th>
              <th>Total Spent</th>
              <th>Balance Due (Udhaar)</th>
              <th>Last Order</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎉</div>
                  <div style={{ fontWeight: 700 }}>No outstanding customer dues found!</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>All customers have settled their balances.</div>
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.name}</td>
                  <td>{c.phone || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                  <td>{c.totalOrders}</td>
                  <td>{formatPKR(c.totalSpent)}</td>
                  <td>
                    <span style={{ fontWeight: 800, color: '#f87171', fontSize: '15px' }}>
                      {formatPKR(c.balanceDue)}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openStatement(c)}
                        title="View statement and payment history"
                      >
                        📜 Statement
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => openPaymentModal(c)}
                        title="Receive payment against dues"
                      >
                        💵 Receive Payment
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* RECEIVE PAYMENT MODAL */}
      {paymentModalOpen && selectedCustomer && (
        <div className="modal-overlay" onClick={() => setPaymentModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">💵 Receive Dues Payment</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setPaymentModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleReceivePayment}>
              <div className="modal-body">
                <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>{selectedCustomer.name}</div>
                  {selectedCustomer.phone && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{selectedCustomer.phone}</div>}
                  <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span>Current Balance Due:</span>
                    <span style={{ fontWeight: 800, color: '#f87171' }}>{formatPKR(selectedCustomer.balanceDue)}</span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Amount (PKR) *</label>
                  <input
                    type="number"
                    step="any"
                    max={selectedCustomer.balanceDue}
                    min="1"
                    className="form-input"
                    style={{ fontSize: '18px', fontWeight: 800 }}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                    required
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPaymentAmount(selectedCustomer.balanceDue)}
                    >
                      Full Balance ({formatPKR(selectedCustomer.balanceDue)})
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPaymentAmount(Math.round(selectedCustomer.balanceDue / 2))}
                    >
                      Half (50%)
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Method</label>
                  <select
                    className="form-input"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="CASH">💵 Cash</option>
                    <option value="CARD">💳 Card / POS Machine</option>
                    <option value="QR">📱 EasyPaisa / JazzCash / QR</option>
                    <option value="ONLINE">🏦 Bank Transfer</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Reference Note (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    placeholder="e.g. Cleared via Bank Transfer"
                  />
                </div>

                <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px' }}>Remaining Balance After Payment:</span>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: paymentAmount >= selectedCustomer.balanceDue ? '#34d399' : '#fbbf24' }}>
                    {formatPKR(Math.max(0, selectedCustomer.balanceDue - paymentAmount))}
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setPaymentModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || paymentAmount <= 0}
                >
                  {isSubmitting ? 'Processing...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CUSTOMER STATEMENT MODAL */}
      {statementModalOpen && selectedCustomer && (
        <div className="modal-overlay" onClick={() => setStatementModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📜 Customer Account Statement</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setStatementModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800 }}>{selectedCustomer.name}</h4>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{selectedCustomer.phone || 'No phone recorded'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Current Balance Due</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#f87171' }}>{formatPKR(selectedCustomer.balanceDue)}</div>
                </div>
              </div>

              {statementLoading ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Loading statement...</div>
              ) : statement ? (
                <div>
                  <h5 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>
                    Ledger Timeline & Transactions
                  </h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {statement.entries.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No ledger entries found.</div>
                    ) : (
                      statement.entries.map((ent) => (
                        <div
                          key={ent.id}
                          style={{
                            background: 'var(--bg-secondary)',
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13px' }}>
                              {ent.type === 'CHARGE'
                                ? '🔴 Bill Added to Dues'
                                : ent.type === 'PAYMENT'
                                ? '🟢 Payment Received'
                                : ent.type === 'REFUND'
                                ? '↩️ Credit Reversed'
                                : '⚖️ Adjustment'}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {new Date(ent.createdAt).toLocaleString()} {ent.note ? `• ${ent.note}` : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div
                              style={{
                                fontWeight: 800,
                                color:
                                  ent.type === 'PAYMENT' ||
                                  ent.type === 'REFUND' ||
                                  (ent.type === 'ADJUSTMENT' && Number(ent.amount) < 0)
                                    ? '#34d399'
                                    : '#f87171',
                              }}
                            >
                              {ent.type === 'PAYMENT' ||
                              ent.type === 'REFUND' ||
                              (ent.type === 'ADJUSTMENT' && Number(ent.amount) < 0)
                                ? '-'
                                : '+'}{' '}
                              {formatPKR(Math.abs(Number(ent.amount) || 0))}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              Balance: {formatPKR(ent.balanceAfter)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStatementModalOpen(false)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={() => window.print()}>
                🖨️ Print Statement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuesPage;
