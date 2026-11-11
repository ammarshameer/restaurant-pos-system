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
import { dealApi } from '../api/deal.api';
import { Deal } from '../types/deal.types';
import { getCategoryVisual } from '../utils/image';
import { uuid } from '../lib/offline/id';
import { customerApi, Customer } from '../api/customer.api';
import { paymentApi } from '../api/payment.api';
import CustomerPicker, { CustomerPickerValue } from '../components/CustomerPicker';

export type OrderType = 'DINE_IN' | 'TAKE_AWAY' | 'DELIVERY';

/**
 * Generates a locally-unique, human-friendly order number. A persistent
 * counter keeps numbers from colliding between consecutive offline orders on
 * the same terminal; the server remains authoritative and will reassign if
 * two terminals happen to produce the same number.
 */
function nextLocalOrderNumber(): number {
  try {
    const key = 'pos_order_seq';
    const current = parseInt(localStorage.getItem(key) || '0', 10) || 0;
    const next = current + 1;
    localStorage.setItem(key, String(next));
    return 100 + (next % 900);
  } catch {
    return Math.floor(Math.random() * 900) + 100;
  }
}

interface CartItem {
  id: string;
  menuItemId?: string;
  dealId?: string;
  isDeal?: boolean;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  dealComponents?: string[];
}

