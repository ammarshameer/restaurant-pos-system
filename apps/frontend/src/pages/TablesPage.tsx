import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { tableApi } from '../api/table.api';
import { formatPKR } from '../utils/format';

interface PosTable {
  id: string;
  number: string;
  capacity: number;
  shape: 'SQUARE' | 'RECTANGLE' | 'CIRCLE' | 'BOOTH';
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'DIRTY' | 'CLEANING';
  x: number;
  y: number;
  serverName?: string;
  activeOrderTotal?: number;
}

export const TablesPage: React.FC = () => {
  const navigate = useNavigate();
  const [tables, setTables] = useState<PosTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<PosTable | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newTable, setNewTable] = useState({
    number: '',
    capacity: 4,
    shape: 'SQUARE' as const,
  });

  const loadTables = async () => {
    setLoading(true);
    try {
      const data: any = await tableApi.getTables();
      if (Array.isArray(data)) {
        setTables(
          data.map((t: any) => ({
            id: t.id,
            number: String(t.number),
            capacity: Number(t.capacity || 4),
            shape: (t.shape || 'SQUARE') as any,
            status: (t.status || 'AVAILABLE') as any,
            x: Number(t.x || 40),
            y: Number(t.y || 40),
            serverName: t.serverName,
            activeOrderTotal: t.activeOrderTotal,
          }))
        );
      }
    } catch (err) {
      console.warn('Failed to load tables:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  const totalTables = tables.length;
  const occupiedCount = tables.filter((t) => t.status === 'OCCUPIED').length;
  const availableCount = tables.filter((t) => t.status === 'AVAILABLE').length;
  const dirtyCount = tables.filter((t) => t.status === 'DIRTY').length;
  const occupancyRate = totalTables > 0 ? Math.round((occupiedCount / totalTables) * 100) : 0;

  const handleStatusChange = async (tableId: string, newStatus: PosTable['status']) => {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, status: newStatus } : t))
    );
    if (selectedTable?.id === tableId) {
      setSelectedTable((prev) => (prev ? { ...prev, status: newStatus } : null));
    }

    try {
      await tableApi.updateTableStatus(tableId, newStatus as any);
    } catch (err) {
      console.warn('Failed to persist table status update:', err);
    }
  };

  const handleAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTable.number) return;

    try {
      const created: any = await tableApi.createTable({
        number: newTable.number,
        capacity: newTable.capacity,
        shape: newTable.shape as any,
        status: 'AVAILABLE' as any,
        x: 100 + (tables.length % 5) * 60,
        y: 100 + Math.floor(tables.length / 5) * 60,
      });

      if (created) {
        setTables((prev) => [
          ...prev,
          {
            id: created.id,
            number: String(created.number),
            capacity: Number(created.capacity || 4),
            shape: (created.shape || 'SQUARE') as any,
            status: (created.status || 'AVAILABLE') as any,
            x: Number(created.x || 100),
            y: Number(created.y || 100),
          },
        ]);
      } else {
        await loadTables();
      }
    } catch (err) {
      const fallback: PosTable = {
        id: `t-${Date.now()}`,
        number: newTable.number,
        capacity: newTable.capacity,
        shape: newTable.shape,
        status: 'AVAILABLE',
        x: 100 + (tables.length % 5) * 60,
        y: 100 + Math.floor(tables.length / 5) * 60,
      };
      setTables((prev) => [...prev, fallback]);
    }

    setAddModalOpen(false);
    setNewTable({ number: '', capacity: 4, shape: 'SQUARE' });
  };

  const getStatusColor = (status: PosTable['status']) => {
    switch (status) {
      case 'AVAILABLE': return '#10b981';
      case 'OCCUPIED': return '#ef4444';
      case 'DIRTY': return '#f59e0b';
      case 'RESERVED': return '#38bdf8';
      case 'CLEANING': return '#a855f7';
    }
  };

  return (
    <div className="page-container">
      {/* Top Controls & Metrics */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>🪑 Floor Plan & Table Management</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Live database dining room layout, table seating, and server assignments
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className={`btn ${isEditMode ? 'btn-warning' : 'btn-secondary'}`}
            onClick={() => setIsEditMode(!isEditMode)}
          >
            {isEditMode ? '✓ Done Editing Layout' : '📐 Edit Layout Positions'}
          </button>
          <button className="btn btn-primary" onClick={() => setAddModalOpen(true)}>
            + Add Table
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)' }}>
            🪑
          </div>
          <div>
            <div className="stat-val">{totalTables}</div>
            <div className="stat-label">Total Tables</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
            🟢
          </div>
          <div>
            <div className="stat-val">{availableCount}</div>
            <div className="stat-label">Available</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' }}>
            🔴
          </div>
          <div>
            <div className="stat-val">{occupiedCount}</div>
            <div className="stat-label">Occupied ({occupancyRate}%)</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            🧹
          </div>
          <div>
            <div className="stat-val" style={{ color: dirtyCount > 0 ? '#fbbf24' : 'var(--text-primary)' }}>
              {dirtyCount}
            </div>
            <div className="stat-label">Needs Busser / Cleaning</div>
          </div>
        </div>
      </div>

      {/* Main Floor & Detail Panel Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', alignItems: 'start' }}>
        {/* Floor Canvas */}
        <div
          className="card"
          style={{
            minHeight: '480px',
            position: 'relative',
            background: '#0d1322',
            border: '2px dashed var(--border-color)',
            overflow: 'auto',
            padding: '24px',
          }}
        >
          <div style={{ position: 'absolute', top: '12px', left: '16px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
            📍 MAIN DINING ROOM FLOOR LAYOUT
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '100px 20px', color: 'var(--text-muted)' }}>
              Loading floor plan tables from database...
            </div>
          ) : tables.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '100px 20px', color: 'var(--text-muted)' }}>
              No tables set up yet. Click <strong>+ Add Table</strong> to create your first table.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '30px' }}>
              {tables.map((table) => {
                const color = getStatusColor(table.status);
                const isSelected = selectedTable?.id === table.id;

                const shapeStyle: React.CSSProperties =
                  table.shape === 'CIRCLE'
                    ? { borderRadius: '50%', width: '100px', height: '100px' }
                    : table.shape === 'BOOTH'
                    ? { borderRadius: '8px', width: '130px', height: '110px', borderLeft: '6px solid var(--primary)' }
                    : table.shape === 'RECTANGLE'
                    ? { borderRadius: '8px', width: '140px', height: '90px' }
                    : { borderRadius: '8px', width: '110px', height: '110px' };

                return (
                  <div
                    key={table.id}
                    onClick={() => setSelectedTable(table)}
                    style={{
                      ...shapeStyle,
                      background: isSelected ? 'rgba(99, 102, 241, 0.3)' : 'var(--bg-card)',
                      border: isSelected ? '2px solid var(--primary)' : `2px solid ${color}`,
                      boxShadow: isSelected ? '0 0 16px rgba(99, 102, 241, 0.4)' : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      transition: 'all 0.15s ease',
                      userSelect: 'none',
                      padding: '8px',
                    }}
                  >
                    <span style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)' }}>
                      T-{table.number}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {table.capacity} seats
                    </span>

                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 800,
                        color: color,
                        background: 'rgba(0,0,0,0.5)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        marginTop: '4px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {table.status}
                    </span>

                    {table.activeOrderTotal && (
                      <span style={{ fontSize: '10px', fontWeight: 800, color: '#34d399', marginTop: '2px' }}>
                        {formatPKR(table.activeOrderTotal)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Details Panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 800, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            🪑 Table Inspector
          </h3>

          {!selectedTable ? (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)' }}>
              Select any table on the floor plan to view details, update seating status, or start a POS order.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ fontSize: '20px', fontWeight: 900 }}>Table #{selectedTable.number}</h4>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {selectedTable.shape} • {selectedTable.capacity} Seats
                  </div>
                </div>

                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 800,
                    background: `${getStatusColor(selectedTable.status)}22`,
                    color: getStatusColor(selectedTable.status),
                    border: `1px solid ${getStatusColor(selectedTable.status)}`,
                  }}
                >
                  {selectedTable.status}
                </span>
              </div>

              {selectedTable.serverName && (
                <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Assigned Server</div>
                  <div style={{ fontWeight: 800, fontSize: '14px' }}>{selectedTable.serverName}</div>
                </div>
              )}

              {selectedTable.activeOrderTotal && (
                <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Active Tab Total</div>
                  <div style={{ fontWeight: 900, fontSize: '16px', color: '#34d399' }}>
                    {formatPKR(selectedTable.activeOrderTotal)}
                  </div>
                </div>
              )}

              <div>
                <label className="input-label" style={{ marginBottom: '8px' }}>Update Table Status</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DIRTY', 'CLEANING'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`btn btn-sm ${selectedTable.status === st ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleStatusChange(selectedTable.id, st)}
                      style={{ fontSize: '11px' }}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/pos?table=${selectedTable.number}`)}
                style={{ marginTop: '8px', padding: '12px', fontWeight: 800 }}
              >
                🍽️ Open POS Terminal for Table {selectedTable.number}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Table Modal */}
      {addModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '420px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>+ Add New Floor Table</h3>
            <form onSubmit={handleAddTable}>
              <div style={{ marginBottom: '12px' }}>
                <label className="input-label">Table Number / Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 7, 8, Patio 2, B4"
                  className="input-field"
                  value={newTable.number}
                  onChange={(e) => setNewTable({ ...newTable, number: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label className="input-label">Seating Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    required
                    className="input-field"
                    value={newTable.capacity}
                    onChange={(e) => setNewTable({ ...newTable, capacity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="input-label">Table Shape</label>
                  <select
                    className="input-field"
                    value={newTable.shape}
                    onChange={(e) => setNewTable({ ...newTable, shape: e.target.value as any })}
                  >
                    <option value="SQUARE">Square</option>
                    <option value="RECTANGLE">Rectangle</option>
                    <option value="CIRCLE">Round / Circle</option>
                    <option value="BOOTH">Booth</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Table to Floor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TablesPage;
