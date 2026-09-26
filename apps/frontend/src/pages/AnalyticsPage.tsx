import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useInfiniteQuery } from '@tanstack/react-query';
import { RootState } from '../store/store';
import { setOrders } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { analyticsApi, TopSellingItem } from '../api/analytics.api';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { formatPKR, formatNumber } from '../utils/format';

type DateRange = 'today' | 'yesterday' | 'week' | 'month';

interface HourlyData {
  hour: string;
  revenue: number;
  orders: number;
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

  // 1. Infinite Query for Top Selling Items: 50 records per page
  const {
    data: topItemsData,
    fetchNextPage: fetchNextTopItems,
    hasNextPage: hasNextTopItems,
    isFetchingNextPage: isFetchingNextTopItems,
    isLoading: loadingTopItems,
  } = useInfiniteQuery({
    queryKey: ['analytics-top-items', dateRangeBounds.start.toISOString(), dateRangeBounds.end.toISOString()],
    queryFn: ({ pageParam = 1 }) =>
      analyticsApi.getTopSellingItemsPaginated({
        startDate: dateRangeBounds.start,
        endDate: dateRangeBounds.end,
        page: pageParam,
        limit: 50,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const topSellingItems: TopSellingItem[] = useMemo(() => {
    const list = topItemsData?.pages.flatMap((p) => p.data) || [];
    return list.map((item, index) => ({
      ...item,
      rank: item.rank || index + 1,
    }));
  }, [topItemsData]);

  const totalTopItemsCount = topItemsData?.pages[0]?.totalCount ?? 0;

  // Order Type Performance Breakdown (Dine In vs Take Away vs Delivery)
  const orderTypePerformance: OrderTypeStat[] = useMemo(() => {
    const configs: Array<{ typeKey: 'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY'; type: string; icon: string; color: string }> = [
      { typeKey: 'DINE_IN', type: 'Dine In', icon: '🍽️', color: '#6366f1' },
      { typeKey: 'TAKE_AWAY', type: 'Take Away', icon: '🛍️', color: '#38bdf8' },
      { typeKey: 'DELIVERY', type: 'Delivery', icon: '🛵', color: '#10b981' },
    ];

    return configs.map(({ typeKey, type, icon, color }) => {
      const matchedOrders = filteredOrders.filter((o) => o.orderType === typeKey);
      const revenue = matchedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const count = matchedOrders.length;
      return {
        type,
        icon,
        orderCount: count,
        revenue: +revenue.toFixed(2),
        avgTicket: count > 0 ? +(revenue / count).toFixed(2) : 0,
        color,
      };
    });
  }, [filteredOrders]);

  return (
    <div className="page-container">
      {/* Header & Date Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>📊 Sales Analytics & Financials (PKR)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database sales figures, menu engineering, hourly rush heatmaps, and profit margins
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: 'Last 7 Days' },
            { id: 'month', label: 'This Month' },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`btn btn-sm ${dateRange === tab.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDateRange(tab.id as DateRange)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '28px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(totalSales)}</div>
            <div className="stat-label">Total Gross Revenue</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
            🧾
          </div>
          <div>
            <div className="stat-val">{totalOrders}</div>
            <div className="stat-label">Total Orders Placed</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            🎯
          </div>
          <div>
            <div className="stat-val">{formatPKR(avgOrderValue)}</div>
            <div className="stat-label">Average Order Size</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            📈
          </div>
          <div>
            <div className="stat-val" style={{ color: netMargin >= 0 ? '#34d399' : '#f87171' }}>
              {formatPKR(netMargin)}
            </div>
            <div className="stat-label">Estimated Net Margin</div>
          </div>
        </div>
      </div>

      {/* Financial Health Summary Bar */}
      <div className="card" style={{ marginBottom: '28px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>
          💵 Margin & Cost Breakdown (PKR)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Gross Sales Volume</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#34d399', marginTop: '4px' }}>
              {formatPKR(totalSales)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>100% of revenue</div>
          </div>

          <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Estimated Food Cost (COGS)</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#f87171', marginTop: '4px' }}>
              {formatPKR(estimatedFoodCost)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {totalSales > 0 ? ((estimatedFoodCost / totalSales) * 100).toFixed(1) : 0}% of sales
            </div>
          </div>

          <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Estimated Labor Overhead</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#fbbf24', marginTop: '4px' }}>
              {formatPKR(estimatedLaborCost)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {totalSales > 0 ? ((estimatedLaborCost / totalSales) * 100).toFixed(1) : 0}% of sales
            </div>
          </div>

          <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Net Operational Margin</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#38bdf8', marginTop: '4px' }}>
              {formatPKR(netMargin)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {totalSales > 0 ? ((netMargin / totalSales) * 100).toFixed(1) : 0}% net profit
            </div>
          </div>
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
            🏆 Top Selling Menu Items ({totalTopItemsCount || topSellingItems.length})
          </h3>

          <div className="data-table-wrapper" style={{ maxHeight: '420px', overflowY: 'auto' }}>
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
                {loadingTopItems && topSellingItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      Loading top selling items...
                    </td>
                  </tr>
                ) : topSellingItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No items sold in this date range
                    </td>
                  </tr>
                ) : (
                  topSellingItems.map((item) => (
                    <tr key={item.id || item.name}>
                      <td>
                        <div style={{ fontWeight: 700 }}>
                          <span style={{ color: item.rank && item.rank <= 3 ? '#fbbf24' : 'var(--text-muted)', marginRight: '6px' }}>
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

            <InfiniteScrollSentinel
              hasNextPage={hasNextTopItems}
              isFetchingNextPage={isFetchingNextTopItems}
              fetchNextPage={fetchNextTopItems}
              totalCount={totalTopItemsCount}
              currentCount={topSellingItems.length}
              emptyText=""
            />
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
