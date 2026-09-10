import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { addOrder, setCurrentOrder } from '../store/slices/orderSlice';
import { MenuItem, setMenuItems } from '../store/slices/menuSlice';
import { ReceiptModal, ReceiptData } from '../components/ReceiptModal';
import { socketClient } from '../lib/socket';
import { formatPKR } from '../utils/format';
import { menuApi } from '../api/menu.api';
import { orderApi } from '../api/order.api';
import { getCategoryVisual } from '../utils/image';

export type OrderType = 'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY';

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export const PosPage: React.FC = () => {
  const dispatch = useDispatch();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const menuItems = useSelector((state: RootState) => state.menu.items);
  const menuCategories = useSelector((state: RootState) => state.menu.categories);

  // Sync menu items from Database on mount
  useEffect(() => {
    const fetchDbMenu = async () => {
      const dbItems = await menuApi.getMenu();
      if (dbItems && dbItems.length > 0) {
        dispatch(setMenuItems(dbItems));
      }
    };
    fetchDbMenu();
  }, [dispatch]);

  // Order Type state: DINE_IN | TAKE_AWAY | DELIVERY
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');

  // Order Type contextual metadata
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [dineInTag, setDineInTag] = useState('');

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [notification, setNotification] = useState<string | null>(null);

  // Dynamic contextual charges:
  // Dine In: Tax percentage (initially 0) + flat Service Charges (PKR)
  const [taxRate, setTaxRate] = useState<number>(0);
  const [serviceChargeAmount, setServiceChargeAmount] = useState<number>(0);
  // Delivery: flat Delivery Charges (PKR)
  const [deliveryChargeAmount, setDeliveryChargeAmount] = useState<number>(150);

  // Receipt Modal State
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [defaultReceiptTab, setDefaultReceiptTab] = useState<'BOTH' | 'CUSTOMER' | 'KITCHEN'>('BOTH');

  // Cash payment prompt state
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashTendered, setCashTendered] = useState<number>(0);

  // Socket listener for order/inventory events
  useEffect(() => {
    const socket = socketClient.getSocket();
    if (socket) {
      socket.on('inventory:alert', (alert: any) => {
        setNotification(alert.message || `Low stock alert on ${alert.name}`);
        setTimeout(() => setNotification(null), 6000);
      });
    }
    return () => {
      socket?.off('inventory:alert');
    };
  }, []);

  const getOrderTypeLabel = (type: OrderType): string => {
    switch (type) {
      case 'DINE_IN':
        return 'Dine In';
      case 'TAKE_AWAY':
        return 'Take Away';
      case 'DELIVERY':
        return 'Delivery';
    }
  };

  const getOrderTypeIcon = (type: OrderType): string => {
    switch (type) {
      case 'DINE_IN':
        return '🍽️';
      case 'TAKE_AWAY':
        return '🛍️';
      case 'DELIVERY':
        return '🛵';
    }
  };

  const getOrderReferenceString = (): string => {
    if (orderType === 'DINE_IN') {
      return dineInTag.trim() ? `Dine In (${dineInTag.trim()})` : 'Dine In';
    }
    if (orderType === 'TAKE_AWAY') {
      return customerName.trim() ? `Take Away (${customerName.trim()})` : 'Take Away';
    }
    if (orderType === 'DELIVERY') {
      return customerName.trim() ? `Delivery (${customerName.trim()})` : 'Delivery';
    }
    return getOrderTypeLabel(orderType);
  };

  const filteredItems = menuItems.filter((item) => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const addToCart = (item: MenuItem) => {
    if (item.is86d) {
      setNotification(`⚠️ "${item.name}" is marked 86'd (Out of stock) in Menu.`);
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItemId === item.id);
      if (existing) {
        return prev.map((i) =>
          i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const updateQuantity = (menuItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.menuItemId === menuItemId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const updateItemNotes = (menuItemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((i) => (i.menuItemId === menuItemId ? { ...i, notes } : i))
    );
  };

  // Financial calculations: Contextual based on Order Type
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const isDineIn = orderType === 'DINE_IN';
  const isDelivery = orderType === 'DELIVERY';

  // Dine In: Tax percentage (editable, initially 0) & flat Service Charges (PKR)
  const tax = isDineIn ? +(subtotal * (Math.max(0, taxRate) / 100)).toFixed(2) : 0;
  const serviceCharge = isDineIn ? Math.max(0, serviceChargeAmount) : 0;

  // Delivery: Delivery Charges (PKR); no tax and no service charges
  const deliveryCharge = isDelivery ? Math.max(0, deliveryChargeAmount) : 0;

  // Total
  const total = +(subtotal + tax + serviceCharge + deliveryCharge).toFixed(2);

  const handleSubmitOrder = (autoPrintBoth = true) => {
    if (cart.length === 0) return;

    const orderNum = Math.floor(Math.random() * 900) + 100;
    const orderId = `ORD-${Date.now().toString().slice(-5)}`;
    const orderRef = getOrderReferenceString();

    const newOrder: any = {
      id: orderId,
      orderNumber: orderNum,
      orderType,
      orderTypeLabel: getOrderTypeLabel(orderType),
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      deliveryAddress: deliveryAddress.trim() || undefined,
      dineInTag: dineInTag.trim() || undefined,
      server: authUser || { firstName: 'Alex', lastName: 'Morgan' },
      items: cart.map((c) => ({
        id: `oi-${Math.random().toString(36).substring(2, 7)}`,
        menuItemId: c.menuItemId,
        name: c.name,
        quantity: c.quantity,
        price: c.price,
        unitPrice: c.price,
        notes: c.notes,
        status: 'PENDING',
      })),
      status: 'confirmed',
      paymentStatus: 'UNPAID',
      paymentMethod: `DIRECT / ${getOrderTypeLabel(orderType).toUpperCase()}`,
      subtotal,
      serviceCharge,
      serviceChargeRate: 0,
      deliveryCharge,
      tax,
      taxRate: isDineIn ? taxRate : 0,
      total,
      notes: orderNotes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Emit order event to socket kitchen room if connected
    const socket = socketClient.getSocket();
    if (socket) {
      socket.emit('order:create', newOrder);
    }

    dispatch(addOrder(newOrder));
    dispatch(setCurrentOrder(newOrder));

    // Save order directly to Database
    orderApi.createOrder(newOrder);

    setNotification(
      `✅ Order #${orderNum} (${getOrderTypeIcon(orderType)} ${getOrderTypeLabel(orderType)}) sent to kitchen & saved to DB!`
    );
    setTimeout(() => setNotification(null), 4000);

    // Prepare dual receipts (Customer + Kitchen)
    const receipt: ReceiptData = {
      orderNumber: orderNum,
      orderId,
      date: new Date(),
      orderType: getOrderTypeLabel(orderType),
      server: authUser ? `${authUser.firstName} ${authUser.lastName}` : 'Alex Morgan',
      notes: [
        orderNotes ? `Kitchen Note: ${orderNotes}` : '',
        deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
        customerPhone ? `Contact: ${customerPhone}` : '',
        customerName ? `Customer: ${customerName}` : '',
        dineInTag ? `Seat/Tag: ${dineInTag}` : '',
      ]
        .filter(Boolean)
        .join(' • '),
      items: cart.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        unitPrice: c.price,
        total: c.price * c.quantity,
        notes: c.notes,
      })),
      subtotal,
      serviceCharge: isDineIn ? serviceCharge : 0,
      deliveryCharge: isDelivery ? deliveryCharge : 0,
      tax: isDineIn ? tax : 0,
      taxRate: isDineIn ? taxRate : 0,
      total,
      totalPaid: total,
      change: 0,
      paymentMethod: `DIRECT / ${getOrderTypeLabel(orderType).toUpperCase()}`,
    };

    setReceiptData(receipt);
    setDefaultReceiptTab('BOTH');
    setReceiptOpen(true);

    // Reset cart and fields
    setCart([]);
    setOrderNotes('');
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDineInTag('');
  };

  const handleOpenCashModal = () => {
    setCashTendered(Math.ceil(total));
    setCashModalOpen(true);
  };

  const handleCompleteCashPayment = (tendered: number) => {
    const change = Math.max(0, tendered - total);
    const orderNum = Math.floor(Math.random() * 900) + 100;
    const orderId = `ORD-${Date.now().toString().slice(-5)}`;

    const newOrder: any = {
      id: orderId,
      orderNumber: orderNum,
      orderType,
      orderTypeLabel: getOrderTypeLabel(orderType),
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      deliveryAddress: deliveryAddress.trim() || undefined,
      dineInTag: dineInTag.trim() || undefined,
      server: authUser || { firstName: 'Alex', lastName: 'Morgan' },
      items: cart.map((c) => ({
        id: `oi-${Math.random().toString(36).substring(2, 7)}`,
        menuItemId: c.menuItemId,
        name: c.name,
        quantity: c.quantity,
        price: c.price,
        notes: c.notes,
        status: 'PENDING',
      })),
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      totalPaid: tendered,
      change,
      subtotal,
      serviceCharge,
      serviceChargeRate: 0,
      deliveryCharge,
      tax,
      taxRate: isDineIn ? taxRate : 0,
      total,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const socket = socketClient.getSocket();
    if (socket) {
      socket.emit('order:create', newOrder);
    }

    dispatch(addOrder(newOrder));
    dispatch(setCurrentOrder(newOrder));

    // Save order directly to Database
    orderApi.createOrder(newOrder);

    const receipt: ReceiptData = {
      orderNumber: orderNum,
      orderId,
      date: new Date(),
      orderType: getOrderTypeLabel(orderType),
      server: authUser ? `${authUser.firstName} ${authUser.lastName}` : 'Alex Morgan',
      notes: [
        orderNotes ? `Kitchen Note: ${orderNotes}` : '',
        deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
        customerPhone ? `Contact: ${customerPhone}` : '',
        customerName ? `Customer: ${customerName}` : '',
        dineInTag ? `Seat/Tag: ${dineInTag}` : '',
      ]
        .filter(Boolean)
        .join(' • '),
      items: cart.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        unitPrice: c.price,
        total: c.price * c.quantity,
        notes: c.notes,
      })),
      subtotal,
      serviceCharge: isDineIn ? serviceCharge : 0,
      deliveryCharge: isDelivery ? deliveryCharge : 0,
      tax: isDineIn ? tax : 0,
      taxRate: isDineIn ? taxRate : 0,
      total,
      totalPaid: tendered,
      change,
      paymentMethod: 'CASH',
    };

    setReceiptData(receipt);
    setCashModalOpen(false);
    setDefaultReceiptTab('BOTH');
    setReceiptOpen(true);
    setCart([]);
    setOrderNotes('');
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDineInTag('');
  };

  return (
    <div className="pos-layout">
      {/* Main Menu & Ordering Area */}
      <div className="pos-main">
        {/* Live Notification Banner */}
        {notification && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(16, 185, 129, 0.2))',
              border: '1px solid var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            <span>{notification}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setNotification(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* ORDER TYPE SELECTOR BAR (DINE IN | TAKE AWAY | DELIVERY) */}
        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Order Type:
            </span>

            <div style={{ display: 'flex', gap: '10px', flex: 1, maxWidth: '600px' }}>
              {(
                [
                  { type: 'DINE_IN', label: 'Dine In', icon: '🍽️', desc: 'Eat at restaurant' },
                  { type: 'TAKE_AWAY', label: 'Take Away', icon: '🛍️', desc: 'Pick-up / Takeout' },
                  { type: 'DELIVERY', label: 'Delivery', icon: '🛵', desc: 'Rider dispatch' },
                ] as const
              ).map((opt) => {
                const isActive = orderType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => {
                      setOrderType(opt.type);
                    }}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: `2px solid ${isActive ? 'var(--primary)' : 'var(--border-color)'}`,
                      background: isActive
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(59, 130, 246, 0.15))'
                        : 'rgba(0, 0, 0, 0.2)',
                      color: isActive ? '#fff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isActive ? '0 0 16px rgba(99, 102, 241, 0.3)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: '20px', marginBottom: '2px' }}>{opt.icon}</span>
                    <span style={{ fontWeight: 800, fontSize: '13px' }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contextual Order Metadata Inputs */}
          {orderType === 'DINE_IN' && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Optional: Seat, Table #, or Guest Tag (e.g. Patio 2, Seat 4)..."
                value={dineInTag}
                onChange={(e) => setDineInTag(e.target.value)}
                style={{ fontSize: '13px', padding: '8px 12px' }}
              />
            </div>
          )}

          {orderType === 'TAKE_AWAY' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Customer Name / Token # (Optional)..."
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{ fontSize: '13px', padding: '8px 12px' }}
              />
              <input
                type="tel"
                className="form-input"
                placeholder="Customer Phone (Optional)..."
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                style={{ fontSize: '13px', padding: '8px 12px' }}
              />
            </div>
          )}

          {orderType === 'DELIVERY' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Customer Name *"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  style={{ fontSize: '13px', padding: '8px 12px' }}
                />
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Contact Phone *"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  style={{ fontSize: '13px', padding: '8px 12px' }}
                />
              </div>
              <input
                type="text"
                className="form-input"
                placeholder="🛵 Delivery Drop-off Address / Landmark..."
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                style={{ fontSize: '13px', padding: '8px 12px' }}
              />
            </div>
          )}
        </div>

        {/* Search & Category Pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="🔍 Search PKR menu items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {menuCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`btn btn-sm ${
                  selectedCategory === cat ? 'btn-primary' : 'btn-secondary'
                }`}
                style={{ flexShrink: 0 }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Menu Items Grid */}
        <div className="menu-grid">
          {filteredItems.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '50px 20px',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>🍽️</div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>No items match your filter</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                Manage or add dishes from the "Menu & Recipes" management page.
              </div>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isAvailable = !item.is86d && item.isAvailable;
              const visual = getCategoryVisual(item.category);

              return (
                <div
                  key={item.id}
                  className={`menu-card ${!isAvailable ? 'unavailable' : ''}`}
                  onClick={() => isAvailable && addToCart(item)}
                  style={{
                    opacity: isAvailable ? 1 : 0.6,
                    cursor: isAvailable ? 'pointer' : 'not-allowed',
                  }}
                >
                  {/* Dish Image / Visual Banner */}
                  <div className="menu-card-image-wrap">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="menu-card-img"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="menu-card-placeholder"
                        style={{ background: visual.gradient }}
                      >
                        <span>{visual.icon}</span>
                      </div>
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        background: 'rgba(15, 23, 42, 0.85)',
                        backdropFilter: 'blur(4px)',
                        color: '#38bdf8',
                        fontWeight: 800,
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                      }}
                    >
                      {formatPKR(item.price)}
                    </span>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 700, lineHeight: '1.3' }}>{item.name}</h4>
                    </div>
                    {item.description && (
                      <p
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          lineHeight: '1.3',
                          marginBottom: '8px',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {item.description}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      ⏱️ {item.preparationTime || 10}m
                    </span>
                    {isAvailable ? (
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(item);
                        }}
                      >
                        + Add
                      </button>
                    ) : (
                      <span className="badge badge-danger" style={{ fontSize: '10px' }}>
                        86'd (Out)
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Cart & Settlement Sidebar */}
      <div className="pos-cart-sidebar">
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800 }}>Order Cart</h3>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#38bdf8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '2px',
              }}
            >
              {getOrderTypeIcon(orderType)} {getOrderReferenceString()}
            </span>
          </div>
          {cart.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setCart([])}>
              Clear
            </button>
          )}
        </div>

        {/* Cart Items List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛒</div>
              <p style={{ fontWeight: 600 }}>Cart is empty</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>Click any menu dish to start order</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.menuItemId}
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{item.name}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {formatPKR(item.price * item.quantity)}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {formatPKR(item.price)} ea
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 8px', height: '26px' }}
                      onClick={() => updateQuantity(item.menuItemId, -1)}
                    >
                      -
                    </button>
                    <span style={{ fontWeight: 700, fontSize: '14px', minWidth: '18px', textAlign: 'center' }}>
                      {item.quantity}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 8px', height: '26px' }}
                      onClick={() => updateQuantity(item.menuItemId, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Kitchen instructions per item */}
                <input
                  type="text"
                  placeholder="Item note (e.g. extra sauce, no pickles)..."
                  value={item.notes || ''}
                  onChange={(e) => updateItemNotes(item.menuItemId, e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            ))
          )}
        </div>

        {/* Order Notes */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-color)' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Special kitchen instructions for order..."
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
          />
        </div>

        {/* DINE IN CONTROLS: Tax Percentage (initially 0) + Service Charges (flat PKR number input) */}
        {orderType === 'DINE_IN' && (
          <div className="charge-control-card">
            {/* Tax (%) Input Field */}
            <div>
              <div className="charge-control-row" style={{ marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  🏛️ Tax Rate (%):
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8' }}>
                  {taxRate}% {tax > 0 ? `(${formatPKR(tax)})` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    className="form-input"
                    style={{ padding: '6px 28px 6px 10px', fontSize: '13px', fontWeight: 700 }}
                    placeholder="0"
                    value={taxRate === 0 ? '' : taxRate}
                    onChange={(e) => setTaxRate(Math.max(0, parseFloat(e.target.value) || 0))}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontWeight: 700,
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  >
                    %
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[0, 5, 13, 16].map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`btn btn-sm ${taxRate === p ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '4px 7px', fontSize: '11px', fontWeight: 700 }}
                      onClick={() => setTaxRate(p)}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Service Charges (Flat PKR) Input Field */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
              <div className="charge-control-row" style={{ marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  🛎️ Service Charges (PKR):
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#a855f7' }}>
                  {formatPKR(serviceCharge)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    className="form-input"
                    style={{ padding: '6px 42px 6px 10px', fontSize: '13px', fontWeight: 700 }}
                    placeholder="0"
                    value={serviceChargeAmount === 0 ? '' : serviceChargeAmount}
                    onChange={(e) => setServiceChargeAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontWeight: 700,
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  >
                    PKR
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[0, 100, 200, 300].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`btn btn-sm ${serviceChargeAmount === amt ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '4px 6px', fontSize: '11px', fontWeight: 700 }}
                      onClick={() => setServiceChargeAmount(amt)}
                    >
                      {amt === 0 ? '0' : `${amt}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DELIVERY CONTROLS: Delivery Charges (Flat PKR number input) */}
        {orderType === 'DELIVERY' && (
          <div className="charge-control-card">
            <div className="charge-control-row" style={{ marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                🛵 Delivery Charges (PKR):
              </span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8' }}>
                {formatPKR(deliveryCharge)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="number"
                  min="0"
                  step="10"
                  className="form-input"
                  style={{ padding: '6px 42px 6px 10px', fontSize: '13px', fontWeight: 700 }}
                  placeholder="0"
                  value={deliveryChargeAmount === 0 ? '' : deliveryChargeAmount}
                  onChange={(e) => setDeliveryChargeAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontWeight: 700,
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                >
                  PKR
                </span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[0, 100, 150, 200].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    className={`btn btn-sm ${deliveryChargeAmount === amt ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '4px 6px', fontSize: '11px', fontWeight: 700 }}
                    onClick={() => setDeliveryChargeAmount(amt)}
                  >
                    {amt === 0 ? 'Free' : `${amt}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Financial Summary */}
        <div
          style={{
            padding: '14px 20px',
            background: 'var(--bg-box-alt)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span>Subtotal</span>
            <span>{formatPKR(subtotal)}</span>
          </div>

          {orderType === 'DINE_IN' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <span>Tax ({taxRate}%)</span>
                <span style={{ color: tax > 0 ? '#38bdf8' : 'inherit', fontWeight: tax > 0 ? 700 : 400 }}>
                  {formatPKR(tax)}
                </span>
              </div>
              {serviceCharge > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  <span>Service Charges</span>
                  <span style={{ color: '#a855f7', fontWeight: 700 }}>{formatPKR(serviceCharge)}</span>
                </div>
              )}
            </>
          )}

          {orderType === 'DELIVERY' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span>Delivery Charges</span>
              <span style={{ color: deliveryCharge > 0 ? '#38bdf8' : 'inherit', fontWeight: deliveryCharge > 0 ? 700 : 400 }}>
                {formatPKR(deliveryCharge)}
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '18px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              paddingTop: '6px',
              borderTop: '1px dashed var(--border-color)',
            }}
          >
            <span>Total</span>
            <span style={{ color: '#10b981' }}>{formatPKR(total)}</span>
          </div>
        </div>

        {/* Order Submission Actions */}
        <div style={{ padding: '14px 20px', display: 'flex', gap: '10px' }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1 }}
            disabled={cart.length === 0}
            onClick={() => handleSubmitOrder(true)}
            title="Create order and print dual Customer & Kitchen slips"
          >
            🍳 Send & Print Slips
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1.2 }}
            disabled={cart.length === 0}
            onClick={handleOpenCashModal}
          >
            💵 Pay Cash ({formatPKR(total)})
          </button>
        </div>
      </div>

      {/* Cash Payment Quick Settlement Modal (PKR) */}
      {cashModalOpen && (
        <div className="modal-overlay" onClick={() => setCashModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">💵 Cash Payment Settlement</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCashModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {getOrderTypeIcon(orderType)} {getOrderTypeLabel(orderType)} Total Due (PKR)
                </div>
                <div style={{ fontSize: '32px', fontWeight: 800, color: '#34d399' }}>
                  {formatPKR(total)}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Cash Received (PKR)</label>
                <input
                  type="number"
                  step="10"
                  className="form-input"
                  style={{ fontSize: '20px', fontWeight: 700, textAlign: 'center' }}
                  value={cashTendered}
                  onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* Quick PKR Bill Denominations */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '14px 0' }}>
                {[100, 500, 1000, 5000].map((bill) => (
                  <button
                    key={bill}
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontWeight: 700, fontSize: '12px' }}
                    onClick={() => setCashTendered(bill)}
                  >
                    PKR {bill}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', marginBottom: '16px' }}
                onClick={() => setCashTendered(total)}
              >
                Exact Cash ({formatPKR(total)})
              </button>

              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600 }}>Change Returned:</span>
                <span
                  style={{
                    fontSize: '20px',
                    fontWeight: 800,
                    color: cashTendered >= total ? '#fbbf24' : 'var(--danger)',
                  }}
                >
                  {formatPKR(Math.max(0, cashTendered - total))}
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCashModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-success btn-lg"
                style={{ flex: 1 }}
                disabled={cashTendered < total}
                onClick={() => handleCompleteCashPayment(cashTendered)}
              >
                ✓ Settle & Print Slips
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dual Printable Receipt & Kitchen Ticket Modal */}
      <ReceiptModal
        isOpen={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        receiptData={receiptData}
        defaultTab={defaultReceiptTab}
      />
    </div>
  );
};

export default PosPage;
