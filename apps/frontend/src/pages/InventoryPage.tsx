import React, { useState, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, InventoryItem as PosInventoryItem, InventoryTransaction as PosTransaction } from '../api/inventory.api';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { formatPKR } from '../utils/format';
import { socketClient } from '../lib/socket';

export const InventoryPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Modals
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PosInventoryItem | null>(null);

  // Adjustment Form
  const [adjustType, setAdjustType] = useState<'RESTOCK' | 'USAGE' | 'WASTE' | 'ADJUSTMENT'>('RESTOCK');
  const [adjustAmount, setAdjustAmount] = useState<number>(10);
  const [adjustReason, setAdjustReason] = useState<string>('');

  // Add Item Form
  const [newItem, setNewItem] = useState({
    name: '',
    sku: '',
    category: 'Grocery',
    quantity: 10,
    unit: 'lbs',
    reorderPoint: 5,
    costPerUnit: 250,
  });

  // 1. Infinite Query for Inventory Items: 50 records per page, auto-resets on filter/search change
  const {
    data: inventoryData,
    fetchNextPage: fetchNextInventory,
    hasNextPage: hasNextInventory,
    isFetchingNextPage: isFetchingNextInventory,
    isLoading: loadingInventory,
  } = useInfiniteQuery({
    queryKey: ['inventory', categoryFilter, searchQuery],
    queryFn: ({ pageParam = 1 }) =>
      inventoryApi.getInventoryPaginated({
        page: pageParam,
        limit: 50,
        category: categoryFilter !== 'All' ? categoryFilter : undefined,
        search: searchQuery.trim() || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const inventory = useMemo(() => {
    return inventoryData?.pages.flatMap((p) => p.data) || [];
  }, [inventoryData]);

  const totalInventoryCount = inventoryData?.pages[0]?.totalCount ?? 0;

  // 2. Infinite Query for Item Transaction History (50 per batch)
  const {
    data: txData,
    fetchNextPage: fetchNextTransactions,
    hasNextPage: hasNextTransactions,
    isFetchingNextPage: isFetchingNextTransactions,
  } = useInfiniteQuery({
    queryKey: ['inventory-transactions', selectedItem?.id],
    queryFn: ({ pageParam = 1 }) =>
      inventoryApi.getTransactionsPaginated(selectedItem?.id, {
        page: pageParam,
        limit: 50,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    enabled: Boolean(historyModalOpen && selectedItem?.id),
  });

  const transactions = useMemo(() => {
    return txData?.pages.flatMap((p) => p.data) || [];
  }, [txData]);

  const totalTxCount = txData?.pages[0]?.totalCount ?? 0;

  // Real-time WebSocket sync: update stock quantities without full reloads
  useEffect(() => {
    const token = localStorage.getItem('auth_token') || 'pos-token';
    const socket = socketClient.connect(token);
    if (!socket) return;

    const handleInventoryUpdate = (data: any) => {
      console.log('⚡ Real-time inventory sync received:', data);
      if (data?.id) {
        queryClient.setQueriesData({ queryKey: ['inventory'] }, (oldData: any) => {
          if (!oldData || !oldData.pages) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => ({
              ...page,
              data: page.data.map((item: PosInventoryItem) =>
                item.id === data.id
                  ? { ...item, quantity: Number(data.quantity) }
                  : item
              ),
            })),
          };
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      }
    };

    const handleOrderNew = () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    };

    socket.on('inventory:updated', handleInventoryUpdate);
    socket.on('order:new', handleOrderNew);

    return () => {
      socket.off('inventory:updated', handleInventoryUpdate);
      socket.off('order:new', handleOrderNew);
    };
  }, [queryClient]);

  const lowStockItems = inventory.filter((item) => item.quantity <= item.reorderPoint);
  const totalValuation = inventory.reduce((sum, item) => sum + item.quantity * item.costPerUnit, 0);

  const categories = ['All', 'Meat', 'Dairy', 'Bakery', 'Frozen', 'Grocery', 'Beverage'];

  const openAdjustModal = (item: PosInventoryItem) => {
    setSelectedItem(item);
    setAdjustType('RESTOCK');
    setAdjustAmount(10);
    setAdjustReason('');
    setAdjustModalOpen(true);
  };

  const openHistoryModal = (item: PosInventoryItem) => {
    setSelectedItem(item);
    setHistoryModalOpen(true);
  };

  const handleApplyAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || adjustAmount <= 0) return;

    let delta = adjustAmount;
    if (adjustType === 'USAGE' || adjustType === 'WASTE') {
      delta = -adjustAmount;
    }

    try {
      await inventoryApi.adjustStock(
        selectedItem.id,
        delta,
        adjustReason || `Manual ${adjustType.toLowerCase()} entry`
      );
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions', selectedItem.id] });
    } catch (err) {
      console.warn('Stock adjustment API error:', err);
    }

    setAdjustModalOpen(false);
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name) return;

    try {
      await inventoryApi.createInventoryItem({
        ...newItem,
        sku: newItem.sku || `SKU-${Date.now().toString().slice(-4)}`,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      console.warn('Fallback adding inventory item:', err);
    }

    setAddModalOpen(false);
    setNewItem({
      name: '',
      sku: '',
      category: 'Grocery',
      quantity: 10,
      unit: 'lbs',
      reorderPoint: 5,
      costPerUnit: 250,
    });
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove "${name}" from inventory?`)) return;
    try {
      await inventoryApi.deleteInventoryItem(id);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      console.warn('Delete inventory item error:', err);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>📦 Inventory & Stock Control (PKR)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database stock levels, unit valuations, automated reorder thresholds, and adjustment audit logs
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => setAddModalOpen(true)}>
          + Add Inventory Item
        </button>
      </div>

      {/* Top Stat Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
            📦
          </div>
          <div>
            <div className="stat-val">{totalInventoryCount || inventory.length}</div>
            <div className="stat-label">Stocked SKUs</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' }}>
            ⚠️
          </div>
          <div>
            <div className="stat-val" style={{ color: lowStockItems.length > 0 ? '#f87171' : 'var(--text-primary)' }}>
              {lowStockItems.length}
            </div>
            <div className="stat-label">Low Stock Alerts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            💰
          </div>
          <div>
            <div className="stat-val" style={{ color: '#34d399' }}>{formatPKR(totalValuation)}</div>
            <div className="stat-label">Total Inventory Valuation</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            📋
          </div>
          <div>
            <div className="stat-val">{categories.length - 1}</div>
            <div className="stat-label">Stock Categories</div>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '12px', flex: 1, minWidth: '280px' }}>
            <input
              type="text"
              placeholder="🔍 Search items by name or SKU..."
              className="input-field"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
            {categories.map((c) => (
              <button
                key={c}
                className={`btn btn-sm ${categoryFilter === c ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setCategoryFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="card">
        <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
          📋 Stock Catalog ({totalInventoryCount || inventory.length} Items)
        </h3>

        {loadingInventory && inventory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading stock catalog from database...
          </div>
        ) : inventory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No inventory items found.
          </div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item Name & SKU</th>
                  <th>Category</th>
                  <th>Current Stock</th>
                  <th>Reorder Point</th>
                  <th>Cost / Unit</th>
                  <th>Stock Valuation</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => {
                  const isLow = item.quantity <= item.reorderPoint;
                  const itemValuation = item.quantity * item.costPerUnit;

                  return (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 800 }}>{item.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.sku}</div>
                      </td>
                      <td>
                        <span className="badge badge-open">{item.category}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 800, fontSize: '15px', color: isLow ? '#f87171' : 'var(--text-primary)' }}>
                          {item.quantity} {item.unit}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {item.reorderPoint} {item.unit}
                      </td>
                      <td style={{ fontWeight: 700 }}>{formatPKR(item.costPerUnit)}</td>
                      <td style={{ fontWeight: 800, color: '#34d399' }}>{formatPKR(itemValuation)}</td>
                      <td>
                        {isLow ? (
                          <span className="badge badge-cancelled">⚠️ Low Stock</span>
                        ) : (
                          <span className="badge badge-served">🟢 Healthy</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => openAdjustModal(item)}
                            title="Adjust inventory quantity"
                          >
                            ⚡ Adjust
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => openHistoryModal(item)}
                            title="View transaction movement history"
                          >
                            📜 History
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteItem(item.id, item.name)}
                            title="Delete item from inventory"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <InfiniteScrollSentinel
          hasNextPage={hasNextInventory}
          isFetchingNextPage={isFetchingNextInventory}
          fetchNextPage={fetchNextInventory}
          totalCount={totalInventoryCount}
          currentCount={inventory.length}
          emptyText="No inventory items found"
        />
      </div>

      {/* Adjust Stock Modal */}
      {adjustModalOpen && selectedItem && (
        <div className="modal-backdrop" onClick={() => setAdjustModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">⚡ Adjust Inventory Stock</h3>
                <p className="modal-subtitle">
                  {selectedItem.name} • Current Quantity: <strong>{selectedItem.quantity} {selectedItem.unit}</strong>
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAdjustModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleApplyAdjustment}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="input-label">
                    <span>Adjustment Type</span>
                    <span className="label-hint">Select action</span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {[
                      { type: 'RESTOCK', label: 'Restock', icon: '📥' },
                      { type: 'USAGE', label: 'Usage', icon: '🍳' },
                      { type: 'WASTE', label: 'Waste', icon: '🗑️' },
                      { type: 'ADJUSTMENT', label: 'Count', icon: '⚖️' },
                    ].map((btn) => (
                      <button
                        key={btn.type}
                        type="button"
                        className={`btn btn-sm ${adjustType === btn.type ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setAdjustType(btn.type as any)}
                        style={{ flexDirection: 'column', padding: '10px 4px', fontSize: '12px' }}
                      >
                        <span style={{ fontSize: '18px' }}>{btn.icon}</span>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="input-label">
                    <span>Quantity Change ({selectedItem.unit})</span>
                    <span className="label-hint">Amount</span>
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    required
                    className="input-field"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(Number(e.target.value))}
                    style={{ fontSize: '18px', fontWeight: 800 }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">
                    <span>Reason / Reference Note</span>
                    <span className="label-hint">Optional</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Supplier delivery, spoilage, or discrepancy fix..."
                    className="input-field"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setAdjustModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  ✓ Apply Stock Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Inventory Item Modal */}
      {addModalOpen && (
        <div className="modal-backdrop" onClick={() => setAddModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">+ Add New Inventory Item</h3>
                <p className="modal-subtitle">Track ingredients, beverages, and supplies in the database catalog</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAddModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddNewItem}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="input-label">
                    <span>Item Name</span>
                    <span className="label-hint">Required</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Premium Angus Beef Patties"
                    className="input-field"
                    value={newItem.name}
                    onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="input-label">
                      <span>SKU / Barcode</span>
                      <span className="label-hint">Auto or custom</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. BEEF-001"
                      className="input-field"
                      value={newItem.sku}
                      onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="input-label">
                      <span>Category</span>
                      <span className="label-hint">Department</span>
                    </label>
                    <select
                      className="input-field"
                      value={newItem.category}
                      onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    >
                      <option value="Meat">Meat</option>
                      <option value="Dairy">Dairy</option>
                      <option value="Bakery">Bakery</option>
                      <option value="Frozen">Frozen</option>
                      <option value="Grocery">Grocery</option>
                      <option value="Beverage">Beverage</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="input-label">
                      <span>Initial Quantity</span>
                      <span className="label-hint">In stock now</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      className="input-field"
                      value={newItem.quantity}
                      onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="input-label">
                      <span>Unit of Measure</span>
                      <span className="label-hint">lbs, kg, pcs</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. lbs, kg, pcs, cans"
                      className="input-field"
                      value={newItem.unit}
                      onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: 0 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">
                      <span>Reorder Point</span>
                      <span className="label-hint">Low stock alert</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      className="input-field"
                      value={newItem.reorderPoint}
                      onChange={(e) => setNewItem({ ...newItem, reorderPoint: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">
                      <span>Cost per Unit (PKR)</span>
                      <span className="label-hint">Valuation</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      className="input-field"
                      value={newItem.costPerUnit}
                      onChange={(e) => setNewItem({ ...newItem, costPerUnit: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  ✓ Save Item to Catalog
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction History Modal */}
      {historyModalOpen && selectedItem && (
        <div className="modal-backdrop" onClick={() => setHistoryModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">📜 Stock Movement Audit</h3>
                <p className="modal-subtitle">
                  {selectedItem.name} • SKU: {selectedItem.sku} • In Stock: {selectedItem.quantity} {selectedItem.unit}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setHistoryModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: 0 }}>
              <div className="data-table-wrapper" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Type</th>
                      <th>Qty Change</th>
                      <th>Reason / Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                          No stock movement history logged for this item yet.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {new Date(tx.createdAt).toLocaleString()}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                tx.type === 'RESTOCK' ? 'badge-served' : tx.type === 'WASTE' ? 'badge-cancelled' : 'badge-open'
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td style={{ fontWeight: 800, color: tx.type === 'RESTOCK' ? '#34d399' : '#f87171' }}>
                            {tx.type === 'USAGE' || tx.type === 'WASTE' ? `-${tx.quantity}` : `+${tx.quantity}`} {selectedItem.unit}
                          </td>
                          <td style={{ fontSize: '12px' }}>{tx.reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                <InfiniteScrollSentinel
                  hasNextPage={hasNextTransactions}
                  isFetchingNextPage={isFetchingNextTransactions}
                  fetchNextPage={fetchNextTransactions}
                  totalCount={totalTxCount}
                  currentCount={transactions.length}
                  emptyText=""
                />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setHistoryModalOpen(false)}>
                Close Audit Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryPage;
