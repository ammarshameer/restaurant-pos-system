import React, { useEffect, useState } from 'react';
import { customerApi, Customer } from '../api/customer.api';
import { duesApi } from '../api/dues.api';
import { formatPKR } from '../utils/format';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Edit / Add Customer Modal State
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formCreditLimit, setFormCreditLimit] = useState<number>(0);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Receive Payment Modal State
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER'>('CASH');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Delete Confirm Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await customerApi.list({ page, limit, search });
      setCustomers(result.data);
      setTotalCount(result.totalCount);
      setHasMore(result.hasMore);
    } catch (err: any) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [page, limit, search]);

  const handleOpenAddModal = () => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormNotes('');
    setFormCreditLimit(0);
    setFormError(null);
    setCustomerModalOpen(true);
  };

  const handleOpenEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormName(customer.name);
    setFormPhone(customer.phone || '');
    setFormEmail(customer.email || '');
    setFormAddress(customer.address || '');
    setFormNotes(customer.notes || '');
    setFormCreditLimit(customer.creditLimit || 0);
    setFormError(null);
    setCustomerModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Customer name is required.');
      return;
    }
    setFormSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: formName.trim(),
        phone: formPhone.trim() || undefined,
        email: formEmail.trim() || undefined,
        address: formAddress.trim() || undefined,
        notes: formNotes.trim() || undefined,
        creditLimit: formCreditLimit,
      };

      if (editingCustomer) {
        await customerApi.update(editingCustomer.id, payload);
        setNotification(`✅ Customer "${payload.name}" updated successfully.`);
      } else {
        await customerApi.create(payload);
        setNotification(`✅ Customer "${payload.name}" created successfully.`);
      }
      setCustomerModalOpen(false);
      load();
    } catch (error: any) {
      setFormError(error?.response?.data?.error || error?.message || 'Failed to save customer');
    } finally {
      setFormSaving(false);
    }
  };

  const handleOpenPaymentModal = (customer: Customer) => {
    setPaymentCustomer(customer);
    setPaymentAmount(customer.balanceDue || 0);
    setPaymentMethod('CASH');
    setPaymentNote(`Dues payment from ${customer.name}`);
    setPaymentError(null);
    setPaymentModalOpen(true);
  };

  const handleReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer) return;
    if (paymentAmount <= 0) {
      setPaymentError('Payment amount must be greater than zero.');
      return;
    }
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      await duesApi.receivePayment(paymentCustomer.id, {
        amount: paymentAmount,
        method: paymentMethod,
        note: paymentNote,
      });
      setNotification(`✅ Received ${formatPKR(paymentAmount)} payment for "${paymentCustomer.name}".`);
      setPaymentModalOpen(false);
      load();
    } catch (err: any) {
      setPaymentError(err?.response?.data?.error || err?.message || 'Failed to record payment');
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!customerToDelete) return;
    try {
      await customerApi.delete(customerToDelete.id);
      setNotification(`🗑️ Customer "${customerToDelete.name}" deleted.`);
      setDeleteModalOpen(false);
      setCustomerToDelete(null);
      load();
    } catch (err: any) {
      setNotification(`⚠️ ${err?.response?.data?.error || 'Failed to delete customer'}`);
    }
  };

  const pageCount = Math.max(1, Math.ceil(totalCount / limit));

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '8px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-md)',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{notification}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setNotification(null)}>✕</button>
        </div>
      )}

      {/* Header and Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800 }}>👤 Customer Directory</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Manage customer accounts, purchase history, and outstanding balances.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="🔍 Search name, phone, or email..."
            style={{ minWidth: '260px', padding: '8px 12px', fontSize: '13px' }}
          />
          <button onClick={handleOpenAddModal} className="btn btn-primary" style={{ fontWeight: 700 }}>
            + Add Customer
          </button>
        </div>
      </div>

      {/* Table Card */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading customers...</div>
        ) : customers.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No customers found. Click <strong>+ Add Customer</strong> to add one, or customers are automatically saved when placing orders!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Customer</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Contact</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'center' }}>Orders</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Total Spent</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Balance Due (Udhaar)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Last Order</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => {
                  const hasDue = (customer.balanceDue || 0) > 0.01;
                  return (
                    <tr
                      key={customer.id}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        transition: 'background 0.2s',
                      }}
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{customer.name}</div>
                        {customer.address && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>📍 {customer.address}</div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        <div>{customer.phone || '—'}</div>
                        {customer.email && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{customer.email}</div>}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600 }}>
                        {customer.totalOrders}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700 }}>
                        {formatPKR(customer.totalSpent || 0)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {hasDue ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#ef4444',
                              fontWeight: 800,
                              fontSize: '12px',
                            }}
                          >
                            {formatPKR(customer.balanceDue || 0)}
                          </span>
                        ) : (
                          <span style={{ color: '#10b981', fontWeight: 600, fontSize: '12px' }}>
                            ✓ Cleared
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                        {customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                          {hasDue && (
                            <button
                              type="button"
                              onClick={() => handleOpenPaymentModal(customer)}
                              className="btn btn-warning btn-sm"
                              style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700 }}
                              title="Receive dues payment"
                            >
                              💰 Receive Udhaar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(customer)}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerToDelete(customer);
                              setDeleteModalOpen(true);
                            }}
                            className="btn btn-danger btn-sm"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) => {
                setPage(1);
                setLimit(Number(e.target.value));
              }}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
            <span style={{ color: 'var(--text-muted)' }}>Total: {totalCount} customers</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pageCount}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!hasMore}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Customer Modal */}
      {customerModalOpen && (
        <div className="modal-overlay" onClick={() => setCustomerModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {editingCustomer ? '✏️ Edit Customer' : '👤 Add New Customer'}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCustomerModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveCustomer}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {formError && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '13px' }}>
                    {formError}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Ali Ahmed"
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div className="form-group">
                    <label className="form-label">Phone Number</label>
                    <input
                      type="tel"
                      className="form-input"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="e.g. 0300 1234567"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      className="form-input"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="e.g. ali@example.com"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Address</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="e.g. House 12, Street 4, Sector F-7"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Credit Limit (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="form-input"
                    value={formCreditLimit}
                    onChange={(e) => setFormCreditLimit(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0 for unlimited"
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Set max allowed Udhaar balance (0 = no hard limit)
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Special instructions or preferences..."
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCustomerModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={formSaving}>
                  {formSaving ? 'Saving...' : editingCustomer ? 'Update Customer' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Udhaar Payment Modal */}
      {paymentModalOpen && paymentCustomer && (
        <div className="modal-overlay" onClick={() => setPaymentModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">💰 Receive Udhaar Payment</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setPaymentModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleReceivePayment}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {paymentError && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '13px' }}>
                    {paymentError}
                  </div>
                )}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{paymentCustomer.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{paymentCustomer.phone || 'No phone'}</div>
                  <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Total Balance Due:</span>
                    <span style={{ fontSize: '18px', fontWeight: 800, color: '#ef4444' }}>
                      {formatPKR(paymentCustomer.balanceDue || 0)}
                    </span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Amount Received (PKR) *</label>
                  <input
                    type="number"
                    step="10"
                    min="1"
                    className="form-input"
                    style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center' }}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    required
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => setPaymentAmount(paymentCustomer.balanceDue || 0)}
                    >
                      Full ({formatPKR(paymentCustomer.balanceDue || 0)})
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => setPaymentAmount(Math.round((paymentCustomer.balanceDue || 0) / 2))}
                    >
                      Half ({formatPKR(Math.round((paymentCustomer.balanceDue || 0) / 2))})
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Method</label>
                  <select
                    className="form-input"
                    value={paymentMethod}
                    onChange={(e: any) => setPaymentMethod(e.target.value)}
                  >
                    <option value="CASH">Cash</option>
                    <option value="CARD">Debit / Credit Card</option>
                    <option value="BANK_TRANSFER">Bank Transfer / Raast</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Note / Receipt Ref</label>
                  <input
                    type="text"
                    className="form-input"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPaymentModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-success" disabled={paymentSaving}>
                  {paymentSaving ? 'Saving...' : '✓ Settle & Allocate FIFO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && customerToDelete && (
        <div className="modal-overlay" onClick={() => setDeleteModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🗑️ Delete Customer</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleteModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete customer <strong>{customerToDelete.name}</strong>?
              </p>
              {(customerToDelete.balanceDue || 0) > 0 && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '13px', marginTop: '10px' }}>
                  ⚠️ This customer has an outstanding balance of {formatPKR(customerToDelete.balanceDue || 0)}.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>
                Delete Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersPage;
