import React, { useState, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Order } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { InfiniteScrollSentinel } from './InfiniteScrollSentinel';
import { formatPKR } from '../utils/format';
import { socketClient } from '../lib/socket';

export interface OrderListProps {
  onSelectOrder?: (order: Order) => void;
  selectedOrderId?: string;
  filterStatus?: string;
  filterType?: string;
  filterPaymentStatus?: string;
  search?: string;
  showFilters?: boolean;
  className?: string;
}

export const OrderList: React.FC<OrderListProps> = ({
  onSelectOrder,
  selectedOrderId,
  filterStatus: initialStatus = 'ALL',
  filterType: initialType = 'ALL',
  filterPaymentStatus: initialPaymentStatus = 'ALL',
  search: externalSearch = '',
  showFilters = true,
  className = '',
}) => {
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState(externalSearch);
  const [selectedStatus, setSelectedStatus] = useState<string>(initialStatus);
  const [selectedType, setSelectedType] = useState<string>(initialType);
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState<string>(initialPaymentStatus);

  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  // Infinite Scroll query: 50 orders per page, auto-resets on filter/search changes
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery({
    queryKey: [
      'orders-list',
      selectedStatus,
      selectedType,
      selectedPaymentStatus,
      searchQuery,
    ],
    queryFn: ({ pageParam = 1 }) =>
      orderApi.getOrdersPaginated({
        page: pageParam,
        limit: 50,
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        orderType: selectedType !== 'ALL' ? selectedType : undefined,
        paymentStatus: selectedPaymentStatus !== 'ALL' ? selectedPaymentStatus : undefined,
        search: searchQuery.trim() || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const orders = useMemo(() => {
    return data?.pages.flatMap((page) => page.data) || [];
  }, [data]);

  const totalCount = data?.pages[0]?.totalCount ?? 0;

  // Real-time WebSocket updates: Prepend newly created orders to query cache
  useEffect(() => {
    const token = localStorage.getItem('auth_token') || 'pos-token';
    const socket = socketClient.connect(token);
    if (!socket) return;

    const handleNewOrder = (incoming: any) => {
      queryClient.setQueriesData({ queryKey: ['orders-list'] }, (oldData: any) => {
        if (!oldData || !oldData.pages || oldData.pages.length === 0) return oldData;
        const exists = oldData.pages.some((page: any) =>
          page.data.some((o: Order) => o.id === incoming.id)
        );
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
    };

    const handleUpdatedOrder = (incoming: any) => {
      queryClient.setQueriesData({ queryKey: ['orders-list'] }, (oldData: any) => {
        if (!oldData || !oldData.pages) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page: any) => ({
            ...page,
            data: page.data.map((o: Order) => (o.id === incoming.id ? { ...o, ...incoming } : o)),
          })),
        };
      });
    };

    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleUpdatedOrder);

    return () => {
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleUpdatedOrder);
    };
  }, [queryClient]);

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'paid':
      case 'served':
      case 'completed':
        return <span className="badge badge-served">✓ {status.toUpperCase()}</span>;
      case 'ready':
        return <span className="badge badge-ready">🍽️ READY</span>;
      case 'preparing':
      case 'in_progress':
        return <span className="badge badge-open">⏳ PREPARING</span>;
      case 'cancelled':
        return <span className="badge badge-cancelled">✕ CANCELLED</span>;
      default:
        return <span className="badge badge-open">{status.toUpperCase()}</span>;
    }
  };

  const getOrderTypeIcon = (type: string) => {
    switch (type) {
      case 'DINE_IN':
        return '🍽️';
      case 'TAKE_AWAY':
        return '🛍️';
      case 'DELIVERY':
        return '🛵';
      default:
        return '🧾';
    }
  };

  return (
    <div className={`order-list-container ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {showFilters && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="🔍 Search orders by #, customer, phone, or items..."
              className="input-field"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => refetch()} title="Reload orders">
              🔄
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            {/* Order Type Filter */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Type:</span>
              {(['ALL', 'DINE_IN', 'TAKE_AWAY', 'DELIVERY'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-sm ${selectedType === t ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => setSelectedType(t)}
                >
                  {t === 'ALL' ? 'All' : t === 'DINE_IN' ? '🍽️ Dine In' : t === 'TAKE_AWAY' ? '🛍️ Take Away' : '🛵 Delivery'}
                </button>
              ))}
            </div>

            {/* Payment Status Filter */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Payment:</span>
              {(['ALL', 'PAID', 'UNPAID'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn btn-sm ${selectedPaymentStatus === p ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => setSelectedPaymentStatus(p)}
                >
                  {p === 'ALL' ? 'All' : p === 'PAID' ? '🟢 Paid' : '⏳ Unpaid'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Orders List / Cards */}
      <div className="order-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isLoading && orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading order history...
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🧾</div>
            <div style={{ fontWeight: 600 }}>No orders found</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Matching orders will appear here.</div>
          </div>
        ) : (
          orders.map((order) => {
            const customerRef =
              order.customerName ||
              order.dineInTag ||
              order.deliveryAddress ||
              order.orderTypeLabel ||
              'Direct Order';
            const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
            const isSelected = selectedOrderId === order.id;

            return (
              <div
                key={order.id}
                onClick={() => onSelectOrder?.(order)}
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-secondary)',
                  border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                  cursor: onSelectOrder ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 4px 12px rgba(99, 102, 241, 0.2)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>{getOrderTypeIcon(order.orderType)}</span>
                    <span style={{ fontWeight: 800, fontSize: '15px' }}>#{order.orderNumber}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      • {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {getStatusBadge(order.status)}
                    <span
                      className={`badge ${order.paymentStatus === 'PAID' ? 'badge-ready' : 'badge-open'}`}
                      style={{
                        background: order.paymentStatus === 'PAID' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: order.paymentStatus === 'PAID' ? '#34d399' : '#fbbf24',
                      }}
                    >
                      {order.paymentStatus === 'PAID' ? 'PAID' : 'UNPAID'}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {customerRef}
                  {order.customerPhone && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      ({order.customerPhone})
                    </span>
                  )}
                </div>

                {/* Items preview */}
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {order.items.slice(0, 3).map((item) => (
                    <span key={item.id} style={{ marginRight: '8px' }}>
                      {item.quantity}x {item.name}
                    </span>
                  ))}
                  {order.items.length > 3 && (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      +{order.items.length - 3} more
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid var(--border-color)', marginTop: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 900, color: '#34d399' }}>
                    {formatPKR(order.total)}
                  </span>
                </div>
              </div>
            );
          })
        )}

        <InfiniteScrollSentinel
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          totalCount={totalCount}
          currentCount={orders.length}
          emptyText="No orders found"
        />
      </div>
    </div>
  );
};

export default OrderList;
