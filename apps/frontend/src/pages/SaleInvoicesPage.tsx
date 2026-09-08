import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store/store';
import { Order, OrderItem, updateOrder, removeOrder, addOrder } from '../store/slices/orderSlice';
import { MenuItem } from '../store/slices/menuSlice';
import { ReceiptModal, ReceiptData } from '../components/ReceiptModal';
import { orderApi } from '../api/order.api';
import { formatPKR } from '../utils/format';

export const SaleInvoicesPage: React.FC = () => {
  const dispatch = useDispatch();
  const orders = useSelector((state: RootState) => state.orders.orders);
  const menuItems = useSelector((state: RootState) => state.menu.items);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderType, setSelectedOrderType] = useState<'ALL' | 'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY'>('ALL');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');

  // Receipt Modal State
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Edit Invoice Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  // Edit form state
  const [editOrderType, setEditOrderType] = useState<'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY'>('DINE_IN');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editDeliveryAddress, setEditDeliveryAddress] = useState('');
  const [editDineInTag, setEditDineInTag] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPaymentStatus, setEditPaymentStatus] = useState<'PAID' | 'UNPAID'>('PAID');
  const [editPaymentMethod, setEditPaymentMethod] = useState('CASH');
  const [editServiceChargeRate, setEditServiceChargeRate] = useState<number>(5);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [selectedMenuItemToAdd, setSelectedMenuItemToAdd] = useState<string>('');

  // Toast alert
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch all orders/invoices directly from backend Database on mount
  useEffect(() => {
    const fetchDbOrders = async () => {
      const dbOrders = await orderApi.getAllOrders();
      if (dbOrders && dbOrders.length > 0) {
        // Sync each DB order into Redux store
        for (const o of dbOrders) {
          const exists = orders.some((existing) => existing.id === o.id);
          if (exists) {
            dispatch(updateOrder(o));
          } else {
            dispatch(addOrder(o));
          }
        }
      }
    };
    fetchDbOrders();
  }, [dispatch]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // KPI calculations
  const totalInvoiced = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');
  const unpaidOrders = orders.filter((o) => o.paymentStatus === 'UNPAID');
  const paidRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const unpaidRevenue = unpaidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Filter invoices
  const filteredOrders = orders.filter((order) => {
    const matchesType = selectedOrderType === 'ALL' || order.orderType === selectedOrderType;
    const matchesPayment = selectedPaymentStatus === 'ALL' || order.paymentStatus === selectedPaymentStatus;

    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      String(order.orderNumber).toLowerCase().includes(query) ||
      (order.customerName && order.customerName.toLowerCase().includes(query)) ||
      (order.customerPhone && order.customerPhone.toLowerCase().includes(query)) ||
      (order.deliveryAddress && order.deliveryAddress.toLowerCase().includes(query)) ||
      (order.dineInTag && order.dineInTag.toLowerCase().includes(query)) ||
      order.items.some((i) => i.name.toLowerCase().includes(query));

    return matchesType && matchesPayment && matchesSearch;
  });

  const handleOpenReceipt = (order: Order) => {
    const receipt: ReceiptData = {
      orderNumber: order.orderNumber,
      orderId: order.id,
      date: order.createdAt,
      orderType: order.orderTypeLabel || (order.orderType === 'TAKE_AWAY' ? 'Take Away' : order.orderType === 'DELIVERY' ? 'Delivery' : 'Dine In'),
      server: typeof order.server === 'object' && order.server ? `${order.server.firstName} ${order.server.lastName}` : 'Cashier',
      notes: [
        order.notes ? `Note: ${order.notes}` : '',
        order.customerName ? `Customer: ${order.customerName}` : '',
        order.customerPhone ? `Contact: ${order.customerPhone}` : '',
        order.deliveryAddress ? `Delivery: ${order.deliveryAddress}` : '',
        order.dineInTag ? `Seat/Tag: ${order.dineInTag}` : '',
      ]
        .filter(Boolean)
        .join(' • '),
      items: order.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice || i.price,
        total: (i.unitPrice || i.price) * i.quantity,
        notes: i.notes,
      })),
      subtotal: order.subtotal,
      serviceCharge: order.serviceCharge,
      serviceChargeRate: order.serviceChargeRate,
      tax: 0,
      total: order.total,
      totalPaid: order.totalPaid || order.total,
      change: order.change || 0,
      paymentMethod: order.paymentMethod || 'CASH',
    };

    setReceiptData(receipt);
    setReceiptOpen(true);
  };

  const handleOpenEditModal = (order: Order) => {
    setEditingOrder(order);
    setEditOrderType(order.orderType || 'DINE_IN');
    setEditCustomerName(order.customerName || '');
    setEditCustomerPhone(order.customerPhone || '');
    setEditDeliveryAddress(order.deliveryAddress || '');
    setEditDineInTag(order.dineInTag || '');
    setEditNotes(order.notes || '');
    setEditPaymentStatus(order.paymentStatus || 'PAID');
    setEditPaymentMethod(order.paymentMethod || 'CASH');
    setEditServiceChargeRate(order.serviceChargeRate !== undefined ? order.serviceChargeRate : 5);
    setEditItems(order.items ? JSON.parse(JSON.stringify(order.items)) : []);
    setSelectedMenuItemToAdd(menuItems[0]?.id || '');
    setEditModalOpen(true);
  };

  const handleDeleteOrder = async (order: Order) => {
    if (confirm(`Are you sure you want to void / delete Sale Invoice #${order.orderNumber} from the database?`)) {
      dispatch(removeOrder(order.id));
      await orderApi.deleteOrder(order.id);
      showToast(`🗑️ Sale Invoice #${order.orderNumber} deleted from database.`);
    }
  };

  // Edit item helpers
  const handleUpdateItemQty = (itemId: string, delta: number) => {
    setEditItems((prev) =>
      prev
        .map((item) => {
          if (item.id === itemId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as OrderItem[]
    );
  };

  const handleRemoveEditItem = (itemId: string) => {
    setEditItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const handleAddItemToInvoice = () => {
    const itemToAdd = menuItems.find((m) => m.id === selectedMenuItemToAdd);
    if (!itemToAdd) return;

    setEditItems((prev) => {
      const existing = prev.find((i) => i.menuItemId === itemToAdd.id);
      if (existing) {
        return prev.map((i) =>
          i.menuItemId === itemToAdd.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          id: `oi-${Math.random().toString(36).substring(2, 7)}`,
          menuItemId: itemToAdd.id,
          name: itemToAdd.name,
          quantity: 1,
          price: itemToAdd.price,
          unitPrice: itemToAdd.price,
        },
      ];
    });
  };

  // Recalculate invoice financials
  const editSubtotal = editItems.reduce(
    (sum, item) => sum + (item.unitPrice || item.price) * item.quantity,
    0
  );
  const editServiceCharge = +(editSubtotal * (editServiceChargeRate / 100)).toFixed(2);
  const editTotal = +(editSubtotal + editServiceCharge).toFixed(2);

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    if (editItems.length === 0) {
      alert('An invoice must have at least 1 item.');
      return;
    }

    const orderTypeLabels: Record<string, string> = {
      DINE_IN: 'Dine In',
      TAKE_AWAY: 'Take Away',
      DELIVERY: 'Delivery',
    };

    const updated: Order = {
      ...editingOrder,
      orderType: editOrderType,
      orderTypeLabel: orderTypeLabels[editOrderType],
      customerName: editCustomerName.trim() || undefined,
      customerPhone: editCustomerPhone.trim() || undefined,
      deliveryAddress: editDeliveryAddress.trim() || undefined,
      dineInTag: editDineInTag.trim() || undefined,
      notes: editNotes.trim() || undefined,
      paymentStatus: editPaymentStatus,
      paymentMethod: editPaymentMethod,
      items: editItems,
      subtotal: editSubtotal,
      serviceCharge: editServiceCharge,
      serviceChargeRate: editServiceChargeRate,
      tax: 0,
      total: editTotal,
      totalPaid: editPaymentStatus === 'PAID' ? editTotal : 0,
      status: editPaymentStatus === 'PAID' ? 'paid' : editingOrder.status,
    };

    dispatch(updateOrder(updated));
    await orderApi.updateOrder(updated.id, updated);
    setEditModalOpen(false);
    setEditingOrder(null);
    showToast(`✅ Sale Invoice #${updated.orderNumber} saved & updated in Database!`);
  };

  const getOrderTypeBadge = (type: string) => {
    switch (type) {
      case 'DINE_IN':
        return <span className="badge badge-open">🍽️ Dine In</span>;
      case 'TAKE_AWAY':
        return <span className="badge badge-open" style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>🛍️ Take Away</span>;
      case 'DELIVERY':
        return <span className="badge badge-open" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399' }}>🛵 Delivery</span>;
      default:
        return <span className="badge badge-open">{type}</span>;
    }
  };

  return (
    <div className="page-container">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          style={{
            padding: '12px 20px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(99, 102, 241, 0.25))',
            border: '1px solid #10b981',
            color: '#34d399',
            fontWeight: 700,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 800 }}>🧾 Sale Invoices & Order History</h2>
            <span style={{ fontSize: '11px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>
              ⚡ Database Connected
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            All invoices and live modifications are synchronized and stored directly into the backend database
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
            🧾
          </div>
          <div>
            <div className="stat-val">{orders.length}</div>
            <div className="stat-label">Total Invoices</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(totalInvoiced)}</div>
            <div className="stat-label">Total Invoiced (PKR)</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            🟢
          </div>
          <div>
            <div className="stat-val" style={{ color: '#38bdf8' }}>{formatPKR(paidRevenue)}</div>
            <div className="stat-label">Settled Paid ({paidOrders.length})</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            ⏳
          </div>
          <div>
            <div className="stat-val" style={{ color: '#fbbf24' }}>{formatPKR(unpaidRevenue)}</div>
            <div className="stat-label">Unpaid / Pending ({unpaidOrders.length})</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          padding: '16px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            placeholder="🔍 Search by Invoice #, Customer Name, Phone, or Dish..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1, minWidth: '280px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Order Type Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Type:</span>
            {(['ALL', 'DINE_IN', 'TAKE_AWAY', 'DELIVERY'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`btn btn-sm ${selectedOrderType === type ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedOrderType(type)}
              >
                {type === 'ALL'
                  ? 'All Types'
                  : type === 'DINE_IN'
                  ? '🍽️ Dine In'
                  : type === 'TAKE_AWAY'
                  ? '🛍️ Take Away'
                  : '🛵 Delivery'}
              </button>
            ))}
          </div>

          {/* Payment Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Payment:</span>
            {(['ALL', 'PAID', 'UNPAID'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={`btn btn-sm ${selectedPaymentStatus === status ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedPaymentStatus(status)}
              >
                {status === 'ALL' ? 'All Status' : status === 'PAID' ? '🟢 Paid' : '⏳ Unpaid'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Invoices Data Table */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Date & Time</th>
              <th>Order Type</th>
              <th>Customer / Tag</th>
              <th>Ordered Items</th>
              <th>Subtotal</th>
              <th>Service</th>
              <th>Total Amount (PKR)</th>
              <th>Payment</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>🧾</div>
                  <div style={{ fontWeight: 600 }}>No Sale Invoices found</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    Orders created on the POS terminal will appear here.
                  </div>
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const isPaid = order.paymentStatus === 'PAID';
                const formattedDate = new Date(order.createdAt).toLocaleString('en-PK', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                });

                const customerTag =
                  order.customerName ||
                  order.dineInTag ||
                  order.deliveryAddress ||
                  'Direct Order';

                return (
                  <tr key={order.id}>
                    <td>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '14px' }}>
                        #{order.orderNumber}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formattedDate}</td>
                    <td>{getOrderTypeBadge(order.orderType)}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{customerTag}</div>
                      {order.customerPhone && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{order.customerPhone}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '12px', maxWidth: '240px', lineHeight: '1.4' }}>
                        {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatPKR(order.subtotal)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {order.serviceCharge > 0 ? formatPKR(order.serviceCharge) : '-'}
                    </td>
                    <td>
                      <span style={{ fontWeight: 900, color: '#34d399', fontSize: '15px' }}>
                        {formatPKR(order.total)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${isPaid ? 'badge-ready' : 'badge-open'}`}
                        style={{
                          background: isPaid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: isPaid ? '#34d399' : '#fbbf24',
                          fontWeight: 700,
                        }}
                      >
                        {isPaid ? '✓ PAID' : '⏳ UNPAID'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleOpenReceipt(order)}
                          title="View and Print Thermal Customer & Kitchen Slips"
                        >
                          🖨️ Slips
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleOpenEditModal(order)}
                          title="Edit Items, Quantities, and Details of Invoice"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteOrder(order)}
                          title="Void / Delete this invoice"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* EDIT INVOICE MODAL */}
      {editModalOpen && editingOrder && (
        <div className="modal-overlay" onClick={() => setEditModalOpen(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '680px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title">✏️ Edit Sale Invoice #{editingOrder.orderNumber}</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Modify dishes, quantities, order type, customer details, and payment status
                </span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveInvoice}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '68vh', overflowY: 'auto' }}>
                {/* 1. Order Type Selection */}
                <div>
                  <label className="form-label">Order Type</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(
                      [
                        { type: 'DINE_IN', label: '🍽️ Dine In' },
                        { type: 'TAKE_AWAY', label: '🛍️ Take Away' },
                        { type: 'DELIVERY', label: '🛵 Delivery' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.type}
                        type="button"
                        className={`btn ${editOrderType === opt.type ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ flex: 1 }}
                        onClick={() => setEditOrderType(opt.type)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contextual Fields */}
                {editOrderType === 'DINE_IN' && (
                  <div className="form-group">
                    <label className="form-label">Seat / Table Tag</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Seat 2, Patio 1..."
                      value={editDineInTag}
                      onChange={(e) => setEditDineInTag(e.target.value)}
                    />
                  </div>
                )}

                {editOrderType === 'TAKE_AWAY' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">Customer Name</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Customer name..."
                        value={editCustomerName}
                        onChange={(e) => setEditCustomerName(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Contact Phone</label>
                      <input
                        type="tel"
                        className="form-input"
                        placeholder="0300-XXXXXXX"
                        value={editCustomerPhone}
                        onChange={(e) => setEditCustomerPhone(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {editOrderType === 'DELIVERY' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group">
                        <label className="form-label">Customer Name</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Customer name..."
                          value={editCustomerName}
                          onChange={(e) => setEditCustomerName(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Contact Phone</label>
                        <input
                          type="tel"
                          className="form-input"
                          placeholder="0300-XXXXXXX"
                          value={editCustomerPhone}
                          onChange={(e) => setEditCustomerPhone(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Delivery Drop-off Address</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="House / Street / Area..."
                        value={editDeliveryAddress}
                        onChange={(e) => setEditDeliveryAddress(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* 2. Items Editor */}
                <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 800 }}>Invoice Items ({editItems.length})</h4>
                  </div>

                  {/* Add dish dropdown */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                    <select
                      className="form-select"
                      style={{ flex: 1 }}
                      value={selectedMenuItemToAdd}
                      onChange={(e) => setSelectedMenuItemToAdd(e.target.value)}
                    >
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.category}) - {formatPKR(m.price)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleAddItemToInvoice}
                    >
                      + Add to Invoice
                    </button>
                  </div>

                  {/* Items List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          background: 'rgba(0,0,0,0.25)',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '13px' }}>{item.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {formatPKR(item.unitPrice || item.price)} each • Total: {formatPKR((item.unitPrice || item.price) * item.quantity)}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '2px 8px', height: '26px' }}
                            onClick={() => handleUpdateItemQty(item.id, -1)}
                          >
                            -
                          </button>
                          <span style={{ fontWeight: 800, minWidth: '20px', textAlign: 'center' }}>
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '2px 8px', height: '26px' }}
                            onClick={() => handleUpdateItemQty(item.id, 1)}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            style={{ padding: '2px 8px', height: '26px', marginLeft: '6px' }}
                            onClick={() => handleRemoveEditItem(item.id)}
                            title="Remove item"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Payment Status & Service Charge */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Payment Status</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${editPaymentStatus === 'PAID' ? 'btn-success' : 'btn-secondary'}`}
                        style={{ flex: 1 }}
                        onClick={() => setEditPaymentStatus('PAID')}
                      >
                        ✓ PAID
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${editPaymentStatus === 'UNPAID' ? 'btn-warning' : 'btn-secondary'}`}
                        style={{ flex: 1 }}
                        onClick={() => setEditPaymentStatus('UNPAID')}
                      >
                        ⏳ UNPAID
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Service Charge</label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[0, 5, 10, 15].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          className={`btn btn-sm ${editServiceChargeRate === rate ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ flex: 1, padding: '4px 6px', fontSize: '11px' }}
                          onClick={() => setEditServiceChargeRate(rate)}
                        >
                          {rate === 0 ? 'None' : `${rate}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Kitchen & Special Notes</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Instructions, allergens, special requests..."
                  />
                </div>

                {/* Financial Summary */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <span>Subtotal</span>
                    <span>{formatPKR(editSubtotal)}</span>
                  </div>
                  {editServiceChargeRate > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      <span>Service Charges ({editServiceChargeRate}%)</span>
                      <span>{formatPKR(editServiceCharge)}</span>
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '18px',
                      fontWeight: 900,
                      color: '#34d399',
                      paddingTop: '6px',
                      borderTop: '1px dashed var(--border-color)',
                    }}
                  >
                    <span>Recalculated Total</span>
                    <span>{formatPKR(editTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes to Database
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dual Printable Receipt Modal */}
      <ReceiptModal
        isOpen={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        receiptData={receiptData}
      />
    </div>
  );
};

export default SaleInvoicesPage;
