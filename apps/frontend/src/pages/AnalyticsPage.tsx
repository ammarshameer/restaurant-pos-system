import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useInfiniteQuery } from '@tanstack/react-query';
import { RootState } from '../store/store';
import { setOrders } from '../store/slices/orderSlice';
import { orderApi } from '../api/order.api';
import { analyticsApi, TopSellingItem, ProductRevenueItem } from '../api/analytics.api';
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
  const deals = useSelector((state: RootState) => state.deal.deals);

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

  // Commercial Revenue Streams (Deals vs Standalone Menu Items)
  const { dealRevenue, standaloneRevenue, dealsCount, standaloneCount } = useMemo(() => {
    let dRev = 0;
    let sRev = 0;
    let dCount = 0;
    let sCount = 0;

    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const matchedDeal = deals.find(
          (d) => d.id === item.dealId || d.name.toLowerCase() === (item.name || '').toLowerCase()
        );
        const isDealItem = Boolean(item.dealId || item.isDeal || matchedDeal);
        const price = Number(item.unitPrice || item.price || matchedDeal?.price || 0);
        const lineRev = price * itemQty;

        if (isDealItem) {
          dRev += lineRev;
          dCount += itemQty;
        } else {
          sRev += lineRev;
          sCount += itemQty;
        }
      });
    });

    return {
      dealRevenue: +dRev.toFixed(2),
      standaloneRevenue: +sRev.toFixed(2),
      dealsCount: dCount,
      standaloneCount: sCount,
    };
  }, [filteredOrders, deals]);

  // Food cost calculated from menu item cost records or fallback 28%
  const estimatedFoodCost = useMemo(() => {
    let foodCostSum = 0;
    filteredOrders.forEach((o) => {
      (o.items || []).forEach((item) => {
        if (item.dealId) {
          const deal = deals.find((d) => d.id === item.dealId);
          if (deal && deal.items && deal.items.length > 0) {
            let dealCost = 0;
            deal.items.forEach((di) => {
              const m = menuItems.find((mi) => mi.id === di.menuItemId);
              dealCost += (m?.cost || (m?.price ? m.price * 0.28 : 0)) * (di.quantity || 1);
            });
            foodCostSum += dealCost * (item.quantity || 1);
            return;
          }
        }
        const menuItem = menuItems.find((m) => m.id === item.menuItemId || m.name.toLowerCase() === (item.name || '').toLowerCase());
        if (menuItem && menuItem.cost) {
          foodCostSum += menuItem.cost * (item.quantity || 1);
        } else {
          foodCostSum += (item.unitPrice || item.price || 0) * (item.quantity || 1) * 0.28;
        }
      });
    });
    return +(foodCostSum > 0 ? foodCostSum : totalSales * 0.28).toFixed(2);
  }, [filteredOrders, menuItems, deals, totalSales]);

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

  // 1. Infinite Query for Product & Deal Sales Revenue Breakdown
  const {
    data: productRevenueData,
    fetchNextPage: fetchNextProductRevenue,
    hasNextPage: hasNextProductRevenue,
    isFetchingNextPage: isFetchingNextProductRevenue,
    isLoading: loadingProductRevenue,
  } = useInfiniteQuery({
    queryKey: ['analytics-product-revenue', dateRangeBounds.start.toISOString(), dateRangeBounds.end.toISOString()],
    queryFn: ({ pageParam = 1 }) =>
      analyticsApi.getProductRevenuePaginated({
        startDate: dateRangeBounds.start,
        endDate: dateRangeBounds.end,
        page: pageParam,
        limit: 50,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const productRevenueItems: ProductRevenueItem[] = useMemo(() => {
    const list = productRevenueData?.pages.flatMap((p) => p.data) || [];
    return list.map((item, index) => ({
      ...item,
      rank: item.rank || index + 1,
    }));
  }, [productRevenueData]);

  const fallbackProductRevenueItems: ProductRevenueItem[] = useMemo(() => {
    const stats = new Map<string, ProductRevenueItem>();
    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const matchedDeal = deals.find(
          (d) => d.id === item.dealId || d.name.toLowerCase() === (item.name || '').toLowerCase()
        );
        if (item.dealId || item.isDeal || matchedDeal) {
          const dealId = item.dealId || matchedDeal?.id || item.name;
          const dealName = matchedDeal?.name || item.name || 'Combo Deal';
          const unitPrice = Number(item.unitPrice || item.price || matchedDeal?.price || 0);
          const revenue = unitPrice * itemQty;
          const key = `deal:${dealId}`;
          const existing = stats.get(key);
          if (existing) {
            existing.quantity += itemQty;
            existing.revenue += revenue;
            existing.unitPrice = existing.quantity > 0 ? +(existing.revenue / existing.quantity).toFixed(2) : unitPrice;
          } else {
            stats.set(key, {
              id: dealId,
              dealId: matchedDeal?.id || item.dealId || null,
              menuItemId: null,
              name: dealName,
              type: 'DEAL',
              category: 'Combo Deals',
              quantity: itemQty,
              unitPrice: +unitPrice.toFixed(2),
              revenue,
            });
          }
        } else {
          const menuItem = menuItems.find(
            (m) => m.id === item.menuItemId || m.name.toLowerCase() === (item.name || '').toLowerCase()
          );
          const mId = item.menuItemId || menuItem?.id || item.name;
          const mName = menuItem?.name || item.name || 'Dish';
          const catName = typeof menuItem?.category === 'object' ? (menuItem.category as any)?.name : (menuItem?.category || 'General');
          const unitPrice = Number(item.unitPrice || item.price || menuItem?.price || 0);
          const revenue = unitPrice * itemQty;
          const key = `menu:${mId}`;
          const existing = stats.get(key);
          if (existing) {
            existing.quantity += itemQty;
            existing.revenue += revenue;
            existing.unitPrice = existing.quantity > 0 ? +(existing.revenue / existing.quantity).toFixed(2) : unitPrice;
          } else {
            stats.set(key, {
              id: mId,
              dealId: null,
              menuItemId: menuItem?.id || item.menuItemId || null,
              name: mName,
              type: 'MENU_ITEM',
              category: catName,
              quantity: itemQty,
              unitPrice: +unitPrice.toFixed(2),
              revenue,
            });
          }
        }
      });
    });

    return Array.from(stats.values())
      .map((item) => ({ ...item, revenue: +item.revenue.toFixed(2) }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [filteredOrders, deals, menuItems]);

  const displayProductRevenueItems = productRevenueItems.length > 0 ? productRevenueItems : fallbackProductRevenueItems;
  const totalProductItemsCount = productRevenueData?.pages[0]?.totalCount ?? displayProductRevenueItems.length;

  // 2. Infinite Query for Top Selling Items (True Kitchen Consumption View)
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

  const fallbackTopSellingItems: TopSellingItem[] = useMemo(() => {
    const stats = new Map<string, TopSellingItem>();
    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const itemQty = Number(item.quantity) || 1;
        const matchedDeal = deals.find(
          (d) => d.id === item.dealId || d.name.toLowerCase() === (item.name || '').toLowerCase()
        );
        if (item.dealId || item.isDeal || matchedDeal) {
          const dealComponents = matchedDeal?.items || matchedDeal?.dealItems || [];
          dealComponents.forEach((di: any) => {
            const mId = di.menuItemId || di.menuItem?.id;
            if (!mId) return;
            const menuItem = menuItems.find((m) => m.id === mId) || di.menuItem;
            const mName = menuItem?.name || 'Dish';
            const catName = typeof menuItem?.category === 'object' ? (menuItem.category as any)?.name : (menuItem?.category || 'General');
            const compQty = Number(di.quantity || 1) * itemQty;
            const existing = stats.get(mId);
            if (existing) {
              existing.comboQuantity += compQty;
              existing.quantity += compQty;
            } else {
              stats.set(mId, {
                id: mId,
                name: mName,
                category: catName,
                directQuantity: 0,
                comboQuantity: compQty,
                quantity: compQty,
                revenue: 0,
              });
            }
          });
        } else {
          const menuItem = menuItems.find(
            (m) => m.id === item.menuItemId || m.name.toLowerCase() === (item.name || '').toLowerCase()
          );
          const mId = item.menuItemId || menuItem?.id || item.name;
          if (!mId) return;
          const mName = menuItem?.name || item.name || 'Dish';
          const catName = typeof menuItem?.category === 'object' ? (menuItem.category as any)?.name : (menuItem?.category || 'General');
          const unitPrice = Number(item.unitPrice || item.price || menuItem?.price || 0);
          const revenue = unitPrice * itemQty;
          const existing = stats.get(mId);
          if (existing) {
            existing.directQuantity += itemQty;
            existing.quantity += itemQty;
            existing.revenue += revenue;
          } else {
            stats.set(mId, {
              id: mId,
              name: mName,
              category: catName,
              directQuantity: itemQty,
              comboQuantity: 0,
              quantity: itemQty,
              revenue,
            });
          }
        }
      });
    });

    return Array.from(stats.values())
      .map((item) => ({ ...item, revenue: +item.revenue.toFixed(2) }))
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [filteredOrders, deals, menuItems]);

  const displayTopSellingItems = topSellingItems.length > 0 ? topSellingItems : fallbackTopSellingItems;
  const totalTopItemsCount = topItemsData?.pages[0]?.totalCount ?? displayTopSellingItems.length;

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
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>📊 Sales Analytics & Daily Reporting (PKR)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database sales figures, combo deal revenues, true kitchen item consumption, and profit margins
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

      {/* KPI Stat Cards with Deal Revenue vs Standalone Revenue Highlights */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        {/* Card 1: Total Gross Revenue */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(totalSales)}</div>
            <div className="stat-label">Total Gross Revenue ({totalOrders} orders)</div>
          </div>
        </div>

        {/* Card 2: Deal Sales Revenue */}
        <div className="stat-card" style={{ borderLeft: '4px solid #818cf8' }}>
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
            🎁
          </div>
          <div>
            <div className="stat-val" style={{ color: '#818cf8' }}>{formatPKR(dealRevenue)}</div>
            <div className="stat-label">
              Combo Deal Sales ({dealsCount} deals • {totalSales > 0 ? Math.round((dealRevenue / totalSales) * 100) : 0}%)
            </div>
          </div>
        </div>

        {/* Card 3: Standalone Menu Sales Revenue */}
        <div className="stat-card" style={{ borderLeft: '4px solid #38bdf8' }}>
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            🍽️
          </div>
          <div>
            <div className="stat-val" style={{ color: '#38bdf8' }}>{formatPKR(standaloneRevenue)}</div>
            <div className="stat-label">
              Standalone Dishes ({standaloneCount} items • {totalSales > 0 ? Math.round((standaloneRevenue / totalSales) * 100) : 0}%)
            </div>
          </div>
        </div>

        {/* Card 4: Average Order Ticket */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            🎯
          </div>
          <div>
            <div className="stat-val">{formatPKR(avgOrderValue)}</div>
            <div className="stat-label">Average Ticket Size</div>
          </div>
        </div>

        {/* Card 5: Net Margin */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>
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

      {/* Financial Health Summary Bar with Revenue Stream Comparison */}
      <div className="card" style={{ marginBottom: '28px', padding: '22px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>💵</span> Revenue Streams & Operational Cost Breakdown (PKR)
          </h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
            Live Stream Distribution
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {/* Card 1: Combo Deals Revenue */}
          <div
            className="metric-card"
            style={{
              borderTop: '4px solid #818cf8',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>🎁 Combo Deals Revenue</span>
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(129, 140, 248, 0.15)',
                  color: '#818cf8',
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  fontWeight: 800,
                }}
              >
                DEALS
              </span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#818cf8', marginTop: '8px' }}>
              {formatPKR(dealRevenue)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>
              {dealsCount} combos sold ({totalSales > 0 ? ((dealRevenue / totalSales) * 100).toFixed(1) : 0}% of gross)
            </div>
          </div>

          {/* Card 2: Standalone Menu Revenue */}
          <div
            className="metric-card"
            style={{
              borderTop: '4px solid #38bdf8',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>🍽️ Standalone Dishes</span>
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  fontWeight: 800,
                }}
              >
                A LA CARTE
              </span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#38bdf8', marginTop: '8px' }}>
              {formatPKR(standaloneRevenue)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>
              {standaloneCount} items sold ({totalSales > 0 ? ((standaloneRevenue / totalSales) * 100).toFixed(1) : 0}% of gross)
            </div>
          </div>

          {/* Card 3: Food Cost */}
          <div
            className="metric-card"
            style={{
              borderTop: '4px solid #f87171',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>📦 Food Cost (COGS)</span>
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(248, 113, 113, 0.15)',
                  color: '#f87171',
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  fontWeight: 800,
                }}
              >
                COST
              </span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#f87171', marginTop: '8px' }}>
              {formatPKR(estimatedFoodCost)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>
              {totalSales > 0 ? ((estimatedFoodCost / totalSales) * 100).toFixed(1) : 0}% of gross sales
            </div>
          </div>

          {/* Card 4: Net Operational Margin */}
          <div
            className="metric-card"
            style={{
              borderTop: '4px solid #34d399',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>📈 Net Margin</span>
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(52, 211, 153, 0.15)',
                  color: '#34d399',
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  fontWeight: 800,
                }}
              >
                MARGIN
              </span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#34d399', marginTop: '8px' }}>
              {formatPKR(netMargin)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>
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

      {/* DUAL REPORTING SECTIONS: Commercial Revenue vs True Kitchen Consumption */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '24px', marginBottom: '28px' }}>
        {/* VIEW 1: Commercial Sales & Revenue Breakdown (Deals & Standalone Products) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>💰</span> Sales by Product / Deal ({totalProductItemsCount || productRevenueItems.length})
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Commercial Revenue View — Deals appear as single sale items at bundled price
              </p>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 8px',
                background: 'rgba(99, 102, 241, 0.12)',
                color: '#818cf8',
                borderRadius: '6px',
              }}
            >
              Revenue View
            </span>
          </div>

          <div
            style={{
              background: 'rgba(99, 102, 241, 0.06)',
              border: '1px solid rgba(99, 102, 241, 0.18)',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
              lineHeight: 1.4,
            }}
          >
            💡 <strong>Owner Note:</strong> Each deal sold (e.g. <em>Combo</em>) is recorded as 1 sale line item at its actual bundle price. Deals are <strong>not</strong> broken into components here.
          </div>

          <div className="data-table-wrapper" style={{ maxHeight: '440px', overflowY: 'auto', flex: 1 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank & Product</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'center' }}>Sold</th>
                  <th style={{ textAlign: 'right' }}>Revenue (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {loadingProductRevenue && displayProductRevenueItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      Loading sales breakdown...
                    </td>
                  </tr>
                ) : displayProductRevenueItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No product or deal sales recorded in this date range
                    </td>
                  </tr>
                ) : (
                  displayProductRevenueItems.map((item) => (
                    <tr key={item.id || item.name}>
                      <td>
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: item.rank && item.rank <= 3 ? '#fbbf24' : 'var(--text-muted)' }}>
                            #{item.rank}
                          </span>
                          <span>{item.name}</span>
                          {item.type === 'DEAL' && (
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 800,
                                padding: '2px 6px',
                                background: 'rgba(99, 102, 241, 0.2)',
                                color: '#818cf8',
                                borderRadius: '4px',
                                border: '1px solid rgba(99, 102, 241, 0.4)',
                              }}
                            >
                              🎁 DEAL
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${item.type === 'DEAL' ? 'badge-primary' : 'badge-open'}`}>
                          {item.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {formatPKR(item.unitPrice)}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800 }}>
                        {item.quantity}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: item.type === 'DEAL' ? '#818cf8' : '#34d399' }}>
                        {formatPKR(item.revenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <InfiniteScrollSentinel
              hasNextPage={hasNextProductRevenue}
              isFetchingNextPage={isFetchingNextProductRevenue}
              fetchNextPage={fetchNextProductRevenue}
              totalCount={totalProductItemsCount}
              currentCount={displayProductRevenueItems.length}
              emptyText=""
            />
          </div>
        </div>

        {/* VIEW 2: True Kitchen & Stock Consumption View (Direct + Combo Multipliers) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔥</span> Top Consumed Menu Items ({totalTopItemsCount || displayTopSellingItems.length})
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Kitchen & Stock Consumption View — Combines standalone sales + items inside deals
              </p>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 8px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                borderRadius: '6px',
              }}
            >
              Consumption View
            </span>
          </div>

          <div
            style={{
              background: 'rgba(245, 158, 11, 0.06)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
              lineHeight: 1.4,
            }}
          >
            🍳 <strong>Inventory Alignment:</strong> For each menu item, the count includes standalone orders <strong>plus</strong> units consumed inside sold combo deals (<em>component qty × deals sold</em>).
          </div>

          <div className="data-table-wrapper" style={{ maxHeight: '440px', overflowY: 'auto', flex: 1 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank & Dish</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'center' }}>Direct Sales</th>
                  <th style={{ textAlign: 'center' }}>Combo Usage</th>
                  <th style={{ textAlign: 'center' }}>Total Units Used</th>
                  <th style={{ textAlign: 'right' }}>Direct Rev (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {loadingTopItems && displayTopSellingItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      Loading consumed items...
                    </td>
                  </tr>
                ) : displayTopSellingItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No items consumed in this date range
                    </td>
                  </tr>
                ) : (
                  displayTopSellingItems.map((item) => (
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
                      <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {item.directQuantity || 0}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {item.comboQuantity > 0 ? (
                          <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                            +{item.comboQuantity}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 900, color: '#38bdf8' }}>
                        {item.quantity} units
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-secondary)' }}>
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
              currentCount={displayTopSellingItems.length}
              emptyText=""
            />
          </div>
        </div>
      </div>

      {/* Order Type Detailed Summary Table */}
      <div className="card">
        <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
          📋 Channel & Order Type Performance Breakdown
        </h3>

        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order Type</th>
                <th>Completed Orders</th>
                <th>Average Ticket Size</th>
                <th style={{ textAlign: 'right' }}>Total Revenue (PKR)</th>
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
  );
};

export default AnalyticsPage;
