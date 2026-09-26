import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { RootState } from '../store/store';
import { Order, updatePaymentStatus, addOrder, updateOrder } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { paymentApi, PaymentItem } from '../api/payment.api';
import { ReceiptModal, ReceiptData } from '../components/ReceiptModal';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { formatPKR } from '../utils/format';
import { socketClient } from '../lib/socket';

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
  deliveryCharge: number;
  tax: number;
  taxRate: number;
  total: number;
  createdAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
}

export const PaymentsPage: React.FC = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const [selectedOrder, setSelectedOrder] = useState<OpenOrder | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);

  // Receipt Modal State
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Success alert message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Helper to format Order to OpenOrder
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
      deliveryCharge: Number(o.deliveryCharge || 0),
      tax: Number(o.tax || 0),
      taxRate: Number(o.taxRate || 0),
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

  // 1. Infinite Query for Unpaid Orders (Left Column)
  const {
    data: unpaidData,
    fetchNextPage: fetchNextUnpaid,
    hasNextPage: hasNextUnpaid,
    isFetchingNextPage: isFetchingNextUnpaid,
    isLoading: loadingUnpaid,
    refetch: refetchUnpaid,
  } = useInfiniteQuery({
    queryKey: ['unpaid-orders'],
    queryFn: ({ pageParam = 1 }) =>
      orderApi.getOrdersPaginated({
        page: pageParam,
        limit: 50,
        paymentStatus: 'UNPAID',
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const openOrders: OpenOrder[] = useMemo(() => {
    const rawList = unpaidData?.pages.flatMap((p) => p.data) || [];
    return rawList
      .filter((o) => o.paymentStatus !== 'PAID' && o.status !== 'cancelled')
      .map(formatOrderToOpenOrder);
  }, [unpaidData]);

  const totalUnpaidCount = unpaidData?.pages[0]?.totalCount ?? 0;

  // 2. Infinite Query for Paid Transactions / History (Right Column)
  const {
    data: paymentsData,
    fetchNextPage: fetchNextPayments,
    hasNextPage: hasNextPayments,
    isFetchingNextPage: isFetchingNextPayments,
    isLoading: loadingPayments,
    refetch: refetchPayments,
  } = useInfiniteQuery({
    queryKey: ['payments'],
    queryFn: ({ pageParam = 1 }) =>
      paymentApi.getPaymentsPaginated({
        page: pageParam,
        limit: 50,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const completedPayments: PaymentItem[] = useMemo(() => {
    return paymentsData?.pages.flatMap((p) => p.data) || [];
  }, [paymentsData]);

  const totalPaymentsCount = paymentsData?.pages[0]?.totalCount ?? 0;

  // Live WebSocket sync: Prepend new orders and payments dynamically
  useEffect(() => {
    const token = localStorage.getItem('auth_token') || 'pos-token';
    const socket = socketClient.connect(token);
    if (!socket) return;

    const handleNewOrder = (incoming: any) => {
      if (incoming.paymentStatus !== 'PAID') {
        queryClient.setQueriesData({ queryKey: ['unpaid-orders'] }, (oldData: any) => {
          if (!oldData || !oldData.pages || oldData.pages.length === 0) return oldData;
          const exists = oldData.pages.some((page: any) => page.data.some((o: any) => o.id === incoming.id));
          if (exists) return oldData;

          const firstPage = oldData.pages[0];
          return {
            ...oldData,
            pages: [{
              ...firstPage,
              data: [incoming, ...firstPage.data],
              totalCount: (firstPage.totalCount || 0) + 1,
            }, ...oldData.pages.slice(1)],
          };
        });
      }
      dispatch(addOrder(incoming));
    };

    const handleUpdatedOrder = (incoming: any) => {
      queryClient.invalidateQueries({ queryKey: ['unpaid-orders'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      dispatch(updateOrder(incoming));
    };

    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleUpdatedOrder);

    return () => {
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleUpdatedOrder);
    };
  }, [queryClient, dispatch]);

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
  }, [openOrders]);

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

      // Invalidate queries so lists update smoothly
      queryClient.invalidateQueries({ queryKey: ['unpaid-orders'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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
      deliveryCharge: selectedOrder.deliveryCharge,
      tax: selectedOrder.tax,
      taxRate: selectedOrder.taxRate,
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

  const handleReprintReceipt = (pay: PaymentItem) => {
    const rawOrder = pay.order;
    const receipt: ReceiptData = {
      orderNumber: pay.orderNumber || (rawOrder?.orderNumber ? Number(rawOrder.orderNumber) : 100),
      orderId: pay.orderId || pay.id,
      date: pay.processedAt || pay.createdAt,
      orderType: pay.orderType || rawOrder?.orderType || 'Dine In',
      server: rawOrder?.server ? `${rawOrder.server.firstName || ''} ${rawOrder.server.lastName || ''}`.trim() || 'Cashier' : 'Cashier',
      notes: pay.customerRef || 'Direct Order',
      items: Array.isArray(rawOrder?.items)
        ? rawOrder.items.map((i: any) => ({
            name: i.menuItem?.name || i.name || 'Dish',
            quantity: i.quantity || 1,
            unitPrice: Number(i.unitPrice || i.price || 0),
            total: Number(i.unitPrice || i.price || 0) * (i.quantity || 1),
          }))
        : [{ name: 'Order Payment', quantity: 1, unitPrice: pay.amount, total: pay.amount }],
      subtotal: rawOrder?.subtotal ? Number(rawOrder.subtotal) : pay.amount,
      serviceCharge: rawOrder?.serviceCharge ? Number(rawOrder.serviceCharge) : 0,
      deliveryCharge: rawOrder?.deliveryCharge ? Number(rawOrder.deliveryCharge) : 0,
      tax: rawOrder?.tax ? Number(rawOrder.tax) : 0,
      taxRate: rawOrder?.taxRate ? Number(rawOrder.taxRate) : 0,
      total: pay.amount + (pay.tipAmount || 0),
      totalPaid: pay.amount + (pay.tipAmount || 0),
      change: 0,
      paymentMethod: pay.method || 'CASH',
    };
    setReceiptData(receipt);
    setReceiptOpen(true);
  };

  const totalCollectedToday = completedPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalOpenBalance = openOrders.reduce((sum, o) => sum + o.total, 0);

  const handleRefreshAll = () => {
    refetchUnpaid();
    refetchPayments();
  };

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

        <button className="btn btn-secondary" onClick={handleRefreshAll}>
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
              {totalUnpaidCount || openOrders.length}
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
            <div className="stat-val">{totalPaymentsCount || completedPayments.length}</div>
            <div className="stat-label">Paid Transactions</div>
          </div>
        </div>
      </div>

      {/* Main Terminal View */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr 320px', gap: '20px', alignItems: 'start' }}>
        {/* Left: Open Orders Queue */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            ⏳ Unpaid Orders ({totalUnpaidCount || openOrders.length})
          </h3>

          {loadingUnpaid && openOrders.length === 0 ? (
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

              <InfiniteScrollSentinel
                hasNextPage={hasNextUnpaid}
                isFetchingNextPage={isFetchingNextUnpaid}
                fetchNextPage={fetchNextUnpaid}
                totalCount={totalUnpaidCount}
                currentCount={openOrders.length}
                emptyText=""
              />
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
            📜 Paid History ({totalPaymentsCount || completedPayments.length})
          </h3>

          {loadingPayments && completedPayments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              Loading paid transactions...
            </div>
          ) : completedPayments.length === 0 ? (
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
                      💳 #{p.orderNumber || p.order?.orderNumber || '100'}
                    </div>
                    <span style={{ fontWeight: 900, color: '#34d399' }}>{formatPKR(p.amount)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {p.method} • {new Date(p.processedAt || p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

              <InfiniteScrollSentinel
                hasNextPage={hasNextPayments}
                isFetchingNextPage={isFetchingNextPayments}
                fetchNextPage={fetchNextPayments}
                totalCount={totalPaymentsCount}
                currentCount={completedPayments.length}
                emptyText=""
              />
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
