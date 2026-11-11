import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { RootState } from '../store/store';
import { Order, updatePaymentStatus, addOrder, updateOrder } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { paymentApi, PaymentItem } from '../api/payment.api';
import { customerApi, Customer } from '../api/customer.api';
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
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  serverName: string;
  itemCount: number;
  subtotal: number;
  serviceCharge: number;
  deliveryCharge: number;
  tax: number;
  taxRate: number;
  total: number;
  totalPaid: number;
  amountDue: number;
  paymentStatus: string;
  createdAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
}

export const PaymentsPage: React.FC = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const [selectedOrder, setSelectedOrder] = useState<OpenOrder | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [settleToCredit, setSettleToCredit] = useState(false);

  // Customer search & attachment for Udhaar credit
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [attachedCustomer, setAttachedCustomer] = useState<Customer | null>(null);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);

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

    const total = Number(o.total || 0);
    const totalPaid = Number((o as any).totalPaid || 0);
    const amountDue = Number((o as any).amountDue ?? Math.max(0, +(total - totalPaid).toFixed(2)));

    return {
      id: o.id,
      orderNumber: typeof o.orderNumber === 'number' ? o.orderNumber : parseInt(String(o.orderNumber)) || 100,
      orderType: typeStr,
      orderTypeIcon: icon,
      customerRef: `${typeStr} (${ref})`,
      customerId: (o as any).customerId,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      serverName: o.server ? `${o.server.firstName || ''} ${o.server.lastName || ''}`.trim() || 'Cashier' : 'Cashier',
      itemCount: (o.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0),
      subtotal: Number(o.subtotal || 0),
      serviceCharge: Number(o.serviceCharge || 0),
      deliveryCharge: Number(o.deliveryCharge || 0),
      tax: Number(o.tax || 0),
      taxRate: Number(o.taxRate || 0),
      total,
      totalPaid,
      amountDue,
      paymentStatus: o.paymentStatus || 'UNPAID',
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
      .filter((o) => !(o as any).settledToCredit)
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
            pages: [
              {
                ...firstPage,
                data: [incoming, ...firstPage.data],
                totalCount: (firstPage.totalCount || 0) + 1,
              },
              ...oldData.pages.slice(1),
            ],
          };
        });
      }
      dispatch(addOrder(incoming));
    };

    const handleUpdatedOrder = (incoming: any) => {
      queryClient.invalidateQueries({ queryKey: ['unpaid-orders'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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
        const first = openOrders[0];
        setSelectedOrder(first);
        const rem = Math.max(0, +(first.total - first.totalPaid).toFixed(2));
        setAmountReceived(rem);
        setCashTendered(rem);
        setSettleToCredit(false);
        setAttachedCustomer(null);
      }
    } else {
      setSelectedOrder(null);
    }
  }, [openOrders]);

  const handleSelectOrder = (order: OpenOrder) => {
    setSelectedOrder(order);
    const rem = Math.max(0, +(order.total - order.totalPaid).toFixed(2));
    setAmountReceived(rem);
    setCashTendered(rem);
    setTipAmount(0);
    setSettleToCredit(false);
    setAttachedCustomer(null);
  };

  const remainingBalance = selectedOrder
    ? Math.max(0, +(selectedOrder.total - selectedOrder.totalPaid).toFixed(2))
    : 0;

  const calculateChange = () => {
    if (!selectedOrder) return 0;
    if (paymentMethod !== 'CASH') return 0;
    return Math.max(0, +(cashTendered - amountReceived).toFixed(2));
  };

  // Search customers when adding to credit without customer
  useEffect(() => {
    if (!settleToCredit || !customerSearch.trim() || customerSearch.trim().length < 2) {
      setCustomerSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setCustomerSearchLoading(true);
      try {
        const res = await customerApi.list({ search: customerSearch.trim(), limit: 5 });
        setCustomerSuggestions(res.data);
      } catch {
        setCustomerSuggestions([]);
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch, settleToCredit]);

  const handleProcessPayment = async () => {
    if (!selectedOrder) return;
    const rem = Math.max(0, +(selectedOrder.total - selectedOrder.totalPaid).toFixed(2));
    const amountToRecord = Math.min(amountReceived, rem);

    if (amountToRecord <= 0 && !settleToCredit) {
      alert('Please enter an amount to receive');
      return;
    }

    if (settleToCredit && !selectedOrder.customerId && !attachedCustomer) {
      alert('A customer must be attached to the order to add remaining balance to Udhaar / customer dues');
      return;
    }

    try {
      if (!selectedOrder.customerId && attachedCustomer) {
        await orderApi.updateOrder(selectedOrder.id, {
          customerId: attachedCustomer.id,
          customerName: attachedCustomer.name,
          customerPhone: attachedCustomer.phone || undefined,
        });
      }

      const payRes: any = await paymentApi.createPayment({
        orderId: selectedOrder.id,
        amount: amountToRecord,
        tipAmount,
        method: paymentMethod,
        settleToCredit,
      });

      const change = calculateChange();
      const newTotalPaid = +(selectedOrder.totalPaid + amountToRecord).toFixed(2);
      const remainingAfter = Math.max(0, +(rem - amountToRecord).toFixed(2));
      const newStatus = remainingAfter <= 0.01 ? 'PAID' : 'PARTIAL';

      dispatch(
        updatePaymentStatus({
          id: selectedOrder.id,
          paymentStatus: newStatus,
          paymentMethod,
          totalPaid: newTotalPaid,
          change,
        })
      );

      // Invalidate queries so lists update smoothly
      queryClient.invalidateQueries({ queryKey: ['unpaid-orders'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dues'] });

      const receipt: ReceiptData = {
        orderNumber: selectedOrder.orderNumber,
        orderId: selectedOrder.id,
        date: new Date().toISOString(),
        orderType: selectedOrder.orderType,
        server: selectedOrder.serverName,
        customerName: attachedCustomer?.name || selectedOrder.customerName,
        customerPhone: attachedCustomer?.phone || selectedOrder.customerPhone,
        notes: selectedOrder.customerRef,
        items: selectedOrder.items,
        subtotal: selectedOrder.subtotal,
        serviceCharge: selectedOrder.serviceCharge,
        deliveryCharge: selectedOrder.deliveryCharge,
        tax: selectedOrder.tax,
        taxRate: selectedOrder.taxRate,
        total: selectedOrder.total,
        totalPaid: newTotalPaid,
        change,
        paymentMethod,
        // When the remainder is settled to customer credit, the order itself is
        // fully settled; the customer's outstanding dues are shown separately.
        amountDue: settleToCredit ? 0 : remainingAfter,
        settledToCredit: settleToCredit,
        balanceDue: payRes?.customerBalance,
      };

      setReceiptData(receipt);
      setReceiptOpen(true);
      setSuccessMessage(
        `✅ Payment of ${formatPKR(amountToRecord)} recorded for #${selectedOrder.orderNumber}.${
          remainingAfter > 0
            ? settleToCredit
              ? ` Remaining ${formatPKR(remainingAfter)} added to customer Udhaar/dues.`
              : ` Remaining balance: ${formatPKR(remainingAfter)}.`
            : ' Order fully settled!'
        }`
      );

      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (err: any) {
      alert(err?.response?.data?.error || err.message || 'Payment settlement failed');
    }
  };

  const handleReprintReceipt = (pay: PaymentItem) => {
    const rawOrder = pay.order;
    const receipt: ReceiptData = {
      orderNumber: pay.orderNumber || (rawOrder?.orderNumber ? Number(rawOrder.orderNumber) : 100),
      orderId: pay.orderId || pay.id,
      date: pay.processedAt || pay.createdAt,
      orderType: pay.orderType || rawOrder?.orderType || 'Dine In',
      server: rawOrder?.server ? `${rawOrder.server.firstName || ''} ${rawOrder.server.lastName || ''}`.trim() || 'Cashier' : 'Cashier',
      customerName: rawOrder?.customerName,
      customerPhone: rawOrder?.customerPhone,
      notes: pay.customerRef || 'Direct Order',
      items: rawOrder?.items || [],
      subtotal: rawOrder?.subtotal || pay.amount,
      serviceCharge: rawOrder?.serviceCharge || 0,
      deliveryCharge: rawOrder?.deliveryCharge || 0,
      tax: rawOrder?.tax || 0,
      taxRate: rawOrder?.taxRate || 0,
      total: rawOrder?.total || pay.amount,
      totalPaid: pay.amount,
      change: 0,
      paymentMethod: pay.method,
    };
    setReceiptData(receipt);
    setReceiptOpen(true);
  };

  const amountToRecord = Math.min(amountReceived, remainingBalance);
  const remainingAfterPayment = Math.max(0, +(remainingBalance - amountToRecord).toFixed(2));

  return (
    <div className="page-container">
      {/* Toast Alert */}
      {successMessage && (
        <div
          style={{
            padding: '12px 20px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(var(--primary-rgb), 0.25))',
            border: '1px solid #10b981',
            color: '#34d399',
            fontWeight: 700,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>💵 Payments & Cash Register</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Single source of truth for payment collection, partial settlements, and Udhaar credit
          </p>
        </div>
      </div>

      {/* Grid: Unpaid (Left) | Tender Calculator (Center) | Paid History (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: '20px', alignItems: 'start' }}>
        {/* Left: Open / Unpaid / Partial Checks */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            ⏳ Open Checks ({totalUnpaidCount || openOrders.length})
          </h3>

          {loadingUnpaid && openOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              Loading unpaid orders...
            </div>
          ) : openOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '32px', marginBottom: '6px' }}>🎉</div>
              <div style={{ fontWeight: 700 }}>All checks paid!</div>
              <div style={{ fontSize: '12px', marginTop: '2px' }}>New unpaid orders from POS will appear here.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '560px', overflowY: 'auto' }}>
              {openOrders.map((o) => {
                const rem = Math.max(0, +(o.total - o.totalPaid).toFixed(2));
                const isSelected = selectedOrder?.id === o.id;
                return (
                  <div
                    key={o.id}
                    onClick={() => handleSelectOrder(o)}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-md)',
                      background: isSelected ? 'rgba(var(--primary-rgb), 0.15)' : 'var(--bg-secondary)',
                      border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 900, fontSize: '15px' }}>
                        {o.orderTypeIcon} #{o.orderNumber}
                      </span>
                      <span style={{ fontWeight: 800, color: rem < o.total ? '#fbbf24' : '#34d399', fontSize: '14px' }}>
                        {formatPKR(rem)}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {o.customerRef}
                    </div>

                    {o.totalPaid > 0 && (
                      <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '3px', fontWeight: 600 }}>
                        Paid: {formatPKR(o.totalPaid)} • Due: {formatPKR(rem)}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      <span>{o.itemCount} items</span>
                      <span>Server: {o.serverName}</span>
                    </div>
                  </div>
                );
              })}

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
            💵 Tender & Payment Settlement
          </h3>

          {!selectedOrder ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              Select an unpaid order from the left column to process payment.
            </div>
          ) : (
            <>
              {/* Order Info & Balances Bar (Before Payment) */}
              <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Selected Order</div>
                    <div style={{ fontSize: '18px', fontWeight: 900 }}>
                      {selectedOrder.orderTypeIcon} #{selectedOrder.orderNumber} • {selectedOrder.customerRef}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Remaining Balance Due</div>
                    <div style={{ fontSize: '24px', fontWeight: 900, color: '#f87171' }}>
                      {formatPKR(remainingBalance)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-color)', paddingTop: '8px', fontSize: '12px' }}>
                  <span>Order Total: <strong>{formatPKR(selectedOrder.total)}</strong></span>
                  <span>Already Paid: <strong style={{ color: '#34d399' }}>{formatPKR(selectedOrder.totalPaid)}</strong></span>
                  <span>Balance Due: <strong style={{ color: '#f87171' }}>{formatPKR(remainingBalance)}</strong></span>
                </div>
              </div>

              {/* Payment Methods */}
              <div>
                <label className="input-label" style={{ marginBottom: '8px' }}>Select Payment Method</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {[
                    { id: 'CASH', label: 'Cash', icon: '💵' },
                    { id: 'CARD / VISA', label: 'Card / Machine', icon: '💳' },
                    { id: 'JAZZCASH', label: 'JazzCash', icon: '📱' },
                    { id: 'EASYPAISA', label: 'EasyPaisa', icon: '📲' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id)}
                      style={{
                        padding: '12px 8px',
                        borderRadius: 'var(--radius-md)',
                        background: paymentMethod === m.id ? 'rgba(var(--primary-rgb), 0.2)' : 'var(--bg-secondary)',
                        border: paymentMethod === m.id ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        color: paymentMethod === m.id ? 'var(--primary)' : 'var(--text-primary)',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>{m.icon}</span>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount to Pay / Settle Input */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="input-label" style={{ margin: 0 }}>Amount Received / Paying Today (PKR)</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setAmountReceived(remainingBalance);
                        setCashTendered(remainingBalance);
                      }}
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                      Exact Due ({formatPKR(remainingBalance)})
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        const half = Math.round(remainingBalance / 2);
                        setAmountReceived(half);
                        setCashTendered(half);
                      }}
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                      Half (50%)
                    </button>
                  </div>
                </div>

                <input
                  type="number"
                  step="any"
                  max={remainingBalance}
                  min="1"
                  className="input-field"
                  value={amountReceived}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setAmountReceived(val);
                    if (paymentMethod === 'CASH' && cashTendered < val) {
                      setCashTendered(val);
                    }
                  }}
                  style={{ fontSize: '20px', fontWeight: 800 }}
                />
              </div>

              {/* Cash Tendered & Change Returned (When Cash Selected) */}
              {paymentMethod === 'CASH' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label className="input-label">Cash Handed by Customer (PKR)</label>
                    <input
                      type="number"
                      step="any"
                      min={amountReceived}
                      className="input-field"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
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
              )}

              {/* Live Preview Before and After */}
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Settled in this transaction:</span>{' '}
                  <strong style={{ color: '#34d399' }}>{formatPKR(amountToRecord)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Balance remaining after:</span>{' '}
                  <strong style={{ color: remainingAfterPayment > 0 ? '#f87171' : '#34d399' }}>
                    {formatPKR(remainingAfterPayment)}
                  </strong>
                </div>
              </div>

              {/* Checkbox: Add remaining to customer dues (Udhaar) */}
              {remainingAfterPayment > 0 && (
                <div
                  style={{
                    background: settleToCredit ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-secondary)',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: settleToCredit ? '1px solid #ef4444' : '1px solid var(--border-color)',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={settleToCredit}
                      onChange={(e) => setSettleToCredit(e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span>Add remaining {formatPKR(remainingAfterPayment)} to Customer Dues / Credit (Udhaar)</span>
                  </label>

                  {settleToCredit && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                      {selectedOrder.customerId ? (
                        <div style={{ fontSize: '12px', color: '#34d399' }}>
                          ✓ Attached customer: <strong>{selectedOrder.customerName || 'Registered Customer'}</strong> ({selectedOrder.customerPhone || 'No phone'})
                        </div>
                      ) : attachedCustomer ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                          <span style={{ color: '#34d399' }}>
                            ✓ Customer attached: <strong>{attachedCustomer.name}</strong> ({attachedCustomer.phone || 'No phone'})
                          </span>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttachedCustomer(null)}>Change</button>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: '12px', color: '#f87171', fontWeight: 600, marginBottom: '6px' }}>
                            ⚠️ This order has no customer linked. Search and select a customer to charge dues:
                          </div>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Type customer name or mobile number..."
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            style={{ fontSize: '13px' }}
                          />
                          {customerSearchLoading && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Searching...</div>}
                          {customerSuggestions.length > 0 && (
                            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '140px', overflowY: 'auto' }}>
                              {customerSuggestions.map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => {
                                    setAttachedCustomer(c);
                                    setCustomerSuggestions([]);
                                    setCustomerSearch('');
                                  }}
                                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', fontSize: '13px' }}
                                >
                                  <strong>{c.name}</strong> • {c.phone || 'No phone'} (Current Due: {formatPKR(c.balanceDue)})
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Settle Button */}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProcessPayment}
                style={{
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: 800,
                  marginTop: '8px',
                  background: 'var(--success)',
                }}
              >
                ✅ Settle Payment ({formatPKR(amountToRecord)})
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
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>
                      #{p.orderNumber || (p.order?.orderNumber ? Number(p.order.orderNumber) : '100')} • {p.method}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {new Date(p.processedAt || p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {p.customerRef || 'Direct'}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 900, color: '#34d399', fontSize: '14px' }}>
                      {formatPKR(p.amount)}
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleReprintReceipt(p)}
                      style={{ fontSize: '10px', padding: '2px 8px', marginTop: '4px' }}
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

      {/* Printable Receipt Modal */}
      <ReceiptModal
        isOpen={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        receiptData={receiptData}
        defaultTab="CUSTOMER"
      />
    </div>
  );
};

export default PaymentsPage;
