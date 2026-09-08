import React, { useState, useEffect } from 'react';
import { inventoryApi, InventoryItem as PosInventoryItem, InventoryTransaction as PosTransaction } from '../api/inventory.api';
import { formatPKR } from '../utils/format';

export const InventoryPage: React.FC = () => {
  const [inventory, setInventory] = useState<PosInventoryItem[]>([]);
  const [transactions, setTransactions] = useState<PosTransaction[]>([]);
  const [loading, setLoading] = useState(false);
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

  const loadInventory = async () => {
    setLoading(true);
    try {
      const items = await inventoryApi.getInventory();
      setInventory(items);
    } catch (err) {
      console.warn('Failed to load inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, []);

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

  const openHistoryModal = async (item: PosInventoryItem) => {
    setSelectedItem(item);
    setHistoryModalOpen(true);
    try {
      const txs = await inventoryApi.getTransactions(item.id);
      setTransactions(txs);
    } catch (err) {
      console.warn('Failed to load item transactions:', err);
    }
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
      await loadInventory();
    } catch (err) {
      // Optimistic update
      const newQty = Math.max(0, selectedItem.quantity + delta);
      setInventory((prev) =>
        prev.map((item) =>
          item.id === selectedItem.id
            ? {
                ...item,
                quantity: newQty,
                lastRestocked: adjustType === 'RESTOCK' ? new Date().toISOString().split('T')[0] : item.lastRestocked,
              }
            : item
        )
      );
    }

    const newTx: PosTransaction = {
      id: `tx-${Date.now()}`,
      itemName: selectedItem.name,
      quantity: adjustAmount,
      type: adjustType,
      reason: adjustReason || `Manual ${adjustType.toLowerCase()} entry`,
      createdAt: new Date().toISOString(),
    };

    setTransactions((prev) => [newTx, ...prev]);
    setAdjustModalOpen(false);
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name) return;

    try {
      const created = await inventoryApi.createInventoryItem({
        ...newItem,
        sku: newItem.sku || `SKU-${Date.now().toString().slice(-4)}`,
      });
      if (created) {
        setInventory((prev) => [...prev, created]);
      } else {
        await loadInventory();
      }
    } catch (err) {
      console.warn('Fallback adding inventory item:', err);
      const created: PosInventoryItem = {
        id: `inv-${Date.now()}`,
        ...newItem,
        lastRestocked: new Date().toISOString().split('T')[0],
      };
      setInventory((prev) => [...prev, created]);
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
      setInventory((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setInventory((prev) => prev.filter((i) => i.id !== id));
    }
  };

  const filteredInventory = inventory.filter((item) => {
    const matchesCategory = categoryFilter === 'All' || item.category.toLowerCase() === categoryFilter.toLowerCase();
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

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
            <div className="stat-val">{inventory.length}</div>
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
          📋 Stock Catalog ({filteredInventory.length} Items)
        </h3>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading stock catalog from database...
          </div>
        ) : filteredInventory.length === 0 ? (
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
                {filteredInventory.map((item) => {
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
                            title="Adjust stock quantity"
                          >
                            ⚡ Adjust
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => openHistoryModal(item)}
                            title="View transaction history"
                          >
                            📜 History
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleDeleteItem(item.id, item.name)}
                            style={{ color: '#f87171' }}
                            title="Delete item"
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
      </div>

      {/* Adjust Stock Modal */}
      {adjustModalOpen && selectedItem && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '440px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '4px' }}>⚡ Adjust Stock Level</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
              Updating <strong>{selectedItem.name}</strong> (Current: {selectedItem.quantity} {selectedItem.unit})
            </p>

            <form onSubmit={handleApplyAdjustment}>
              <div style={{ marginBottom: '12px' }}>
                <label className="input-label">Adjustment Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {(['RESTOCK', 'USAGE', 'WASTE', 'ADJUSTMENT'] as const).map((t) => (
                    <button
                      type="button"
                      key={t}
                      className={`btn btn-sm ${adjustType === t ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setAdjustType(t)}
                    >
                      {t === 'RESTOCK' ? '📦 Restock (+)' : t === 'USAGE' ? '🍽️ Usage (-)' : t === 'WASTE' ? '🗑️ Spoilage (-)' : '⚖️ Correction'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label className="input-label">Quantity ({selectedItem.unit})</label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  required
                  className="input-field"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(Number(e.target.value))}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label className="input-label">Reason / Reference Note</label>
                <input
                  type="text"
                  placeholder="e.g. Vendor PO #409, kitchen usage, damaged bag"
                  className="input-field"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setAdjustModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Apply Stock Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Item Modal */}
      {addModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '500px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>+ Add Inventory Item</h3>
            <form onSubmit={handleAddNewItem}>
              <div style={{ marginBottom: '12px' }}>
                <label className="input-label">Item Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Premium Angus Beef Patties"
                  className="input-field"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="input-label">SKU / Barcode</label>
                  <input
                    type="text"
                    placeholder="e.g. BEEF-001"
                    className="input-field"
                    value={newItem.sku}
                    onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
                  />
                </div>
                <div>
                  <label className="input-label">Category</label>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="input-label">Initial Quantity</label>
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
                <div>
                  <label className="input-label">Unit of Measure</label>
                  <input
                    type="text"
                    placeholder="e.g. lbs, kg, pcs, cans, liters"
                    className="input-field"
                    value={newItem.unit}
                    onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label className="input-label">Reorder Threshold</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="input-field"
                    value={newItem.reorderPoint}
                    onChange={(e) => setNewItem({ ...newItem, reorderPoint: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="input-label">Cost per Unit (PKR)</label>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Item to Catalog
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction History Modal */}
      {historyModalOpen && selectedItem && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '600px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 800 }}>📜 Stock Movement Audit</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{selectedItem.name} ({selectedItem.sku})</p>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setHistoryModalOpen(false)}>
                ✕ Close
              </button>
            </div>

            <div className="data-table-wrapper" style={{ maxHeight: '350px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Type</th>
                    <th>Qty</th>
                    <th>Reason / Order</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        No transaction history logged for this item yet.
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
                        <td style={{ fontWeight: 800 }}>
                          {tx.type === 'USAGE' || tx.type === 'WASTE' ? `-${tx.quantity}` : `+${tx.quantity}`}
                        </td>
                        <td style={{ fontSize: '12px' }}>{tx.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryPage;
