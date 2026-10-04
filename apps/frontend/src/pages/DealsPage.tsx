import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { RootState } from '../store/store';
import { Deal, DealItem } from '../types/deal.types';
import { MenuItem, setMenuItems } from '../store/slices/menuSlice';
import {
  setDeals,
  addDeal,
  updateDealInState,
  removeDeal,
  toggleDealActiveInState,
} from '../store/slices/dealSlice';
import { dealApi } from '../api/deal.api';
import { menuApi } from '../api/menu.api';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { formatPKR } from '../utils/format';
import { compressImageFile } from '../utils/image';

interface DealItemFormRow {
  menuItemId: string;
  quantity: number | string;
}

export const DealsPage: React.FC = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const menuItems = useSelector((state: RootState) => state.menu.items);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);

  // Form State
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    price: string | number;
    isActive: boolean;
    imageUrl: string;
    items: DealItemFormRow[];
  }>({
    name: '',
    description: '',
    price: '',
    isActive: true,
    imageUrl: '',
    items: [],
  });

  // Search & add items inside modal
  const [itemSearch, setItemSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedMenuItemToAdd, setSelectedMenuItemToAdd] = useState<MenuItem | null>(null);
  const [selectedQtyToAdd, setSelectedQtyToAdd] = useState<number>(1);

  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync menu items for bundle picker
  useEffect(() => {
    const fetchMenu = async () => {
      const items = await menuApi.getMenu();
      if (items && items.length > 0) {
        dispatch(setMenuItems(items));
      }
    };
    fetchMenu();
  }, [dispatch]);

  // Close item dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // React Query Infinite Scroll for Deals
  const {
    data: dealData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch: refetchDeals,
  } = useInfiniteQuery({
    queryKey: ['deals', activeFilter, searchQuery],
    queryFn: ({ pageParam = 1 }) =>
      dealApi.getDealsPaginated({
        page: pageParam,
        limit: 50,
        search: searchQuery.trim() || undefined,
        isActive:
          activeFilter === 'ACTIVE'
            ? true
            : activeFilter === 'INACTIVE'
            ? false
            : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const deals = useMemo(() => {
    return dealData?.pages.flatMap((p) => p.data) || [];
  }, [dealData]);

  const totalDealsCount = dealData?.pages[0]?.totalCount ?? deals.length;

  const activeDealsCount = useMemo(() => {
    return deals.filter((d) => d.isActive).length;
  }, [deals]);

  const handleToggleActive = async (deal: Deal) => {
    const nextActive = !deal.isActive;
    dispatch(toggleDealActiveInState({ id: deal.id, isActive: nextActive }));
    await dealApi.toggleDealActive(deal.id, nextActive);
    queryClient.invalidateQueries({ queryKey: ['deals'] });
    queryClient.invalidateQueries({ queryKey: ['active-deals'] });
    showToast(
      nextActive
        ? `🟢 Combo Deal "${deal.name}" activated (now live in POS)`
        : `⚪ Combo Deal "${deal.name}" deactivated (hidden from POS)`
    );
  };

  const handleDelete = async (deal: Deal) => {
    if (confirm(`Are you sure you want to delete the deal "${deal.name}"?`)) {
      dispatch(removeDeal(deal.id));
      await dealApi.deleteDeal(deal.id);
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['active-deals'] });
      showToast(`🗑️ Deal "${deal.name}" removed`);
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
      setImageError(err.message || 'Failed to process image');
    } finally {
      setImageUploading(false);
    }
  };

  const openCreateModal = () => {
    setEditingDeal(null);
    setFormData({
      name: '',
      description: '',
      price: '',
      isActive: true,
      imageUrl: '',
      items: [],
    });
    setItemSearch('');
    setSelectedMenuItemToAdd(null);
    setSelectedQtyToAdd(1);
    setFormError(null);
    setImageError(null);
    setModalOpen(true);
  };

  const openEditModal = (deal: Deal) => {
    setEditingDeal(deal);
    setFormData({
      name: deal.name,
      description: deal.description || '',
      price: deal.price,
      isActive: deal.isActive,
      imageUrl: deal.imageUrl || '',
      items: deal.items.map((i) => ({
        menuItemId: i.menuItemId,
        quantity: i.quantity,
      })),
    });
    setItemSearch('');
    setSelectedMenuItemToAdd(null);
    setSelectedQtyToAdd(1);
    setFormError(null);
    setImageError(null);
    setModalOpen(true);
  };

  const handleAddItemToCombo = () => {
    if (!selectedMenuItemToAdd) return;
    const qty = Math.max(1, Number(selectedQtyToAdd) || 1);

    setFormData((prev) => {
      const existingIdx = prev.items.findIndex(
        (i) => i.menuItemId === selectedMenuItemToAdd.id
      );
      if (existingIdx !== -1) {
        const next = [...prev.items];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: Number(next[existingIdx].quantity) + qty,
        };
        return { ...prev, items: next };
      }
      return {
        ...prev,
        items: [...prev.items, { menuItemId: selectedMenuItemToAdd.id, quantity: qty }],
      };
    });

    setSelectedMenuItemToAdd(null);
    setSelectedQtyToAdd(1);
    setItemSearch('');
    setIsDropdownOpen(false);
    setFormError(null);
  };

  const handleRemoveItemFromCombo = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleQuantityChange = (index: number, val: string | number) => {
    setFormData((prev) => {
      const next = [...prev.items];
      next[index] = { ...next[index], quantity: val };
      return { ...prev, items: next };
    });
  };

  // Component items price sum for live discount preview
  const originalItemsTotal = useMemo(() => {
    return formData.items.reduce((sum, row) => {
      const menuItem = menuItems.find((m) => m.id === row.menuItemId);
      const price = Number(menuItem?.price || 0);
      const qty = Number(row.quantity) || 0;
      return sum + price * qty;
    }, 0);
  }, [formData.items, menuItems]);

  const dealPriceNum = Number(formData.price) || 0;
  const savingsAmount = originalItemsTotal - dealPriceNum;
  const savingsPercent =
    originalItemsTotal > 0 && dealPriceNum > 0
      ? Math.round(((originalItemsTotal - dealPriceNum) / originalItemsTotal) * 100)
      : 0;

  const filteredMenuItemsDropdown = useMemo(() => {
    if (!itemSearch.trim()) return menuItems.slice(0, 20);
    const q = itemSearch.toLowerCase();
    return menuItems.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (typeof m.category === 'string' ? m.category : '').toLowerCase().includes(q)
    );
  }, [itemSearch, menuItems]);

  const handleSaveDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = formData.name.trim();
    if (!name) {
      setFormError('Please enter a Deal / Combo Name.');
      return;
    }

    const price = Number(formData.price);
    if (isNaN(price) || price <= 0) {
      setFormError('Please enter a valid bundle price (greater than 0).');
      return;
    }

    if (formData.items.length === 0) {
      setFormError('Please select at least one menu item to include in this combo bundle.');
      return;
    }

    // Validate quantities
    for (const item of formData.items) {
      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        const mi = menuItems.find((m) => m.id === item.menuItemId);
        setFormError(`Please specify a valid quantity for "${mi?.name || 'Item'}".`);
        return;
      }
    }

    const formattedItems: DealItem[] = formData.items.map((row) => {
      const mi = menuItems.find((m) => m.id === row.menuItemId);
      return {
        menuItemId: row.menuItemId,
        quantity: Number(row.quantity),
        menuItem: mi,
      };
    });

    if (editingDeal) {
      const updatedDeal: Deal = {
        ...editingDeal,
        name,
        description: formData.description.trim(),
        price,
        isActive: formData.isActive,
        imageUrl: formData.imageUrl.trim() || undefined,
        items: formattedItems,
      };

      dispatch(updateDealInState(updatedDeal));
      await dealApi.updateDeal(updatedDeal.id, updatedDeal);
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['active-deals'] });
      showToast(`✅ Deal "${updatedDeal.name}" updated successfully!`);
    } else {
      const newDealId = `deal-${Date.now()}`;
      const newDeal: Deal = {
        id: newDealId,
        name,
        description: formData.description.trim(),
        price,
        isActive: formData.isActive,
        imageUrl: formData.imageUrl.trim() || undefined,
        items: formattedItems,
      };

      dispatch(addDeal(newDeal));
      await dealApi.createDeal(newDeal);
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['active-deals'] });
      showToast(`🎉 Deal "${newDeal.name}" created with ${formattedItems.length} bundled items!`);
    }

    setModalOpen(false);
    setEditingDeal(null);
  };

  return (
    <div className="menu-page-container" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            zIndex: 9999,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header Row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>🎁</span> Deals & Combo Bundles
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Create discounted meal combos, family bundles, and promo packages with automatic stock deduction.
          </p>
        </div>

        <button className="btn btn-primary" onClick={openCreateModal} style={{ gap: '8px' }}>
          <span>➕</span>
          <span>Create New Deal</span>
        </button>
      </div>

      {/* Summary Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>TOTAL DEALS</div>
          <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>
            {totalDealsCount}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>ACTIVE DEALS (IN POS)</div>
          <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '4px', color: '#10b981' }}>
            {activeDealsCount}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>INACTIVE / DRAFT</div>
          <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '4px', color: 'var(--text-secondary)' }}>
            {Math.max(0, totalDealsCount - activeDealsCount)}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          padding: '16px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '24px',
        }}
      >
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            className="form-input"
            placeholder="🔍 Search deals by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveFilter(tab)}
              className={`btn btn-sm ${activeFilter === tab ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontWeight: 700 }}
            >
              {tab === 'ALL' ? 'All Deals' : tab === 'ACTIVE' ? '🟢 Active Only' : '⚪ Inactive'}
            </button>
          ))}
        </div>
      </div>

      {/* Deals Grid */}
      {isLoading && deals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
          <div>Loading deals catalog...</div>
        </div>
      ) : deals.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 20px',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎁</div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>No Deals Found</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 20px' }}>
            {searchQuery
              ? 'No deals match your search query.'
              : 'Create your first combo deal to offer discounted bundle pricing on the POS screen.'}
          </p>
          <button className="btn btn-primary" onClick={openCreateModal}>
            ➕ Create First Deal
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '20px',
          }}
        >
          {deals.map((deal) => {
            const sumOriginalPrice = deal.items.reduce((s, di) => {
              const mi = di.menuItem || menuItems.find((m) => m.id === di.menuItemId);
              return s + (Number(mi?.price) || 0) * di.quantity;
            }, 0);

            const dealDiscount = sumOriginalPrice - deal.price;
            const dealPercent =
              sumOriginalPrice > 0 && dealDiscount > 0
                ? Math.round((dealDiscount / sumOriginalPrice) * 100)
                : 0;

            return (
              <div
                key={deal.id}
                style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-lg)',
                  border: `1px solid ${deal.isActive ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-color)'}`,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  boxShadow: deal.isActive ? '0 4px 20px rgba(0,0,0,0.25)' : 'none',
                  opacity: deal.isActive ? 1 : 0.75,
                }}
              >
                {/* Visual Header / Banner */}
                <div
                  style={{
                    position: 'relative',
                    height: '140px',
                    background: deal.imageUrl
                      ? `url(${deal.imageUrl}) center/cover no-repeat`
                      : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                    display: 'flex',
                    alignItems: 'flex-end',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(to top, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.2) 60%)',
                    }}
                  />

                  {/* Active Toggle Badge Top Left */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleActive(deal);
                    }}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      left: '12px',
                      background: deal.isActive ? 'rgba(16, 185, 129, 0.9)' : 'rgba(100, 116, 139, 0.8)',
                      backdropFilter: 'blur(4px)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '9999px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                    title={deal.isActive ? 'Click to deactivate' : 'Click to activate'}
                  >
                    <span>{deal.isActive ? '🟢 ACTIVE IN POS' : '⚪ INACTIVE'}</span>
                  </button>

                  {/* Price Tag Top Right */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      background: 'rgba(15, 23, 42, 0.9)',
                      backdropFilter: 'blur(4px)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      borderRadius: 'var(--radius-md)',
                      padding: '4px 12px',
                      fontSize: '15px',
                      fontWeight: 900,
                      boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
                    }}
                  >
                    {formatPKR(deal.price)}
                  </div>

                  {/* Deal Title */}
                  <div style={{ position: 'relative', zIndex: 2 }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.6)' }}>
                      {deal.name}
                    </h3>
                  </div>
                </div>

                {/* Deal Body */}
                <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {deal.description && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      {deal.description}
                    </p>
                  )}

                  {/* Savings & Comparison Badge */}
                  {sumOriginalPrice > 0 && (
                    <div
                      style={{
                        background: dealDiscount > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${dealDiscount > 0 ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Items Value: <del>{formatPKR(sumOriginalPrice)}</del>
                      </span>
                      {dealDiscount > 0 ? (
                        <span style={{ color: '#10b981', fontWeight: 800 }}>
                          Save {formatPKR(dealDiscount)} ({dealPercent}% OFF)
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Special Combo</span>
                      )}
                    </div>
                  )}

                  {/* Included Items Section */}
                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '8px',
                      }}
                    >
                      📦 INCLUDED ITEMS ({deal.items.reduce((s, i) => s + i.quantity, 0)} TOTAL):
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {deal.items.map((di, idx) => {
                        const mi = di.menuItem || menuItems.find((m) => m.id === di.menuItemId);
                        return (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              background: 'rgba(255, 255, 255, 0.03)',
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '12px',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>
                              <span style={{ color: 'var(--primary)', marginRight: '6px', fontWeight: 800 }}>
                                {di.quantity}x
                              </span>
                              {mi?.name || 'Menu Item'}
                            </span>
                            {mi?.price ? (
                              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                                {formatPKR(mi.price * di.quantity)}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div
                    style={{
                      marginTop: 'auto',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleToggleActive(deal)}
                      style={{ flex: 1, fontSize: '11px' }}
                    >
                      {deal.isActive ? '⚪ Deactivate' : '🟢 Activate'}
                    </button>

                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => openEditModal(deal)}
                      style={{ flex: 1, fontSize: '11px' }}
                    >
                      ✏️ Edit
                    </button>

                    <button
                      className="btn btn-sm"
                      onClick={() => handleDelete(deal)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        fontSize: '11px',
                        padding: '6px 10px',
                      }}
                      title="Delete Deal"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Infinite Scroll Sentinel */}
      <InfiniteScrollSentinel
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />

      {/* Create / Edit Deal Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editingDeal ? '✏️ Edit Deal / Combo Bundle' : '🎁 Create New Combo Deal'}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDeal} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {formError && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    ⚠️ {formError}
                  </div>
                )}

                {/* Deal Name */}
                <div className="form-group">
                  <label className="form-label">Deal / Combo Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Classic Burger & Float Combo"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                {/* Deal Price & Active Status */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Special Bundle Price (PKR) *</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      placeholder="e.g. 1999"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Status in POS</label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        height: '42px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>
                        {formData.isActive ? '🟢 Active in POS' : '⚪ Inactive'}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Description */}
                <div className="form-group">
                  <label className="form-label">Short Description / Subtitle</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="e.g. 1x Smash Burger + 1x Large Loaded Fries + 1x Float"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                {/* Image Upload */}
                <div className="form-group">
                  <label className="form-label">Deal Image (Optional)</label>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleProcessImageFile(file);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={imageUploading}
                    >
                      {imageUploading ? '⏳ Uploading...' : '📁 Browse Image File'}
                    </button>
                    {formData.imageUrl && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ color: '#f87171' }}
                        onClick={() => setFormData({ ...formData, imageUrl: '' })}
                      >
                        Remove Image
                      </button>
                    )}
                  </div>
                  {imageError && (
                    <span style={{ color: '#f87171', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                      {imageError}
                    </span>
                  )}
                  {formData.imageUrl && (
                    <div style={{ marginTop: '10px' }}>
                      <img
                        src={formData.imageUrl}
                        alt="Preview"
                        style={{ width: '100px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius-md)' }}
                      />
                    </div>
                  )}
                </div>

                {/* Searchable Component Items Selector */}
                <div
                  style={{
                    border: '1px solid var(--border-color)',
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>
                      📦 Bundled Menu Items (Recipe Stock Linked) *
                    </label>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {formData.items.length} item{formData.items.length !== 1 ? 's' : ''} in combo
                    </span>
                  </div>

                  {/* Add Item Row */}
                  <div style={{ position: 'relative', marginBottom: '14px' }} ref={dropdownRef}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="🔍 Search item to add (e.g. Zinger, Fries)..."
                        value={selectedMenuItemToAdd ? selectedMenuItemToAdd.name : itemSearch}
                        onChange={(e) => {
                          setSelectedMenuItemToAdd(null);
                          setItemSearch(e.target.value);
                          setIsDropdownOpen(true);
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                        style={{ fontSize: '13px' }}
                      />

                      <input
                        type="number"
                        min="1"
                        className="form-input"
                        placeholder="Qty"
                        value={selectedQtyToAdd}
                        onChange={(e) => setSelectedQtyToAdd(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        style={{ fontSize: '13px' }}
                      />

                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleAddItemToCombo}
                        disabled={!selectedMenuItemToAdd}
                        style={{ padding: '0 16px', fontWeight: 700 }}
                      >
                        + Add
                      </button>
                    </div>

                    {/* Dropdown Menu Items List */}
                    {isDropdownOpen && !selectedMenuItemToAdd && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: '180px',
                          zIndex: 50,
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-md)',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                          marginTop: '4px',
                        }}
                      >
                        {filteredMenuItemsDropdown.length === 0 ? (
                          <div style={{ padding: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
                            No matching menu items
                          </div>
                        ) : (
                          filteredMenuItemsDropdown.map((m) => (
                            <div
                              key={m.id}
                              onClick={() => {
                                setSelectedMenuItemToAdd(m);
                                setItemSearch('');
                                setIsDropdownOpen(false);
                              }}
                              style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '12px',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              <span style={{ fontWeight: 600 }}>{m.name}</span>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                                {formatPKR(m.price)} • {typeof m.category === 'string' ? m.category : 'General'}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bundled Items List */}
                  {formData.items.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '20px',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      No items added yet. Search and add component dishes to this deal.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {formData.items.map((row, idx) => {
                        const mi = menuItems.find((m) => m.id === row.menuItemId);
                        const itemPrice = Number(mi?.price || 0);
                        const rowQty = Number(row.quantity) || 1;
                        const rowTotal = itemPrice * rowQty;

                        return (
                          <div
                            key={idx}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 100px 90px 40px',
                              gap: '8px',
                              alignItems: 'center',
                              background: 'rgba(255, 255, 255, 0.04)',
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-md)',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '13px' }}>{mi?.name || 'Menu Item'}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                Unit: {formatPKR(itemPrice)}
                              </div>
                            </div>

                            <div>
                              <input
                                type="number"
                                min="1"
                                className="form-input"
                                value={row.quantity}
                                onChange={(e) => handleQuantityChange(idx, e.target.value)}
                                style={{ padding: '6px 8px', fontSize: '13px', textAlign: 'center' }}
                              />
                            </div>

                            <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                              {formatPKR(rowTotal)}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveItemFromCombo(idx)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: 'var(--radius-sm)',
                                width: '32px',
                                height: '32px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                              title="Remove item"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Live Value Calculation Comparison Banner */}
                  {originalItemsTotal > 0 && (
                    <div
                      style={{
                        marginTop: '16px',
                        padding: '12px 16px',
                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(16, 185, 129, 0.15))',
                        border: '1px solid var(--primary)',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        fontSize: '13px',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Individual Items Total: </span>
                        <strong style={{ textDecoration: savingsAmount > 0 ? 'line-through' : 'none' }}>
                          {formatPKR(originalItemsTotal)}
                        </strong>
                      </div>

                      {savingsAmount > 0 ? (
                        <div style={{ color: '#10b981', fontWeight: 800 }}>
                          🎉 Customer Saves: {formatPKR(savingsAmount)} ({savingsPercent}% OFF)
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-secondary)' }}>
                          Bundle Price: <strong>{formatPKR(dealPriceNum)}</strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '0 24px' }}>
                  {editingDeal ? 'Save Changes' : 'Create Deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DealsPage;
