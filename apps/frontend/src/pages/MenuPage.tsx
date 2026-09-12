import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store/store';
import {
  MenuItem,
  setMenuItems,
  addMenuItem,
  updateMenuItem,
  removeMenuItem,
  toggle86Item,
} from '../store/slices/menuSlice';
import { menuApi } from '../api/menu.api';
import { formatPKR } from '../utils/format';
import { compressImageFile, getCategoryVisual } from '../utils/image';

export const MenuPage: React.FC = () => {
  const dispatch = useDispatch();
  const items = useSelector((state: RootState) => state.menu.items);
  const categories = useSelector((state: RootState) => state.menu.categories);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Custom category creation support
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState('');

  // Image Upload State
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [useUrlInput, setUseUrlInput] = useState(false);

  const [formData, setFormData] = useState<{
    name: string;
    category: string;
    price: number;
    cost: number;
    preparationTime: number;
    description: string;
    imageUrl: string;
  }>({
    name: '',
    category: 'Burgers',
    price: 999,
    cost: 350,
    preparationTime: 10,
    description: '',
    imageUrl: '',
  });

  // Sync menu from Database on component mount
  useEffect(() => {
    const fetchDbMenu = async () => {
      const dbItems = await menuApi.getMenu();
      if (dbItems && dbItems.length > 0) {
        dispatch(setMenuItems(dbItems));
      }
    };
    fetchDbMenu();
  }, [dispatch]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleToggle86 = async (item: MenuItem) => {
    dispatch(toggle86Item(item.id));
    await menuApi.updateMenuItem(item.id, {
      is86d: !item.is86d,
      isAvailable: item.is86d,
    });
    showToast(
      item.is86d
        ? `🟢 '${item.name}' marked IN STOCK (saved to DB & available in POS)`
        : `🚫 '${item.name}' marked 86'd (Out of stock saved to DB)`
    );
  };

  const handleDelete = async (item: MenuItem) => {
    if (confirm(`Are you sure you want to remove "${item.name}" from the database menu catalog?`)) {
      dispatch(removeMenuItem(item.id));
      await menuApi.deleteMenuItem(item.id);
      showToast(`🗑️ '${item.name}' deleted from database & menu`);
    }
  };

  const handleProcessImageFile = async (file: File) => {
    if (!file) return;
    try {
      setImageUploading(true);
      setImageError(null);
      const base64Data = await compressImageFile(file, 600, 0.85);
      setFormData((prev) => ({ ...prev, imageUrl: base64Data }));
    } catch (err: any) {
      setImageError(err.message || 'Failed to read image file');
    } finally {
      setImageUploading(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = isNewCategory && customCategory.trim()
      ? customCategory.trim()
      : formData.category;

    if (editingItem) {
      const updated: MenuItem = {
        ...editingItem,
        name: formData.name.trim(),
        category: finalCategory,
        price: Number(formData.price),
        cost: Number(formData.cost),
        preparationTime: Number(formData.preparationTime),
        description: formData.description.trim(),
        imageUrl: formData.imageUrl.trim() || undefined,
      };
      dispatch(updateMenuItem(updated));
      await menuApi.updateMenuItem(updated.id, updated);
      showToast(`✅ '${updated.name}' updated in database with image and synced with POS!`);
    } else {
      const newItemId = `m-${Date.now()}`;
      const newItem: MenuItem = {
        id: newItemId,
        name: formData.name.trim(),
        category: finalCategory,
        price: Number(formData.price),
        cost: Number(formData.cost),
        preparationTime: Number(formData.preparationTime),
        description: formData.description.trim(),
        imageUrl: formData.imageUrl.trim() || undefined,
        isAvailable: true,
        is86d: false,
      };
      dispatch(addMenuItem(newItem));
      await menuApi.createMenuItem(newItem);
      showToast(`🎉 '${newItem.name}' created in Database & ready with image in POS!`);
    }

    setModalOpen(false);
    setEditingItem(null);
    setIsNewCategory(false);
    setCustomCategory('');
  };

  const openAddModal = () => {
    setEditingItem(null);
    setIsNewCategory(false);
    setCustomCategory('');
    setImageError(null);
    setUseUrlInput(false);
    setFormData({
      name: '',
      category: categories.find((c) => c !== 'All') || 'Burgers',
      price: 999,
      cost: 350,
      preparationTime: 10,
      description: '',
      imageUrl: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (item: MenuItem) => {
    setEditingItem(item);
    setIsNewCategory(false);
    setCustomCategory('');
    setImageError(null);
    setUseUrlInput(Boolean(item.imageUrl && item.imageUrl.startsWith('http')));
    setFormData({
      name: item.name,
      category: item.category,
      price: item.price,
      cost: item.cost || 0,
      preparationTime: item.preparationTime || 10,
      description: item.description || '',
      imageUrl: item.imageUrl || '',
    });
    setModalOpen(true);
  };

  const handleRefreshMenu = async () => {
    const dbItems = await menuApi.getMenu();
    if (dbItems && dbItems.length > 0) {
      dispatch(setMenuItems(dbItems));
      showToast('🔄 Menu catalog reloaded directly from database.');
    }
  };

  const filteredItems = items.filter((item) => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="page-container">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          style={{
            padding: '12px 20px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(99, 102, 241, 0.25))',
            border: '1px solid #10b981',
            color: '#34d399',
            fontWeight: 700,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
          }}
        >
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 800 }}>📋 Menu & Recipe Management</h2>
            <span style={{ fontSize: '11px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>
              ⚡ Database Connected
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            All dishes are saved directly into the backend database, auto-syncing with POS & Kitchen
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={handleRefreshMenu} title="Reload menu catalog from database">
            🔄 Refresh from DB
          </button>
          <button className="btn btn-primary" onClick={openAddModal}>
            + Add Menu Item
          </button>
        </div>
      </div>

      {/* Filter and Category Bar */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="form-input"
          placeholder="🔍 Search items by name, category, or ingredients..."
          style={{ maxWidth: '380px' }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', flex: 1 }}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`btn btn-sm ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedCategory(cat)}
              style={{ flexShrink: 0 }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Table */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '60px' }}>Photo</th>
              <th>Dish Name</th>
              <th>Category</th>
              <th>Price (PKR)</th>
              <th>Food Cost (PKR)</th>
              <th>Gross Margin</th>
              <th>Prep Time</th>
              <th>Stock Status (86)</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>🍽️</div>
                  <div style={{ fontWeight: 600 }}>No menu items found</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    Click "+ Add Menu Item" above to add your first dish.
                  </div>
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const cost = item.cost || 0;
                const margin =
                  item.price > 0 ? (((item.price - cost) / item.price) * 100).toFixed(0) : '0';
                const visual = getCategoryVisual(item.category);

                return (
                  <tr key={item.id}>
                    <td>
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          background: item.imageUrl ? '#0f172a' : visual.gradient,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        }}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span style={{ fontSize: '20px' }}>{visual.icon}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{item.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.description}</div>
                    </td>
                    <td>
                      <span className="badge badge-open">{item.category}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: '#38bdf8' }}>{formatPKR(item.price)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatPKR(cost)}</td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: Number(margin) >= 60 ? '#10b981' : Number(margin) >= 40 ? '#f59e0b' : '#ef4444',
                        }}
                      >
                        {margin}%
                      </span>
                    </td>
                    <td>⏱️ {item.preparationTime || 10} min</td>
                    <td>
                      <button
                        className={`btn btn-sm ${item.is86d ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => handleToggle86(item)}
                        title="Click to toggle 86 status"
                      >
                        {item.is86d ? '🚫 86\'d (Out)' : '🟢 In Stock'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(item)}>
                          Edit
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Menu Item Modal */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">🍽️ {editingItem ? 'Edit Menu Item' : 'New Menu Item'}</h3>
                <p className="modal-subtitle">Configure pricing, dish photo, category, and recipe ingredients</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setModalOpen(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveItem}>
              <div className="modal-body">
                {/* Image Upload / Dropzone Section */}
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label className="input-label" style={{ marginBottom: 0, fontWeight: 700 }}>
                      <span>📸 Dish Photo / Image</span>
                      <span className="label-hint">Loads on POS</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setUseUrlInput(!useUrlInput)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#38bdf8',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {useUrlInput ? '📁 Upload Image File' : '🔗 Paste Web URL'}
                    </button>
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleProcessImageFile(e.target.files[0])}
                    style={{ display: 'none' }}
                  />

                  {formData.imageUrl ? (
                    <div className="image-preview-card">
                      <img src={formData.imageUrl} alt="Dish Preview" />
                      <div className="image-preview-overlay">
                        <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>
                          ✓ Image Attached & Stored in DB
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            📁 Change
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => setFormData({ ...formData, imageUrl: '' })}
                          >
                            🗑️ Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : useUrlInput ? (
                    <div>
                      <input
                        type="url"
                        className="input-field"
                        placeholder="https://example.com/photos/burger.jpg"
                        value={formData.imageUrl}
                        onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div
                      className={`image-upload-dropzone ${isDragOver ? 'dragover' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragOver(true);
                      }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.files?.[0]) {
                          handleProcessImageFile(e.dataTransfer.files[0]);
                        }
                      }}
                    >
                      {imageUploading ? (
                        <div style={{ padding: '10px 0' }}>
                          <div style={{ fontSize: '24px', marginBottom: '6px' }}>⏳</div>
                          <div style={{ fontSize: '13px', fontWeight: 600 }}>Optimizing & converting image...</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: '32px', marginBottom: '6px' }}>🖼️</div>
                          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                            Click to Upload Image File or Drag & Drop Here
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Supports PNG, JPG, JPEG, WebP • Auto-compressed for rapid POS loading
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {imageError && (
                    <div style={{ fontSize: '12px', color: '#f87171', marginTop: '6px' }}>
                      ⚠️ {imageError}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="input-label">
                    <span>Item / Dish Name</span>
                    <span className="label-hint">Required</span>
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Crispy Zinger Burger, Pepperoni Pizza..."
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label className="input-label" style={{ marginBottom: 0 }}>Category</label>
                      <button
                        type="button"
                        onClick={() => setIsNewCategory(!isNewCategory)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#38bdf8',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {isNewCategory ? '← Choose Existing' : '+ New Category'}
                      </button>
                    </div>

                    {isNewCategory ? (
                      <input
                        type="text"
                        className="input-field"
                        required
                        placeholder="e.g. Sandwiches, Platters..."
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                      />
                    ) : (
                      <select
                        className="input-field"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      >
                        {categories
                          .filter((c) => c !== 'All')
                          .map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="input-label">
                      <span>Prep Time (minutes)</span>
                      <span className="label-hint">Kitchen KDS</span>
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      required
                      min="1"
                      value={formData.preparationTime}
                      onChange={(e) =>
                        setFormData({ ...formData, preparationTime: parseInt(e.target.value) || 5 })
                      }
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label className="input-label">
                      <span>Selling Price (PKR)</span>
                      <span className="label-hint">Required</span>
                    </label>
                    <input
                      type="number"
                      step="1"
                      className="input-field"
                      required
                      value={formData.price}
                      onChange={(e) =>
                        setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="input-label">
                      <span>Estimated Food Cost (PKR)</span>
                      <span className="label-hint">Margin calculation</span>
                    </label>
                    <input
                      type="number"
                      step="1"
                      className="input-field"
                      required
                      value={formData.cost}
                      onChange={(e) =>
                        setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="input-label">
                    <span>Description & Recipe Ingredients</span>
                    <span className="label-hint">Mentioning stock items auto-deducts them on sale</span>
                  </label>
                  <textarea
                    className="input-field"
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g. Crispy chicken zinger made with fresh thai piece, sesame bun, mayonnaise, and lettuce..."
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={imageUploading}>
                  {editingItem ? '✓ Save Changes' : '✓ Add Item to Menu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuPage;