export const PosPage: React.FC = () => {
  const dispatch = useDispatch();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const menuItems = useSelector((state: RootState) => state.menu.items);
  const menuCategories = useSelector((state: RootState) => state.menu.categories);
  const [deals, setDeals] = useState<Deal[]>([]);

  // Sync menu items & active deals from Database on mount
  useEffect(() => {
    const fetchDbData = async () => {
      try {
        const [dbItems, activeDeals] = await Promise.all([
          menuApi.getMenu(),
          dealApi.getActiveDeals(),
        ]);
        if (dbItems && dbItems.length > 0) {
          dispatch(setMenuItems(dbItems));
        }
        if (activeDeals) {
          setDeals(activeDeals);
        }
      } catch (err) {
        console.warn('Failed to load menu or deals:', err);
      }
    };
    fetchDbData();
  }, [dispatch]);

  // Order Type state: DINE_IN | TAKE_AWAY | DELIVERY
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');

  // Order Type contextual metadata
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [dineInTag, setDineInTag] = useState('');

  const handleCustomerChange = (value: CustomerPickerValue) => {
    setCustomerName(value.name);
    setCustomerPhone(value.phone);
    setSelectedCustomerId(value.customerId);
  };

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
  const [cashSettleToCredit, setCashSettleToCredit] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  // Credit / Udhaar checkout modal state
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [creditAdvanceAmount, setCreditAdvanceAmount] = useState<number>(0);
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<Customer | null>(null);
  const [creditCustomerSearch, setCreditCustomerSearch] = useState('');
  const [creditCustomerList, setCreditCustomerList] = useState<Customer[]>([]);
  const [newCreditName, setNewCreditName] = useState('');
  const [newCreditPhone, setNewCreditPhone] = useState('');

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

  const isDealsTab = selectedCategory === '🎁 Deals & Combos';

  const filteredDeals = deals.filter((deal) => {
    const matchesCategory = selectedCategory === 'All' || isDealsTab;
    const matchesSearch =
      deal.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (deal.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (deal.dealItems || []).some((di) =>
        (di.menuItem?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesCategory && matchesSearch;
  });

  const filteredItems = isDealsTab
    ? []
    : menuItems.filter((item) => {
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
      const existing = prev.find((i) => !i.isDeal && i.menuItemId === item.id);
      if (existing) {
        return prev.map((i) =>
          !i.isDeal && i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          id: `menu-${item.id}`,
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
        },
      ];
    });
  };

  const addDealToCart = (deal: Deal) => {
    if (!deal.isActive) {
      setNotification(`⚠️ "${deal.name}" is currently inactive.`);
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.isDeal && i.dealId === deal.id);
      if (existing) {
        return prev.map((i) =>
          i.isDeal && i.dealId === deal.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      const dealComponents =
        deal.dealItems?.map(
          (di) => `${di.quantity}x ${di.menuItem?.name || 'Item'}`
        ) || [];
      return [
        ...prev,
        {
          id: `deal-${deal.id}`,
          dealId: deal.id,
          isDeal: true,
          name: deal.name,
          price: deal.price,
          quantity: 1,
          dealComponents,
        },
      ];
    });
  };

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id === cartItemId || item.menuItemId === cartItemId || item.dealId === cartItemId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const updateItemNotes = (cartItemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((i) =>
        i.id === cartItemId || i.menuItemId === cartItemId || i.dealId === cartItemId
          ? { ...i, notes }
          : i
      )
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

  const handleSubmitOrder = async (autoPrintBoth = true) => {
    if (cart.length === 0 || isSubmittingOrder) return;
    setIsSubmittingOrder(true);

    try {
      const orderNum = nextLocalOrderNumber();
      const orderId = uuid();
      const orderRef = getOrderReferenceString();

      const newOrder: any = {
        id: orderId,
        clientId: orderId,
        orderNumber: orderNum,
        orderType,
        orderTypeLabel: getOrderTypeLabel(orderType),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerId: selectedCustomerId || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        dineInTag: dineInTag.trim() || undefined,
        server: authUser || { firstName: 'Alex', lastName: 'Morgan' },
        items: cart.map((c) => ({
          id: `oi-${Math.random().toString(36).substring(2, 7)}`,
          menuItemId: c.menuItemId || undefined,
          dealId: c.dealId || undefined,
          isDeal: Boolean(c.isDeal),
          dealComponents: c.dealComponents,
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
        totalPaid: 0,
        amountDue: total,
        notes: orderNotes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const socket = socketClient.getSocket();
      if (socket) {
        socket.emit('order:create', newOrder);
      }

      dispatch(addOrder(newOrder));
      dispatch(setCurrentOrder(newOrder));

      const created = await orderApi.createOrder(newOrder);
      const resolvedOrderId = created?.id || orderId;
      const resolvedOrderNum = created?.orderNumber || orderNum;

      setNotification(
        `✅ Order #${resolvedOrderNum} (${getOrderTypeIcon(orderType)} ${getOrderTypeLabel(orderType)}) sent to kitchen & saved!`
      );
      setTimeout(() => setNotification(null), 4000);

      const receipt: ReceiptData = {
        orderNumber: resolvedOrderNum,
        orderId: resolvedOrderId,
        date: new Date(),
        orderType: getOrderTypeLabel(orderType),
        server: authUser ? `${authUser.firstName} ${authUser.lastName}` : 'Alex Morgan',
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        notes: [
          orderNotes ? `Kitchen Note: ${orderNotes}` : '',
          deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
          dineInTag ? `Seat/Tag: ${dineInTag}` : '',
        ]
          .filter(Boolean)
          .join(' • '),
        items: cart.map((c) => ({
          name: c.isDeal ? `🎁 ${c.name}` : c.name,
          isDeal: Boolean(c.isDeal),
          dealComponents: c.dealComponents,
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
        totalPaid: 0,
        amountDue: total,
        change: 0,
        paymentMethod: `DIRECT / ${getOrderTypeLabel(orderType).toUpperCase()}`,
      };

      setReceiptData(receipt);
      setDefaultReceiptTab('BOTH');
      setReceiptOpen(true);

      setCart([]);
      setOrderNotes('');
      setCustomerName('');
      setCustomerPhone('');
      setSelectedCustomerId(null);
      setDeliveryAddress('');
      setDineInTag('');
    } catch (err: any) {
      console.error('Order creation error:', err);
      setNotification(`⚠️ Failed to create order: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleOpenCashModal = () => {
    setCashTendered(Math.ceil(total));
    setCashSettleToCredit(false);
    setCashModalOpen(true);
  };

  const handleCompleteCashPayment = async (tendered: number) => {
    if (cart.length === 0 || isSubmittingOrder) return;
    setIsSubmittingOrder(true);

    try {
      const orderNum = nextLocalOrderNumber();
      const orderId = uuid();
      const payAmount = Math.min(tendered, total);
      const change = Math.max(0, tendered - total);
      const isSettlingUdhaar = tendered < total && cashSettleToCredit;

      // If settling remainder to credit, customer is required
      let effectiveCustomerId = selectedCustomerId;
      if (isSettlingUdhaar && !effectiveCustomerId) {
        if (!customerName.trim()) {
          setNotification('⚠️ Customer name is required to settle balance to Udhaar / Credit');
          setIsSubmittingOrder(false);
          return;
        }
        try {
          const newCust = await customerApi.create({
            name: customerName.trim(),
            phone: customerPhone.trim() || undefined,
          });
          effectiveCustomerId = newCust.id;
          setSelectedCustomerId(newCust.id);
        } catch (e: any) {
          // If customer already exists, backend will link them in createOrder
        }
      }

      const newOrder: any = {
        id: orderId,
        clientId: orderId,
        orderNumber: orderNum,
        orderType,
        orderTypeLabel: getOrderTypeLabel(orderType),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerId: effectiveCustomerId || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        dineInTag: dineInTag.trim() || undefined,
        server: authUser || { firstName: 'Alex', lastName: 'Morgan' },
        items: cart.map((c) => ({
          id: `oi-${Math.random().toString(36).substring(2, 7)}`,
          menuItemId: c.menuItemId || undefined,
          dealId: c.dealId || undefined,
          isDeal: Boolean(c.isDeal),
          dealComponents: c.dealComponents,
          name: c.name,
          quantity: c.quantity,
          price: c.price,
          notes: c.notes,
          status: 'PENDING',
        })),
        status: 'confirmed',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        totalPaid: 0,
        amountDue: total,
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

      // 1. Create order in DB first
      const created = await orderApi.createOrder(newOrder);
      const resolvedOrderId = created?.id || orderId;
      const resolvedOrderNum = created?.orderNumber || orderNum;

      // 2. Call POST /api/payments as single source of truth for payment collection
      let customerBalance: number | undefined;
      try {
        const payRes: any = await paymentApi.createPayment({
          orderId: resolvedOrderId,
          amount: payAmount,
          method: 'CASH',
          tipAmount: 0,
          settleToCredit: isSettlingUdhaar,
          note: isSettlingUdhaar ? `POS Partial Cash (PKR ${payAmount}) + Udhaar remainder` : undefined,
        });
        customerBalance = payRes?.customerBalance;
      } catch (payErr: any) {
        console.error('Payment settlement error:', payErr);
        setNotification(`⚠️ Payment error: ${payErr?.response?.data?.error || payErr?.message || 'Failed to record payment'}`);
      }

      const remainingAmountDue = isSettlingUdhaar ? 0 : Math.max(0, +(total - payAmount).toFixed(2));

      const receipt: ReceiptData = {
        orderNumber: resolvedOrderNum,
        orderId: resolvedOrderId,
        date: new Date(),
        orderType: getOrderTypeLabel(orderType),
        server: authUser ? `${authUser.firstName} ${authUser.lastName}` : 'Alex Morgan',
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        notes: [
          orderNotes ? `Kitchen Note: ${orderNotes}` : '',
          deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
          dineInTag ? `Seat/Tag: ${dineInTag}` : '',
        ]
          .filter(Boolean)
          .join(' • '),
        items: cart.map((c) => ({
          name: c.isDeal ? `🎁 ${c.name}` : c.name,
          isDeal: Boolean(c.isDeal),
          dealComponents: c.dealComponents,
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
        totalPaid: payAmount,
        amountDue: remainingAmountDue,
        settledToCredit: isSettlingUdhaar,
        balanceDue: customerBalance,
        change,
        paymentMethod: payAmount >= total ? 'CASH' : isSettlingUdhaar ? 'CASH + UDHAAR' : 'CASH (PARTIAL)',
      };

      setReceiptData(receipt);
      setCashModalOpen(false);
      setDefaultReceiptTab('BOTH');
      setReceiptOpen(true);
      setCart([]);
      setOrderNotes('');
      setCustomerName('');
      setCustomerPhone('');
      setSelectedCustomerId(null);
      setDeliveryAddress('');
      setDineInTag('');
    } catch (err: any) {
      console.error('Order/Payment error:', err);
      setNotification(`⚠️ Checkout error: ${err?.message || 'Failed to process order'}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleOpenCreditModal = () => {
    setCreditAdvanceAmount(0);
    setNewCreditName(customerName || '');
    setNewCreditPhone(customerPhone || '');
    setSelectedCreditCustomer(null);
    setCreditCustomerSearch('');
    setCreditModalOpen(true);
  };

  const handleCompleteCreditPayment = async () => {
    if (cart.length === 0 || isSubmittingOrder) return;
    setIsSubmittingOrder(true);

    try {
      let targetCustomerId = selectedCreditCustomer?.id || selectedCustomerId;
      const targetName = (selectedCreditCustomer?.name || newCreditName || customerName).trim();
      const targetPhone = (selectedCreditCustomer?.phone || newCreditPhone || customerPhone).trim();

      if (!targetCustomerId) {
        if (!targetName) {
          setNotification('⚠️ Customer Name is required for Udhaar / Credit');
          setIsSubmittingOrder(false);
          return;
        }
        try {
          const newCust = await customerApi.create({
            name: targetName,
            phone: targetPhone || undefined,
          });
          targetCustomerId = newCust.id;
        } catch (e: any) {
          // If customer with phone already exists, continue with name/phone on order
        }
      }

      const orderNum = nextLocalOrderNumber();
      const orderId = uuid();
      const advanceAmount = Math.max(0, Math.min(creditAdvanceAmount, total));

      const newOrder: any = {
        id: orderId,
        clientId: orderId,
        orderNumber: orderNum,
        orderType,
        orderTypeLabel: getOrderTypeLabel(orderType),
        customerName: targetName || undefined,
        customerPhone: targetPhone || undefined,
        customerId: targetCustomerId || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        dineInTag: dineInTag.trim() || undefined,
        server: authUser || { firstName: 'Alex', lastName: 'Morgan' },
        items: cart.map((c) => ({
          id: `oi-${Math.random().toString(36).substring(2, 7)}`,
          menuItemId: c.menuItemId || undefined,
          dealId: c.dealId || undefined,
          isDeal: Boolean(c.isDeal),
          dealComponents: c.dealComponents,
          name: c.name,
          quantity: c.quantity,
          price: c.price,
          notes: c.notes,
          status: 'PENDING',
        })),
        status: 'confirmed',
        paymentStatus: 'UNPAID',
        paymentMethod: advanceAmount > 0 ? 'CASH + UDHAAR' : 'UDHAAR / CREDIT',
        totalPaid: 0,
        amountDue: total,
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

      // 1. Create order
      const created = await orderApi.createOrder(newOrder);
      const resolvedOrderId = created?.id || orderId;
      const resolvedOrderNum = created?.orderNumber || orderNum;

      // 2. Call paymentApi with settleToCredit: true
      const payRes: any = await paymentApi.createPayment({
        orderId: resolvedOrderId,
        amount: advanceAmount,
        method: 'CASH',
        tipAmount: 0,
        settleToCredit: true,
        note: `POS Udhaar order settlement (Advance: PKR ${advanceAmount})`,
      });

      const receipt: ReceiptData = {
        orderNumber: resolvedOrderNum,
        orderId: resolvedOrderId,
        date: new Date(),
        orderType: getOrderTypeLabel(orderType),
        server: authUser ? `${authUser.firstName} ${authUser.lastName}` : 'Alex Morgan',
        customerName: targetName || undefined,
        customerPhone: targetPhone || undefined,
        notes: [
          orderNotes ? `Kitchen Note: ${orderNotes}` : '',
          deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
          dineInTag ? `Seat/Tag: ${dineInTag}` : '',
        ]
          .filter(Boolean)
          .join(' • '),
        items: cart.map((c) => ({
          name: c.isDeal ? `🎁 ${c.name}` : c.name,
          isDeal: Boolean(c.isDeal),
          dealComponents: c.dealComponents,
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
        totalPaid: advanceAmount,
        amountDue: 0, // fully settled to credit
        settledToCredit: true,
        balanceDue: payRes?.customerBalance,
        change: 0,
        paymentMethod: advanceAmount > 0 ? 'CASH + UDHAAR' : 'UDHAAR / CREDIT',
      };

      setReceiptData(receipt);
      setCreditModalOpen(false);
      setDefaultReceiptTab('BOTH');
      setReceiptOpen(true);
      setCart([]);
      setOrderNotes('');
      setCustomerName('');
      setCustomerPhone('');
      setSelectedCustomerId(null);
      setDeliveryAddress('');
      setDineInTag('');
    } catch (err: any) {
      console.error('Credit settlement error:', err);
      setNotification(`⚠️ Udhaar error: ${err?.response?.data?.error || err?.message || 'Failed to process'}`);
    } finally {
      setIsSubmittingOrder(false);
    }
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
              background: 'linear-gradient(135deg, rgba(var(--primary-rgb), 0.2), rgba(16, 185, 129, 0.2))',
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
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: '', letterSpacing: '0.05em' }}>
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
                      position: 'relative',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: isActive
                        ? '2px solid var(--primary)'
                        : '1px solid var(--border-color)',
                      background: isActive
                        ? 'linear-gradient(135deg, var(--accent), var(--primary))'
                        : 'var(--bg-tertiary)',
                      color: isActive ? '#000' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isActive ? '0 6px 18px var(--primary-glow)' : 'none',
                      transform: isActive ? 'translateY(-1px)' : 'none',
                      opacity: isActive ? 1 : 0.9,
                    }}
                  >
                    {isActive && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '8px',
                          fontSize: '12px',
                          color: '#000',
                          lineHeight: 1,
                        }}
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    )}
                    <span style={{ fontSize: '20px', marginBottom: '2px' }}>{opt.icon}</span>
                    <span
                      style={{
                        fontWeight: isActive ? 900 : 600,
                        fontSize: '13px',
                        color: isActive ? '#000' : 'var(--text-secondary)',
                        letterSpacing: isActive ? '0.01em' : 0,
                      }}
                    >
                      {opt.label}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        marginTop: '2px',
                        fontWeight: 600,
                        color: isActive ? 'rgba(255, 255, 255, 0.82)' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contextual Order Metadata Inputs */}
          {orderType === 'DINE_IN' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <CustomerPicker
                name={customerName}
                phone={customerPhone}
                selectedCustomerId={selectedCustomerId}
                onChange={handleCustomerChange}
                onNotify={setNotification}
                namePlaceholder="Customer Name (Optional)..."
                phonePlaceholder="Mobile Number (Optional)..."
              />
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
            <CustomerPicker
              name={customerName}
              phone={customerPhone}
              selectedCustomerId={selectedCustomerId}
              onChange={handleCustomerChange}
              onNotify={setNotification}
              namePlaceholder="Customer Name / Token # (Optional)..."
              phonePlaceholder="Customer Phone (Optional)..."
            />
          )}

          {orderType === 'DELIVERY' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <CustomerPicker
                name={customerName}
                phone={customerPhone}
                selectedCustomerId={selectedCustomerId}
                onChange={handleCustomerChange}
                onNotify={setNotification}
                namePlaceholder="Customer Name *"
                phonePlaceholder="Contact Phone *"
                required
              />
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
            {['All', '🎁 Deals & Combos', ...menuCategories.filter((c) => c !== 'All')].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`btn btn-sm ${
                  selectedCategory === cat ? 'btn-primary' : 'btn-secondary'
                }`}
                style={{
                  flexShrink: 0,
                  background:
                    cat === '🎁 Deals & Combos' && selectedCategory === cat
                      ? 'linear-gradient(135deg, var(--primary), var(--accent))'
                      : undefined,
                  borderColor:
                    cat === '🎁 Deals & Combos' ? 'var(--accent)' : undefined,
                  fontWeight: cat === '🎁 Deals & Combos' ? 700 : 500,
                }}
              >
                {cat} {cat === '🎁 Deals & Combos' && deals.length > 0 ? `(${deals.length})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Menu Items & Deals Grid */}
        <div className="menu-grid">
          {filteredDeals.length === 0 && filteredItems.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '50px 20px',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>🍽️</div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>No menu items or deals match your filter</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                Manage dishes in "Menu & Recipes" or combo packages in "Deals & Combos".
              </div>
            </div>
          ) : (
            <>
              {/* Active Deals Cards */}
              {filteredDeals.map((deal) => {
                const totalIncluded = (deal.dealItems || []).reduce((s, di) => s + di.quantity, 0);
                return (
                  <div
                    key={`pos-deal-${deal.id}`}
                    className="menu-card"
                    onClick={() => addDealToCart(deal)}
                    style={{
                      cursor: 'pointer',
                      border: '1px solid rgba(var(--primary-rgb), 0.4)',
                      background: 'linear-gradient(180deg, rgba(var(--primary-rgb), 0.08) 0%, var(--bg-card) 100%)',
                      position: 'relative',
                    }}
                  >
                    {/* Deal Image / Visual Banner */}
                    <div className="menu-card-image-wrap">
                      {deal.imageUrl ? (
                        <img
                          src={deal.imageUrl}
                          alt={deal.name}
                          className="menu-card-img"
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="menu-card-placeholder"
                          style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)' }}
                        >
                          <span style={{ fontSize: '32px' }}>🎁</span>
                        </div>
                      )}
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          background: 'var(--bg-overlay)',
                          backdropFilter: 'blur(4px)',
                          color: '#34d399',
                          fontWeight: 800,
                          fontSize: '12px',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(52, 211, 153, 0.4)',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                        }}
                      >
                        {formatPKR(deal.price)}
                      </span>
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          left: '6px',
                          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: 'var(--radius-sm)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        🎁 COMBO DEAL
                      </span>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <h4 style={{ fontSize: '14px', fontWeight: 700, lineHeight: '1.3' }}>{deal.name}</h4>
                      </div>
                      {deal.description && (
                        <p
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            lineHeight: '1.3',
                            marginBottom: '6px',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {deal.description}
                        </p>
                      )}

                      {/* Included Items Badges */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0 8px 0' }}>
                        {(deal.dealItems || []).map((di, dIdx) => (
                          <span
                            key={dIdx}
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              background: 'rgba(255, 255, 255, 0.06)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              padding: '2px 5px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {di.quantity}x {di.menuItem?.name || 'Item'}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                      <span style={{ fontSize: '11px', color: '#a5b4fc', fontWeight: 600 }}>
                        🍱 {totalIncluded} Items Included
                      </span>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                          border: 'none',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          addDealToCart(deal);
                        }}
                      >
                        + Add Combo
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Standard Menu Item Cards */}
              {filteredItems.map((item) => {
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
                          background: 'var(--bg-overlay)',
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
              })}
            </>
          )}
        </div>
      </div>

      {/* Cart & Settlement Sidebar */}
      <div className="pos-cart-sidebar">
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 800 }}>Order Cart</h3>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#38bdf8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '1px',
              }}
            >
              {getOrderTypeIcon(orderType)} {getOrderReferenceString()}
            </span>
          </div>
          {cart.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setCart([])} style={{ padding: '2px 8px', fontSize: '11px' }}>
              Clear
            </button>
          )}
        </div>

        {/* Cart Items List - Independently Scrollable */}
        <div
          className="pos-cart-items-list"
          style={{
            flex: '1 1 0%',
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 14px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>🛒</div>
              <p style={{ fontWeight: 600, fontSize: '13px' }}>Cart is empty</p>
              <p style={{ fontSize: '11px', marginTop: '2px' }}>Click any menu dish or combo deal to start order</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                style={{
                  background: item.isDeal ? 'rgba(var(--primary-rgb), 0.08)' : 'var(--bg-secondary)',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: item.isDeal ? '1px solid rgba(var(--primary-rgb), 0.35)' : '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {item.isDeal && <span style={{ fontSize: '13px' }}>🎁</span>}
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{item.name}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '13px' }}>
                    {formatPKR(item.price * item.quantity)}
                  </span>
                </div>

                {item.dealComponents && item.dealComponents.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', paddingLeft: '4px', lineHeight: '1.3' }}>
                    {item.dealComponents.map((comp, cIdx) => (
                      <div key={cIdx}>↳ {comp}</div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {formatPKR(item.price)} ea {item.isDeal ? '(Combo Bundle)' : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 6px', height: '22px', fontSize: '12px' }}
                      onClick={() => updateQuantity(item.id, -1)}
                    >
                      -
                    </button>
                    <span style={{ fontWeight: 700, fontSize: '13px', minWidth: '18px', textAlign: 'center' }}>
                      {item.quantity}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 6px', height: '22px', fontSize: '12px' }}
                      onClick={() => updateQuantity(item.id, 1)}
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
                  onChange={(e) => updateItemNotes(item.id, e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '6px',
                    padding: '3px 6px',
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

        {/* Pinned Bottom Container: Notes, Charges, Summary & Checkout Buttons */}
        <div className="pos-cart-footer">
          {/* Order Notes */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-color)' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Special kitchen instructions for order..."
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              style={{ fontSize: '12px', padding: '6px 10px' }}
            />
          </div>

          {/* DINE IN CONTROLS: Tax Percentage (initially 0) + Service Charges (flat PKR number input) */}
          {orderType === 'DINE_IN' && (
            <div className="charge-control-card" style={{ padding: '8px 14px', gap: '6px' }}>
              {/* Tax (%) Input Field */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  🏛️ Tax:
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                  <div style={{ position: 'relative', width: '70px' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      className="form-input"
                      style={{ padding: '4px 20px 4px 6px', fontSize: '12px', fontWeight: 700, textAlign: 'right' }}
                      placeholder="0"
                      value={taxRate === 0 ? '' : taxRate}
                      onChange={(e) => setTaxRate(Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontWeight: 700,
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                      }}
                    >
                      %
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {[0, 5, 13, 16].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`btn btn-sm ${taxRate === p ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '2px 5px', fontSize: '10px', fontWeight: 700 }}
                        onClick={() => setTaxRate(p)}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Service Charges (Flat PKR) Input Field */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  🛎️ Service:
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                  <div style={{ position: 'relative', width: '85px' }}>
                    <input
                      type="number"
                      min="0"
                      step="10"
                      className="form-input"
                      style={{ padding: '4px 30px 4px 6px', fontSize: '12px', fontWeight: 700, textAlign: 'right' }}
                      placeholder="0"
                      value={serviceChargeAmount === 0 ? '' : serviceChargeAmount}
                      onChange={(e) => setServiceChargeAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontWeight: 700,
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                      }}
                    >
                      PKR
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {[0, 100, 200, 300].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className={`btn btn-sm ${serviceChargeAmount === amt ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '2px 5px', fontSize: '10px', fontWeight: 700 }}
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
            <div className="charge-control-card" style={{ padding: '8px 14px', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  🛵 Delivery:
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                  <div style={{ position: 'relative', width: '85px' }}>
                    <input
                      type="number"
                      min="0"
                      step="10"
                      className="form-input"
                      style={{ padding: '4px 30px 4px 6px', fontSize: '12px', fontWeight: 700, textAlign: 'right' }}
                      placeholder="0"
                      value={deliveryChargeAmount === 0 ? '' : deliveryChargeAmount}
                      onChange={(e) => setDeliveryChargeAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontWeight: 700,
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                      }}
                    >
                      PKR
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {[0, 100, 150, 200].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className={`btn btn-sm ${deliveryChargeAmount === amt ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '2px 5px', fontSize: '10px', fontWeight: 700 }}
                        onClick={() => setDeliveryChargeAmount(amt)}
                      >
                        {amt === 0 ? 'Free' : `${amt}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Financial Summary */}
          <div
            style={{
              padding: '8px 14px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>Subtotal</span>
              <span>{formatPKR(subtotal)}</span>
            </div>

            {orderType === 'DINE_IN' && (
              <>
                {taxRate > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <span>Tax ({taxRate}%)</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>{formatPKR(tax)}</span>
                  </div>
                )}
                {serviceCharge > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <span>Service Charges</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{formatPKR(serviceCharge)}</span>
                  </div>
                )}
              </>
            )}

            {orderType === 'DELIVERY' && deliveryCharge > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span>Delivery Charges</span>
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>{formatPKR(deliveryCharge)}</span>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '15px',
                fontWeight: 800,
                color: 'var(--text-primary)',
                paddingTop: '4px',
                borderTop: '1px dashed var(--border-color)',
              }}
            >
              <span>Total</span>
              <span style={{ color: '#10b981' }}>{formatPKR(total)}</span>
            </div>
          </div>

          {/* Order Submission Actions */}
          <div style={{ padding: '10px 14px', display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, padding: '8px 6px', fontSize: '11px', fontWeight: 700 }}
              disabled={cart.length === 0 || isSubmittingOrder}
              onClick={() => handleSubmitOrder(true)}
              title="Create order and print dual Customer & Kitchen slips"
            >
              🍳 Send & Print
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1.1, padding: '8px 6px', fontSize: '11px', fontWeight: 700, borderColor: '#f59e0b', color: '#f59e0b' }}
              disabled={cart.length === 0 || isSubmittingOrder}
              onClick={handleOpenCreditModal}
              title="Settle order to customer credit / Udhaar"
            >
              💳 Udhaar / Credit
            </button>
            <button
              className="btn btn-primary btn-sm"
              style={{ flex: 1.3, padding: '8px 8px', fontSize: '12px', fontWeight: 800 }}
              disabled={cart.length === 0 || isSubmittingOrder}
              onClick={handleOpenCashModal}
            >
              💵 Pay Cash ({formatPKR(total)})
            </button>
          </div>
        </div>
      </div>

      {/* Cash Payment Settlement Modal (Supports Partial & Settle to Credit) */}
      {cashModalOpen && (
        <div className="modal-overlay" onClick={() => setCashModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">💵 Cash Payment Settlement</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCashModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '10px 0' }}>
                {[100, 500, 1000, 5000].map((bill) => (
                  <button
                    key={bill}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontWeight: 700, fontSize: '12px' }}
                    onClick={() => setCashTendered(bill)}
                  >
                    PKR {bill}
                  </button>
                ))}
              </div>

              {/* Exact & Half Quick Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontWeight: 700 }}
                  onClick={() => setCashTendered(total)}
                >
                  Exact ({formatPKR(total)})
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontWeight: 700 }}
                  onClick={() => setCashTendered(Math.round(total / 2))}
                >
                  Half 50% ({formatPKR(Math.round(total / 2))})
                </button>
              </div>

              {/* Payment Summary / Partial / Change status */}
              {cashTendered >= total ? (
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Change Returned:</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#fbbf24' }}>
                    {formatPKR(cashTendered - total)}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#ef4444' }}>Remaining Amount Due:</span>
                    <span style={{ fontSize: '18px', fontWeight: 800, color: '#ef4444' }}>
                      {formatPKR(Math.max(0, +(total - cashTendered).toFixed(2)))}
                    </span>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={cashSettleToCredit}
                      onChange={(e) => setCashSettleToCredit(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    Add remaining balance to Customer Dues (Udhaar)
                  </label>

                  {cashSettleToCredit && (
                    <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                        Customer info required for Udhaar:
                      </div>
                      <CustomerPicker
                        name={customerName}
                        phone={customerPhone}
                        selectedCustomerId={selectedCustomerId}
                        onChange={handleCustomerChange}
                        onNotify={setNotification}
                        namePlaceholder="Customer Name *"
                        phonePlaceholder="Customer Phone"
                        required
                        compact
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCashModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-success btn-lg"
                style={{ flex: 1 }}
                disabled={isSubmittingOrder || (cashTendered <= 0 && !cashSettleToCredit)}
                onClick={() => handleCompleteCashPayment(cashTendered)}
              >
                {isSubmittingOrder
                  ? 'Processing...'
                  : cashTendered >= total
                  ? '✓ Pay Full & Print Slips'
                  : cashSettleToCredit
                  ? '✓ Pay Partial + Settle to Udhaar'
                  : '✓ Settle Partial Cash'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit / Udhaar Checkout Modal */}
      {creditModalOpen && (
        <div className="modal-overlay" onClick={() => setCreditModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">💳 Pay Later / Customer Credit (Udhaar)</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreditModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Order Total
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#f59e0b' }}>
                  {formatPKR(total)}
                </div>
              </div>

              {/* Customer selection / input */}
              <div className="form-group">
                <label className="form-label">Customer Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter or search customer name..."
                  value={selectedCreditCustomer ? selectedCreditCustomer.name : newCreditName}
                  onChange={(e) => {
                    setSelectedCreditCustomer(null);
                    setNewCreditName(e.target.value);
                  }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Customer Phone</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Mobile phone number..."
                  value={selectedCreditCustomer ? (selectedCreditCustomer.phone || '') : newCreditPhone}
                  onChange={(e) => {
                    setSelectedCreditCustomer(null);
                    setNewCreditPhone(e.target.value);
                  }}
                />
              </div>

              {/* Advance Cash Paid Now */}
              <div className="form-group">
                <label className="form-label">Advance Cash Paid Now (PKR)</label>
                <input
                  type="number"
                  step="10"
                  className="form-input"
                  style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center' }}
                  value={creditAdvanceAmount}
                  onChange={(e) => setCreditAdvanceAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => setCreditAdvanceAmount(0)}
                  >
                    PKR 0 (No Advance)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => setCreditAdvanceAmount(Math.round(total / 2))}
                  >
                    Half 50% ({formatPKR(Math.round(total / 2))})
                  </button>
                </div>
              </div>

              {/* Udhaar Calculation Breakdown */}
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '13px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Order Total:</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(total)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Advance Cash:</span>
                  <span style={{ fontWeight: 600, color: '#10b981' }}>- {formatPKR(creditAdvanceAmount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '6px', fontWeight: 700 }}>
                  <span style={{ color: '#ef4444' }}>To Customer Udhaar:</span>
                  <span style={{ color: '#ef4444' }}>{formatPKR(Math.max(0, +(total - creditAdvanceAmount).toFixed(2)))}</span>
                </div>
                {selectedCreditCustomer && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>Existing Balance:</span>
                    <span>{formatPKR(selectedCreditCustomer.balanceDue || 0)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCreditModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-warning btn-lg"
                style={{ flex: 1 }}
                disabled={isSubmittingOrder || (!selectedCreditCustomer && !newCreditName.trim())}
                onClick={handleCompleteCreditPayment}
              >
                {isSubmittingOrder ? 'Processing...' : '✓ Confirm & Settle to Udhaar'}
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
