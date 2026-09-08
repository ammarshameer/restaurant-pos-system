import React from 'react';
import { Order, OrderStatus } from '../types/order.types';
import { formatPKR } from '../utils/format';

interface OrderListProps {
  orders: Order[];
  onSelectOrder: (order: Order) => void;
  selectedOrderId?: string;
}

export const OrderList: React.FC<OrderListProps> = ({
  orders,
  onSelectOrder,
  selectedOrderId,
}) => {
  const getStatusColor = (status: OrderStatus): string => {
    const colors = {
      OPEN: '#3b82f6',
      IN_PROGRESS: '#f59e0b',
      READY: '#10b981',
      COMPLETED: '#6b7280',
      CANCELLED: '#ef4444',
    };
    return colors[status] || '#6b7280';
  };

  const formatTime = (date: Date): string => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="order-list">
      {orders.length === 0 ? (
        <div className="empty-state">
          <p>No active orders</p>
        </div>
      ) : (
        orders.map((order) => (
          <div
            key={order.id}
            onClick={() => onSelectOrder(order)}
            className={`order-card ${
              selectedOrderId === order.id ? 'selected' : ''
            }`}
          >
            <div className="order-header">
              <div className="order-info">
                <h4>Table {order.table.number}</h4>
                <span className="order-time">{formatTime(order.createdAt)}</span>
              </div>
              <span
                className="order-status"
                style={{ backgroundColor: getStatusColor(order.status) }}
              >
                {order.status}
              </span>
            </div>

            <div className="order-items">
              {order.items.slice(0, 3).map((item) => (
                <div key={item.id} className="order-item-summary">
                  <span className="item-qty">{item.quantity}x</span>
                  <span className="item-name">{item.menuItem.name}</span>
                  <span className="item-status">{item.status}</span>
                </div>
              ))}
              {order.items.length > 3 && (
                <div className="more-items">
                  +{order.items.length - 3} more items
                </div>
              )}
            </div>

            <div className="order-footer">
              <span className="item-count">
                {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
              </span>
              <span className="order-total">
                {formatPKR(
                  order.items.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
                )}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
