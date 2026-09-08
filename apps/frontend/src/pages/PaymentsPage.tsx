import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store/store';
import { Order, updatePaymentStatus, setOrders } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { ReceiptModal, ReceiptData } from '../components/ReceiptModal';
import { formatPKR } from '../utils/format';

interface OpenOrder {
  id: string;
  orderNumber: number;
  orderType: string;
  orderTypeIcon: string;
  customerRef: string;
  serverName: string;
  itemCount: number;
  subtotal: number;
  serviceCharge: number;
  tax: number;
  total: number;
  createdAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
}

interface CompletedPayment {
  id: string;
  orderNumber: number;
  orderType: string;
  orderTypeIcon: string;
  customerRef: string;
  amount: number;
  serviceCharge: number;
  tipAmount: number;
  method: string;
  tendered: number;
  change: number;
  processedAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
}

export const PaymentsPage: React.FC = () => {
  const dispatch = useDispatch();
  const reduxOrders = useSelector((state: RootState) => state.orders.orders);

  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OpenOrder | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);

  // Receipt Modal State
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Success alert message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadLiveOrders = async () => {
    setLoading(true);
    try {
      const dbOrders = await orderApi.getAllOrders();
      if (Array.isArray(dbOrders) && dbOrders.length > 0) {
        dispatch(setOrders(dbOrders));
      }
    } catch (err) {
      console.warn('Failed to fetch orders for payments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLiveOrders();
  }, []);

  const formatOrderToOpenOrder = (o: Order): OpenOrder => {
    const typeStr =
      o.orderTypeLabel ||
      (o.orderType === 'TAKE_AWAY'
        ? 'Take Away'
        : o.orderType === 'DELIVERY'
        ? 'Delivery'
        : 'Dine In');
    const icon =
      o.orderType === 'TAKE_AWAY'
        ? '🛍️'
        : o.orderType === 'DELIVERY'
        ? '🛵'
        : '🍽️';

    const ref =
      o.customerName ||
      o.deliveryAddress ||
      o.dineInTag ||
      typeStr;

    return {
      id: o.id,
      orderNumber: typeof o.orderNumber === 'number' ? o.orderNumber : parseInt(String(o.orderNumber)) || 100,
      orderType: typeStr,
      orderTypeIcon: icon,
      customerRef: `${typeStr} (${ref})`,
      serverName: o.server ? `${o.server.firstName || ''} ${o.server.lastName || ''}`.trim() || 'Cashier' : 'Cashier',
      itemCount: (o.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0),
      subtotal: Number(o.subtotal || 0),
      serviceCharge: Number(o.serviceCharge || 0),
      tax: Number(o.tax || 0),
      total: Number(o.total || 0),
      createdAt: o.createdAt || new Date().toISOString(),
      items: (o.items || []).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice || i.price || 0),
        total: Number(i.unitPrice || i.price || 0) * (i.quantity || 1),
      })),
    };
  };

  const formatOrderToCompletedPayment = (o: Order): CompletedPayment => {
    const typeStr =
      o.orderTypeLabel ||
      (o.orderType === 'TAKE_AWAY'
        ? 'Take Away'
        : o.orderType === 'DELIVERY'
        ? 'Delivery'
        : 'Dine In');
    const icon =
      o.orderType === 'TAKE_AWAY'
        ? '🛍️'
        : o.orderType === 'DELIVERY'
        ? '🛵'
        : '🍽️';

    const ref =
      o.customerName ||
      o.deliveryAddress ||
      o.dineInTag ||
      typeStr;

    return {
      id: `pay-${o.id}`,
      orderNumber: typeof o.orderNumber === 'number' ? o.orderNumber : parseInt(String(o.orderNumber)) || 100,
      orderType: typeStr,
      orderTypeIcon: icon,
      customerRef: `${typeStr} (${ref})`,
      amount: Number(o.total || 0),
      serviceCharge: Number(o.serviceCharge || 0),
      tipAmount: 0,
      method: o.paymentMethod || 'CASH',
      tendered: Number(o.totalPaid || o.total || 0),
      change: Number(o.change || 0),
      processedAt: o.updatedAt || o.createdAt || new Date().toISOString(),
      items: (o.items || []).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice || i.price || 0),
        total: Number(i.unitPrice || i.price || 0) * (i.quantity || 1),
      })),
      subtotal: Number(o.subtotal || 0),
      tax: Number(o.tax || 0),
    };
  };

  const openOrders: OpenOrder[] = reduxOrders
    .filter((o) => o.paymentStatus !== 'PAID' && o.status !== 'cancelled')
    .map(formatOrderToOpenOrder);

  const completedPayments: CompletedPayment[] = reduxOrders
    .filter((o) => o.paymentStatus === 'PAID')
    .map(formatOrderToCompletedPayment);

  // Set default selected order if none or if current was paid
  useEffect(() => {
    if (openOrders.length > 0) {
      if (!selectedOrder || !openOrders.some((o) => o.id === selectedOrder.id)) {
        setSelectedOrder(openOrders[0]);
        setCashTendered(openOrders[0].total);
      }
    } else {
      setSelectedOrder(null);
    }
  }, [openOrders.length]);

  const handleSelectOrder = (order: OpenOrder) => {
    setSelectedOrder(order);
    setCashTendered(order.total);
    setTipAmount(0);
  };

  const calculateChange = () => {
    if (!selectedOrder) return 0;
    const grandTotal = selectedOrder.total + tipAmount;
    return Math.max(0, cashTendered - grandTotal);
  };

  const handleProcessPayment = async () => {
    if (!selectedOrder) return;

    const grandTotal = selectedOrder.total + tipAmount;
    const change = calculateChange();

    try {
      await orderApi.updatePaymentStatus(
        selectedOrder.id,
        'PAID',
        paymentMethod,
        cashTendered > grandTotal ? cashTendered : grandTotal,
        change
      );

      dispatch(
        updatePaymentStatus({
          id: selectedOrder.id,
          paymentStatus: 'PAID',
          paymentMethod,
          totalPaid: cashTendered > grandTotal ? cashTendered : grandTotal,
          change,
        })
      );
    } catch (err) {
      console.warn('Backend payment status update error:', err);
    }

    const receipt: ReceiptData = {
      orderNumber: selectedOrder.orderNumber,
      orderId: selectedOrder.id,
      date: new Date().toISOString(),
      orderType: selectedOrder.orderType,
      server: selectedOrder.serverName,
      notes: selectedOrder.customerRef,
      items: selectedOrder.items,
      subtotal: selectedOrder.subtotal,
      serviceCharge: selectedOrder.serviceCharge,
      serviceChargeRate: selectedOrder.serviceCharge > 0 ? 5 : 0,
      tax: selectedOrder.tax,
      total: grandTotal,
      totalPaid: cashTendered > grandTotal ? cashTendered : grandTotal,
      change: change,
      paymentMethod: paymentMethod,
    };

    setReceiptData(receipt);
    setReceiptOpen(true);
    setSuccessMessage(`✅ Payment of ${formatPKR(grandTotal)} successfully settled for #${selectedOrder.orderNumber}`);

    setTimeout(() => {
      setSuccessMessage(null);
    }, 5000);
  };

  const handleReprintReceipt = (pay: CompletedPayment) => {
    const receipt: ReceiptData = {
      orderNumber: pay.orderNumber,
      orderId: pay.id,
      date: pay.processedAt,
      orderType: pay.orderType,
      server: 'Cashier',
      notes: pay.customerRef,
      items: pay.items,
      subtotal: pay.subtotal,
      serviceCharge: pay.serviceCharge,
      serviceChargeRate: pay.serviceCharge > 0 ? 5 : 0,
      tax: pay.tax,
      total: pay.amount + pay.tipAmount,
      totalPaid: pay.tendered,
      change: pay.change,
      paymentMethod: pay.method,
    };
    setReceiptData(receipt);
    setReceiptOpen(true);
  };

  const totalCollectedToday = completedPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalOpenBalance = openOrders.reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>💳 Cashier & Payment Settlement (PKR)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database cashier register, multi-tender payments, and instant dual-receipt generation
          </p>
        </div>

        <button className="btn btn-secondary" onClick={loadLiveOrders}>
          🔄 Refresh Invoices
        </button>
      </div>

      {/* Success banner */}
      {successMessage && (
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
          {successMessage}
        </div>
      )}

      {/* Top Stat Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(totalCollectedToday)}</div>
            <div className="stat-label">Total Settled Invoices</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' }}>
            ⏳
          </div>
          <div>
            <div className="stat-val" style={{ color: openOrders.length > 0 ? '#f87171' : 'var(--text-primary)' }}>
              {openOrders.length}
            </div>
            <div className="stat-label">Pending Unpaid Checks</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            🧾
          </div>
          <div>
            <div className="stat-val" style={{ color: '#fbbf24' }}>{formatPKR(totalOpenBalance)}</div>
            <div className="stat-label">Uncollected Balance</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
            ✅
          </div>
          <div>
            <div className="stat-val">{completedPayments.length}</div>
            <div className="stat-label">Paid Transactions</div>
          </div>
        </div>
      </div>

      {/* Main Terminal View */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr 320px', gap: '20px', alignItems: 'start' }}>
        {/* Left: Open Orders Queue */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            ⏳ Unpaid Orders ({openOrders.length})
          </h3>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              Loading checks...
            </div>
          ) : openOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
              🎉 All customer checks are fully paid!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '520px', overflowY: 'auto' }}>
              {openOrders.map((o) => (
                <div
                  key={o.id}
                  onClick={() => handleSelectOrder(o)}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: selectedOrder?.id === o.id ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-secondary)',
                    border: selectedOrder?.id === o.id ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{o.orderTypeIcon}</span>
                      <span style={{ fontWeight: 800 }}>#{o.orderNumber}</span>
                    </div>
                    <span style={{ fontWeight: 900, color: '#34d399' }}>{formatPKR(o.total)}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {o.customerRef}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    <span>{o.itemCount} items</span>
                    <span>Server: {o.serverName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center: Tender & Payment Calculator */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 800, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            💵 Tender & Payment Method
          </h3>

          {!selectedOrder ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              Select an unpaid order from the left column to process payment.
            </div>
          ) : (
            <>
              {/* Order Info Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', padding: '12px 16px', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Selected Order</div>
                  <div style={{ fontSize: '18px', fontWeight: 900 }}>
                    {selectedOrder.orderTypeIcon} #{selectedOrder.orderNumber} • {selectedOrder.customerRef}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Payable Total</div>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: '#34d399' }}>
                    {formatPKR(selectedOrder.total)}
                  </div>
                </div>
              </div>

              {/* Payment Methods */}
              <div>
                <label className="input-label" style={{ marginBottom: '8px' }}>Select Payment Method</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {[
                    { id: 'CASH', label: 'Cash', icon: '💵' },
                    { id: 'CARD / VISA', label: 'Credit/Debit Card', icon: '💳' },
                    { id: 'JAZZCASH', label: 'JazzCash', icon: '📱' },
                    { id: 'EASYPAISA', label: 'EasyPaisa', icon: '📲' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id)}
                      style={{
                        padding: '14px 10px',
                        borderRadius: 'var(--radius-md)',
                        background: paymentMethod === m.id ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-secondary)',
                        border: paymentMethod === m.id ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        color: paymentMethod === m.id ? 'var(--primary)' : 'var(--text-primary)',
                        fontWeight: 800,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '22px' }}>{m.icon}</span>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Cash Amounts */}
              {paymentMethod === 'CASH' && (
                <div>
                  <label className="input-label" style={{ marginBottom: '8px' }}>Fast Cash Tender Presets (PKR)</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {[
                      selectedOrder.total,
                      Math.ceil(selectedOrder.total / 500) * 500,
                      Math.ceil(selectedOrder.total / 1000) * 1000,
                      5000,
                      10000,
                    ]
                      .filter((val, idx, self) => self.indexOf(val) === idx && val >= selectedOrder.total)
                      .map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => setCashTendered(preset)}
                          style={{ fontWeight: 800, padding: '8px 14px' }}
                        >
                          {formatPKR(preset)}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Tender Amount Input */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label className="input-label">Tendered / Received Amount (PKR)</label>
                  <input
                    type="number"
                    min={selectedOrder.total}
                    step="any"
                    className="input-field"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(Number(e.target.value))}
                    style={{ fontSize: '18px', fontWeight: 800 }}
                  />
                </div>

                <div>
                  <label className="input-label">Change / Return Due (PKR)</label>
                  <div
                    style={{
                      background: 'var(--bg-secondary)',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '18px',
                      fontWeight: 900,
                      color: calculateChange() > 0 ? '#38bdf8' : 'var(--text-muted)',
                    }}
                  >
                    {formatPKR(calculateChange())}
                  </div>
                </div>
              </div>

              {/* Settle Button */}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProcessPayment}
                style={{ padding: '16px', fontSize: '16px', fontWeight: 800, marginTop: '8px', background: 'var(--success)' }}
              >
                ✅ Settle Payment & Print Receipt ({formatPKR(selectedOrder.total)})
              </button>
            </>
          )}
        </div>

        {/* Right: Paid Invoices Log */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            📜 Paid History ({completedPayments.length})
          </h3>

          {completedPayments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
              No payments settled yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '520px', overflowY: 'auto' }}>
              {completedPayments.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800 }}>
                      {p.orderTypeIcon} #{p.orderNumber}
                    </div>
                    <span style={{ fontWeight: 900, color: '#34d399' }}>{formatPKR(p.amount)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {p.method} • {new Date(p.processedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleReprintReceipt(p)}
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                    >
                      🖨️ Receipt
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        isOpen={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        receiptData={receiptData}
      />
    </div>
  );
};

export default PaymentsPage;
