import React, { useState, useEffect } from 'react';
import {
  costingApi,
  CostingSummary,
  MenuCostItem,
  InventoryValuationResponse,
  CostingTransactionItem,
} from '../api/costing.api';
import { formatPKR } from '../utils/format';

export const CostingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'menu' | 'inventory' | 'transactions'>('overview');
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<CostingSummary | null>(null);
  const [menuItems, setMenuItems] = useState<MenuCostItem[]>([]);
  const [inventoryVal, setInventoryVal] = useState<InventoryValuationResponse | null>(null);
  const [transactions, setTransactions] = useState<CostingTransactionItem[]>([]);
  const [transPage, setTransPage] = useState(1);
  const [transTotal, setTransTotal] = useState(0);

  useEffect(() => {
    const now = new Date();
    if (dateRange === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (dateRange === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(now.toISOString().split('T')[0]);
    } else if (dateRange === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(now.toISOString().split('T')[0]);
    } else {
      setStartDate('');
      setEndDate('');
    }
  }, [dateRange]);

  useEffect(() => {
    loadData();
  }, [activeTab, startDate, endDate, transPage]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'overview') {
        const res = await costingApi.summary(startDate || undefined, endDate || undefined);
        setSummary(res);
      } else if (activeTab === 'menu') {
        const res = await costingApi.menu();
        setMenuItems(res);
      } else if (activeTab === 'inventory') {
        const res = await costingApi.inventory();
        setInventoryVal(res);
      } else if (activeTab === 'transactions') {
        const res = await costingApi.transactions({
          page: transPage,
          limit: 20,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setTransactions(res.data);
        setTransTotal(res.totalCount);
      }
    } catch (err) {
      console.error('Failed to load costing data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getMarginBadge = (marginPercent: number) => {
    if (marginPercent >= 65) {
      return (
        <span
          className="badge"
          style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', fontWeight: 700 }}
        >
          {marginPercent.toFixed(1)}% High
        </span>
      );
    }
    if (marginPercent >= 45) {
      return (
        <span
          className="badge"
          style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontWeight: 700 }}
        >
          {marginPercent.toFixed(1)}% Healthy
        </span>
      );
    }
    return (
      <span
        className="badge"
        style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', fontWeight: 700 }}
      >
        {marginPercent.toFixed(1)}% Low
      </span>
    );
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>💰 Recipe Costing & Food Margins</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Real-time COGS, recipe ingredient analysis, inventory valuation, and dish profitability
          </p>
        </div>

        {/* Date Filter */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(['today', '7d', '30d', 'all'] as const).map((r) => (
            <button
              key={r}
              className={`btn btn-sm ${dateRange === r ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDateRange(r)}
            >
              {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 Days' : r === '30d' ? 'Last 30 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '20px' }}>
        <button
          className={`btn ${activeTab === 'overview' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => setActiveTab('overview')}
        >
          📊 Costing Overview
        </button>
        <button
          className={`btn ${activeTab === 'menu' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => setActiveTab('menu')}
        >
          🍽️ Menu Recipe Costing
        </button>
        <button
          className={`btn ${activeTab === 'inventory' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => setActiveTab('inventory')}
        >
          📦 Inventory Valuation
        </button>
        <button
          className={`btn ${activeTab === 'transactions' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => setActiveTab('transactions')}
        >
          🧾 Order Margins
        </button>
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && summary && (
        <div>
          <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                💵
              </div>
              <div>
                <div className="stat-val">{formatPKR(summary.netSales)}</div>
                <div className="stat-label">Net Revenue</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                📉
              </div>
              <div>
                <div className="stat-val" style={{ color: '#f87171' }}>{formatPKR(summary.cogs)}</div>
                <div className="stat-label">Food Cost (COGS)</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                📈
              </div>
              <div>
                <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(summary.grossProfit)}</div>
                <div className="stat-label">Gross Profit</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(var(--primary-rgb), 0.15)', color: 'var(--primary)' }}>
                🎯
              </div>
              <div>
                <div className="stat-val">{summary.grossMarginPercent.toFixed(1)}%</div>
                <div className="stat-label">Gross Margin %</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>Sales & Cost Breakdown</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Gross Sales</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(summary.grossSales)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Discounts Given</span>
                  <span style={{ color: '#f87171', fontWeight: 600 }}>- {formatPKR(summary.discounts)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Refunds</span>
                  <span style={{ color: '#f87171', fontWeight: 600 }}>- {formatPKR(summary.refunds)}</span>
                </div>
                <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700 }}>
                  <span>Net Sales</span>
                  <span style={{ color: '#38bdf8' }}>{formatPKR(summary.netSales)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Food Cost %</span>
                  <span style={{ fontWeight: 700, color: summary.foodCostPercent > 35 ? '#f87171' : '#34d399' }}>
                    {summary.foodCostPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>Operational Metrics</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Total Orders</span>
                  <span style={{ fontWeight: 600 }}>{summary.transactionCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Average Ticket Size</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(summary.averageTicket)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Tax Collected</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(summary.tax)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Service Charges</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(summary.serviceCharge)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Delivery Charges</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(summary.deliveryCharge)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MENU COSTING TAB */}
      {activeTab === 'menu' && (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Menu Dish</th>
                <th>Category</th>
                <th>Selling Price</th>
                <th>Recipe Cost</th>
                <th>Profit Margin</th>
                <th>Food Cost %</th>
                <th>Margin %</th>
                <th>Ingredients</th>
              </tr>
            </thead>
            <tbody>
              {menuItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    No menu items found. Add items and recipes to calculate costs.
                  </td>
                </tr>
              ) : (
                menuItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 700 }}>{item.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{item.categoryName}</td>
                    <td style={{ fontWeight: 700 }}>{formatPKR(item.price)}</td>
                    <td style={{ color: '#f87171' }}>{formatPKR(item.recipeCost)}</td>
                    <td style={{ color: '#34d399', fontWeight: 700 }}>{formatPKR(item.margin)}</td>
                    <td>{item.costPercent.toFixed(1)}%</td>
                    <td>{getMarginBadge(item.marginPercent)}</td>
                    <td>
                      <span className="badge badge-secondary">
                        {item.ingredientsCount} {item.ingredientsCount === 1 ? 'ingredient' : 'ingredients'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* INVENTORY VALUATION TAB */}
      {activeTab === 'inventory' && inventoryVal && (
        <div>
          <div className="grid-cols-3" style={{ marginBottom: '20px' }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                📦
              </div>
              <div>
                <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(inventoryVal.totalInventoryValue)}</div>
                <div className="stat-label">Total Inventory Asset Value</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                ⚠️
              </div>
              <div>
                <div className="stat-val" style={{ color: '#f87171' }}>{inventoryVal.lowStockCount}</div>
                <div className="stat-label">Low Stock Alerts</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                📋
              </div>
              <div>
                <div className="stat-val">{inventoryVal.totalItemsCount}</div>
                <div className="stat-label">Tracked Stock Items</div>
              </div>
            </div>
          </div>

          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Category</th>
                  <th>Stock on Hand</th>
                  <th>Cost / Unit</th>
                  <th>Total Valuation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {inventoryVal.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 700 }}>{item.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{item.category || '-'}</td>
                    <td>
                      {item.quantity} {item.unit}
                    </td>
                    <td>{formatPKR(item.costPerUnit)} / {item.unit}</td>
                    <td style={{ fontWeight: 700, color: '#34d399' }}>{formatPKR(item.stockValue)}</td>
                    <td>
                      {item.isLowStock ? (
                        <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
                          ⚠️ Low Stock
                        </span>
                      ) : (
                        <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399' }}>
                          ✓ In Stock
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TRANSACTIONS TAB */}
      {activeTab === 'transactions' && (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Order Revenue</th>
                <th>COGS (Cost)</th>
                <th>Net Margin</th>
                <th>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    No order transactions found for this period.
                  </td>
                </tr>
              ) : (
                transactions.map((tr) => (
                  <tr key={tr.id}>
                    <td style={{ fontWeight: 800 }}>#{tr.orderNumber}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(tr.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-secondary">{tr.orderType}</span>
                    </td>
                    <td>{tr.customerName || 'Direct Customer'}</td>
                    <td>{tr.itemCount}</td>
                    <td style={{ fontWeight: 700 }}>{formatPKR(tr.total)}</td>
                    <td style={{ color: '#f87171' }}>{formatPKR(tr.cogs)}</td>
                    <td style={{ color: '#34d399', fontWeight: 700 }}>{formatPKR(tr.margin)}</td>
                    <td>{getMarginBadge(tr.marginPercent)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CostingPage;
