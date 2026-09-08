import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store/store';
import { Order, setOrders } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { formatPKR, formatNumber } from '../utils/format';

type DateRange = 'today' | 'yesterday' | 'week' | 'month';

interface HourlyData {
  hour: string;
  revenue: number;
  orders: number;
}

interface TopItem {
  rank: number;
  name: string;
  category: string;
  quantity: number;
  revenue: number;
}

interface OrderTypeStat {
  type: string;
  icon: string;
  orderCount: number;
  revenue: number;
  avgTicket: number;
  color: string;
}

export const AnalyticsPage: React.FC = () => {
  const dispatch = useDispatch();
  const orders = useSelector((state: RootState) => state.orders.orders);
  const menuItems = useSelector((state: RootState) => state.menu.items);

  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [loading, setLoading] = useState(false);

  // Fetch latest orders directly from backend database on mount
  useEffect(() => {
    const fetchLatestOrders = async () => {
      setLoading(true);
      try {
        const dbOrders = await orderApi.getAllOrders();
        if (dbOrders && dbOrders.length > 0) {
          dispatch(setOrders(dbOrders));
        }
      } catch (err) {
        console.warn('Failed to fetch DB orders for analytics:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLatestOrders();
  }, [dispatch]);

  // Compute date boundary for selected range
  const dateRangeBounds = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (dateRange === 'today') {
      return { start: startOfToday, end: endOfToday };
    }

    if (dateRange === 'yesterday') {
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      return { start: startOfYesterday, end: endOfYesterday };
    }

    if (dateRange === 'week') {
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start: startOfWeek, end: endOfToday };
    }

    // month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start: startOfMonth, end: endOfToday };
  }, [dateRange]);

  // Filter orders matching current date range
  const filteredOrders = useMemo(() => {
    const { start, end } = dateRangeBounds;
    return orders.filter((order) => {
      if (order.status === 'cancelled') return false;
      const orderDate = new Date(order.createdAt);
      return orderDate >= start && orderDate <= end;
    });
  }, [orders, dateRangeBounds]);

  // KPI Calculations
  const totalSales = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  }, [filteredOrders]);

  const totalOrders = filteredOrders.length;
  const avgOrderValue = totalOrders > 0 ? +(totalSales / totalOrders).toFixed(2) : 0;

  // Food cost calculated from menu item cost records or fallback 28%
  const estimatedFoodCost = useMemo(() => {
    let foodCostSum = 0;
    filteredOrders.forEach((o) => {
      (o.items || []).forEach((item) => {
        const menuItem = menuItems.find((m) => m.id === item.menuItemId || m.name.toLowerCase() === item.name.toLowerCase());
        if (menuItem && menuItem.cost) {
          foodCostSum += menuItem.cost * (item.quantity || 1);
        } else {
          foodCostSum += (item.unitPrice || item.price || 0) * (item.quantity || 1) * 0.28;
        }
      });
    });
    return +(foodCostSum > 0 ? foodCostSum : totalSales * 0.28).toFixed(2);
  }, [filteredOrders, menuItems, totalSales]);

  // Labor cost estimated proportionally to sales volume for timeframe
  const estimatedLaborCost = useMemo(() => {
    if (totalSales === 0) return 0;
    if (dateRange === 'today') return +(totalSales * 0.22).toFixed(2);
    if (dateRange === 'yesterday') return +(totalSales * 0.22).toFixed(2);
    if (dateRange === 'week') return +(totalSales * 0.20).toFixed(2);
    return +(totalSales * 0.18).toFixed(2);
  }, [totalSales, dateRange]);

  const netMargin = +(totalSales - estimatedFoodCost - estimatedLaborCost).toFixed(2);

  // Hourly Sales & Rush Hour Throughput (computed dynamically from filtered orders)
  const hourlySalesData: HourlyData[] = useMemo(() => {
    const hours = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    const buckets: Record<string, { revenue: number; orders: number }> = {};
    hours.forEach((h) => {
      buckets[h] = { revenue: 0, orders: 0 };
    });

    filteredOrders.forEach((order) => {
      const orderHour = new Date(order.createdAt).getHours();
      const hourKey = `${orderHour.toString().padStart(2, '0')}:00`;
      if (buckets[hourKey]) {
        buckets[hourKey].revenue += Number(order.total) || 0;
        buckets[hourKey].orders += 1;
      }
    });

    return hours.map((hour) => ({
      hour,
      revenue: +buckets[hour].revenue.toFixed(2),
      orders: buckets[hour].orders,
    }));
  }, [filteredOrders]);

  const maxHourlyRevenue = Math.max(...hourlySalesData.map((h) => h.revenue), 1);

  // Top Selling Items (computed dynamically from line items of filtered orders)
  const topSellingItems: TopItem[] = useMemo(() => {
    const itemMap = new Map<string, { name: string; category: string; quantity: number; revenue: number }>();

    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const menuItem = menuItems.find((m) => m.id === item.menuItemId || m.name.toLowerCase() === item.name.toLowerCase());
        const key = item.menuItemId || item.name;
        const name = item.name;
        const category = menuItem?.category || 'Mains';
        const qty = Number(item.quantity || 1);
        const price = Number(item.unitPrice || item.price || 0);
        const revenue = price * qty;

        const existing = itemMap.get(key);
        if (existing) {
          existing.quantity += qty;
          existing.revenue += revenue;
        } else {
          itemMap.set(key, { name, category, quantity: qty, revenue });
        }
      });
    });

    return Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)
      .map((item, index) => ({
        rank: index + 1,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        revenue: +item.revenue.toFixed(2),
      }));
  }, [filteredOrders, menuItems]);

  // Order Type Performance Breakdown (Dine In vs Take Away vs Delivery)
  const orderTypePerformance: OrderTypeStat[] = useMemo(() => {
    const configs: Array<{ typeKey: 'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY'; type: string; icon: string; color: string }> = [
      { typeKey: 'DINE_IN', type: 'Dine In', icon: '🍽️', color: '#6366f1' },
      { typeKey: 'TAKE_AWAY', type: 'Take Away', icon: '🛍️', color: '#38bdf8' },
      { typeKey: 'DELIVERY', type: 'Delivery', icon: '🛵', color: '#10b981' },
    ];

    return configs.map(({ typeKey, type, icon, color }) => {
      const typeOrders = filteredOrders.filter((o) => o.orderType === typeKey);
      const revenue = typeOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const orderCount = typeOrders.length;
      const avgTicket = orderCount > 0 ? +(revenue / orderCount).toFixed(2) : 0;

      return {
        type,
        icon,
        orderCount,
        revenue: +revenue.toFixed(2),
        avgTicket,
        color,
      };
    });
  }, [filteredOrders]);

  const totalOrderTypeRevenue = orderTypePerformance.reduce((s, o) => s + o.revenue, 0);
  const totalOrderTypeCount = orderTypePerformance.reduce((s, o) => s + o.orderCount, 0);

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>📊 Analytics & Performance Reports (PKR)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database sales revenue, order type throughput, and dish rankings
          </p>
        </div>

        {/* Date Range Selector */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          {(['today', 'yesterday', 'week', 'month'] as const).map((r) => (
            <button
              key={r}
              className={`btn btn-sm ${dateRange === r ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDateRange(r)}
              style={{ textTransform: 'capitalize' }}
            >
              {r === 'week' ? 'Last 7 Days' : r === 'month' ? 'This Month' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(totalSales)}</div>
            <div className="stat-label">Gross Sales ({dateRange === 'week' ? '7 Days' : dateRange === 'month' ? 'This Month' : dateRange})</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
            🧾
          </div>
          <div>
            <div className="stat-val">{formatNumber(totalOrders)}</div>
            <div className="stat-label">Completed Orders</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            🎯
          </div>
          <div>
            <div className="stat-val">{formatPKR(avgOrderValue)}</div>
            <div className="stat-label">Average Ticket Size</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            📈
          </div>
          <div>
            <div className="stat-val" style={{ color: '#fbbf24' }}>{formatPKR(netMargin)}</div>
            <div className="stat-label">Est. Net Profit (PKR)</div>
          </div>
        </div>
      </div>

      {/* ORDER TYPE BREAKDOWN CARDS */}
      <div style={{ marginBottom: '28px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px' }}>
          🛵 Order Type Performance & Volume Breakdown
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {orderTypePerformance.map((item) => {
            const revenueShare = totalOrderTypeRevenue > 0 ? ((item.revenue / totalOrderTypeRevenue) * 100).toFixed(1) : '0.0';
            const orderShare = totalOrderTypeCount > 0 ? ((item.orderCount / totalOrderTypeCount) * 100).toFixed(1) : '0.0';
            return (
              <div
                key={item.type}
                className="card"
                style={{
                  borderTop: `4px solid ${item.color}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '24px' }}>{item.icon}</span>
                    <span style={{ fontSize: '18px', fontWeight: 800 }}>{item.type}</span>
                  </div>
                  <span
                    style={{
                      background: 'var(--bg-secondary)',
                      padding: '4px 10px',
                      borderRadius: '9999px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: item.color,
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    {revenueShare}% Revenue
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
                  <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Total Orders</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {item.orderCount} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({orderShare}%)</span>
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg Ticket</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#38bdf8' }}>
                      {formatPKR(item.avgTicket)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Revenue:</span>
                  <span style={{ fontSize: '18px', fontWeight: 900, color: '#34d399' }}>{formatPKR(item.revenue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hourly Sales Visual Chart */}
      <div className="card" style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 800 }}>
            📈 Hourly Sales & Rush Hour Throughput (PKR)
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Showing activity for selected period ({dateRange})
          </span>
        </div>

        {totalOrders === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
            <p>No orders recorded in database for this date range.</p>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '12px',
              height: '220px',
              paddingTop: '20px',
              borderBottom: '1px solid var(--border-color)',
              overflowX: 'auto',
            }}
          >
            {hourlySalesData.map((h) => {
              const heightPercent = maxHourlyRevenue > 0 ? Math.max(Math.round((h.revenue / maxHourlyRevenue) * 100), h.revenue > 0 ? 8 : 2) : 2;
              return (
                <div
                  key={h.hour}
                  style={{
                    flex: 1,
                    minWidth: '55px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    height: '100%',
                    justifyContent: 'flex-end',
                  }}
                >
                  <div style={{ fontSize: '10px', fontWeight: 700, color: h.revenue > 0 ? 'var(--text-primary)' : 'var(--text-muted)', marginBottom: '6px' }}>
                    {h.revenue > 0 ? formatNumber(Math.round(h.revenue)) : '-'}
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: `${heightPercent}%`,
                      background: h.revenue > 0 ? 'linear-gradient(180deg, #6366f1 0%, #3b82f6 100%)' : 'var(--bg-secondary)',
                      borderRadius: '6px 6px 0 0',
                      transition: 'height 0.3s ease',
                      boxShadow: h.revenue > 0 ? '0 0 12px rgba(99, 102, 241, 0.3)' : 'none',
                    }}
                    title={`${h.hour}: ${formatPKR(h.revenue)} (${h.orders} orders)`}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {h.hour}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid: Top Selling Items and Detailed Order Type Summary Table */}
      <div className="grid-cols-2">
        {/* Top Selling Items */}
        <div className="card">
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
            🏆 Top Selling Menu Items ({topSellingItems.length})
          </h3>

          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank & Dish</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th style={{ textAlign: 'right' }}>Total Revenue (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {topSellingItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No items sold in this date range
                    </td>
                  </tr>
                ) : (
                  topSellingItems.map((item) => (
                    <tr key={item.rank + item.name}>
                      <td>
                        <div style={{ fontWeight: 700 }}>
                          <span style={{ color: item.rank <= 3 ? '#fbbf24' : 'var(--text-muted)', marginRight: '6px' }}>
                            #{item.rank}
                          </span>
                          {item.name}
                        </div>
                      </td>
                      <td><span className="badge badge-open">{item.category}</span></td>
                      <td style={{ fontWeight: 800 }}>{item.quantity} sold</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#38bdf8' }}>
                        {formatPKR(item.revenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Order Type Detailed Summary Table */}
        <div className="card">
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
            📋 Order Type Detailed Breakdown
          </h3>

          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order Type</th>
                  <th>Completed Orders</th>
                  <th>Avg Ticket</th>
                  <th style={{ textAlign: 'right' }}>Revenue (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {orderTypePerformance.map((o) => (
                  <tr key={o.type}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                        <span>{o.icon}</span>
                        <span>{o.type}</span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>{o.orderCount} orders</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatPKR(o.avgTicket)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: '#34d399' }}>
                      {formatPKR(o.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;
