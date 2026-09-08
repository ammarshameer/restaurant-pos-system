import React, { useState, useEffect } from 'react';
import { orderApi } from '../api/order.api';
import { socketClient } from '../lib/socket';

interface KdsItem {
  id: string;
  name: string;
  quantity: number;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';
  notes?: string;
}

interface KdsOrder {
  id: string;
  orderNumber: number;
  orderType: string;
  orderTypeIcon: string;
  customerRef?: string;
  serverName: string;
  createdAt: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'READY' | 'COMPLETED';
  items: KdsItem[];
}

export const KitchenPage: React.FC = () => {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'PREPARING' | 'READY'>('ALL');

  const fetchKitchenOrders = async () => {
    setLoading(true);
    try {
      const dbOrders = await orderApi.getAllOrders();
      if (Array.isArray(dbOrders)) {
        const kdsOrders: KdsOrder[] = dbOrders
          .filter((o) => o.status !== 'served' && o.status !== 'cancelled')
          .map((o) => {
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
              serverName: o.server ? `${o.server.firstName || ''} ${o.server.lastName || ''}`.trim() || 'Staff' : 'Staff',
              createdAt: o.createdAt || new Date().toISOString(),
              status: o.status === 'ready' ? 'READY' : o.status === 'preparing' ? 'IN_PROGRESS' : 'OPEN',
              items: (o.items || []).map((i, idx) => ({
                id: i.id || `kds-i-${idx}`,
                name: i.name,
                quantity: i.quantity,
                status: o.status === 'ready' ? 'READY' : o.status === 'preparing' ? 'PREPARING' : 'PENDING',
                notes: i.notes,
              })),
            };
          });
        setOrders(kdsOrders);
      }
    } catch (err) {
      console.warn('Failed to load kitchen orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKitchenOrders();

    const socket = socketClient.getSocket();
    if (socket) {
      socket.emit('kitchen:join');

      socket.on('kitchen:order:new', (order: any) => {
        const typeStr =
          order.orderTypeLabel ||
          (order.orderType === 'TAKE_AWAY'
            ? 'Take Away'
            : order.orderType === 'DELIVERY'
            ? 'Delivery'
            : 'Dine In');
        const icon =
          order.orderType === 'TAKE_AWAY'
            ? '🛍️'
            : order.orderType === 'DELIVERY'
            ? '🛵'
            : '🍽️';

        const ref =
          order.customerName ||
          order.deliveryAddress ||
          order.dineInTag ||
          typeStr;

        const formatted: KdsOrder = {
          id: order.id,
          orderNumber: order.orderNumber || Math.floor(Math.random() * 900) + 100,
          orderType: typeStr,
          orderTypeIcon: icon,
          customerRef: `${typeStr} (${ref})`,
          serverName: order.server ? `${order.server.firstName} ${order.server.lastName}` : 'Cashier',
          createdAt: order.createdAt || new Date().toISOString(),
          status: 'OPEN',
          items:
            order.items?.map((item: any) => ({
              id: item.id,
              name: item.menuItem?.name || item.name || 'Dish',
              quantity: item.quantity,
              status: item.status || 'PENDING',
              notes: item.specialInstructions || item.notes,
            })) || [],
        };
        setOrders((prev) => [formatted, ...prev]);
      });
    }

    return () => {
      socket?.off('kitchen:order:new');
    };
  }, []);

  const handleUpdateItemStatus = (
    orderId: string,
    itemId: string,
    newStatus: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED'
  ) => {
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id === orderId) {
          const updatedItems = order.items.map((i) =>
            i.id === itemId ? { ...i, status: newStatus } : i
          );
          const allReady = updatedItems.every(
            (i) => i.status === 'READY' || i.status === 'SERVED'
          );
          const somePrep = updatedItems.some(
            (i) => i.status === 'PREPARING' || i.status === 'READY'
          );

          return {
            ...order,
            items: updatedItems,
            status: allReady ? 'READY' : somePrep ? 'IN_PROGRESS' : 'OPEN',
          };
        }
        return order;
      })
    );
  };

  const handleMarkAllOrder = async (
    orderId: string,
    newStatus: 'PREPARING' | 'READY' | 'COMPLETED'
  ) => {
    if (newStatus === 'COMPLETED') {
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      await orderApi.updateOrderStatus(orderId, 'served');
    } else {
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id === orderId) {
            const mappedItemStatus =
              newStatus === 'READY' ? 'READY' : 'PREPARING';
            return {
              ...order,
              status: newStatus === 'READY' ? 'READY' : 'IN_PROGRESS',
              items: order.items.map((i) => ({ ...i, status: mappedItemStatus })),
            };
          }
          return order;
        })
      );
      await orderApi.updateOrderStatus(orderId, newStatus === 'READY' ? 'ready' : 'preparing');
    }
  };

  const getElapsedTime = (createdAt: string) => {
    const diffMs = Date.now() - new Date(createdAt).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    return `${mins}m ago`;
  };

  const isOrderLate = (createdAt: string) => {
    const diffMs = Date.now() - new Date(createdAt).getTime();
    return diffMs > 15 * 60000;
  };

  const filteredOrders = orders.filter((order) => {
    if (filter === 'ALL') return true;
    if (filter === 'PENDING') return order.status === 'OPEN';
    if (filter === 'PREPARING') return order.status === 'IN_PROGRESS';
    if (filter === 'READY') return order.status === 'READY';
    return true;
  });

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>🍳 Kitchen Display System (KDS)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live kitchen ticket queue, real-time item status routing, and station throughput
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="btn btn-sm btn-secondary" onClick={fetchKitchenOrders}>
            🔄 Refresh Tickets
          </button>
          <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            {(['ALL', 'PENDING', 'PREPARING', 'READY'] as const).map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ticket Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          Loading active tickets from database...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🍽️</div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Kitchen is All Clear!</h3>
          <p style={{ fontSize: '13px', marginTop: '4px' }}>No active food orders in the queue right now.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredOrders.map((order) => {
            const late = isOrderLate(order.createdAt);

            return (
              <div
                key={order.id}
                className="card"
                style={{
                  borderTop: `4px solid ${
                    order.status === 'READY'
                      ? 'var(--success)'
                      : order.status === 'IN_PROGRESS'
                      ? 'var(--primary)'
                      : late
                      ? 'var(--danger)'
                      : 'var(--warning)'
                  }`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {/* Card Top */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '18px' }}>{order.orderTypeIcon}</span>
                      <span style={{ fontSize: '20px', fontWeight: 900 }}>#{order.orderNumber}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {order.customerRef}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: '9999px',
                        background: late ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-secondary)',
                        color: late ? '#f87171' : 'var(--text-secondary)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      ⏱️ {getElapsedTime(order.createdAt)}
                    </span>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Server: {order.serverName}
                    </div>
                  </div>
                </div>

                {/* Items List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md)',
                        background:
                          item.status === 'READY'
                            ? 'rgba(16, 185, 129, 0.1)'
                            : item.status === 'PREPARING'
                            ? 'rgba(99, 102, 241, 0.1)'
                            : 'var(--bg-secondary)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '14px' }}>
                          <span style={{ color: 'var(--primary)', marginRight: '6px' }}>{item.quantity}x</span>
                          {item.name}
                        </div>
                        {item.notes && (
                          <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600, marginTop: '2px' }}>
                            ⚠️ {item.notes}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '4px' }}>
                        {item.status === 'PENDING' && (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleUpdateItemStatus(order.id, item.id, 'PREPARING')}
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            🍳 Prep
                          </button>
                        )}
                        {item.status === 'PREPARING' && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleUpdateItemStatus(order.id, item.id, 'READY')}
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            ✅ Ready
                          </button>
                        )}
                        {item.status === 'READY' && (
                          <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--success)' }}>
                            Done
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Card Actions */}
                <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                  {order.status !== 'IN_PROGRESS' && order.status !== 'READY' && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleMarkAllOrder(order.id, 'PREPARING')}
                      style={{ flex: 1 }}
                    >
                      Start All
                    </button>
                  )}
                  {order.status !== 'READY' && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleMarkAllOrder(order.id, 'READY')}
                      style={{ flex: 1 }}
                    >
                      Mark Order Ready
                    </button>
                  )}
                  {order.status === 'READY' && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleMarkAllOrder(order.id, 'COMPLETED')}
                      style={{ flex: 1, background: 'var(--success)' }}
                    >
                      🍽️ Serve / Complete Ticket
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KitchenPage;
