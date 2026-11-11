import React, { useEffect, useState, useMemo } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from './store/store';
import { logout, loginSuccess } from './store/slices/authSlice';
import { setMenuItems } from './store/slices/menuSlice';
import { setOrders, updateOrder } from './store/slices/orderSlice';
import { menuApi } from './api/menu.api';
import { orderApi, mapOrderRecord } from './api/order.api';
import { socketClient } from './lib/socket';
import { syncEngine } from './lib/offline/syncEngine';
import { clearSession, exitSupportMode, getRefreshToken, getPlatformAccessToken, isSupportMode } from './lib/session';
import { api } from './lib/api';
import SyncStatusIndicator from './components/SyncStatusIndicator';
import RequirePermission from './components/RequirePermission';
import RequireFeature from './components/RequireFeature';
import { settingsApi } from './api/settings.api';
import { cacheReceiptBranding } from './lib/receiptBranding';
import { formatPersonName } from './utils/format';

// Tenant Pages
import LoginPage from './pages/LoginPage';
import PosPage from './pages/PosPage';
import SaleInvoicesPage from './pages/SaleInvoicesPage';
import KitchenPage from './pages/KitchenPage';
import MenuPage from './pages/MenuPage';
import InventoryPage from './pages/InventoryPage';
import EmployeesPage from './pages/EmployeesPage';
import PaymentsPage from './pages/PaymentsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DealsPage from './pages/DealsPage';
import RolesPage from './pages/RolesPage';
import SettingsPage from './pages/SettingsPage';
import ForbiddenPage from './pages/ForbiddenPage';
import CustomersPage from './pages/CustomersPage';
import CostingPage from './pages/CostingPage';
import DuesPage from './pages/DuesPage';

// Platform Pages
import PlatformLoginPage from './pages/PlatformLoginPage';
import PlatformDashboardPage from './pages/PlatformDashboardPage';

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  const [liveAlert, setLiveAlert] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);

  useEffect(() => {
    if (!isAuthenticated) return;
    void settingsApi.getBranding()
      .then((settings) => {
        cacheReceiptBranding(settings);
      })
      .catch(() => undefined);
  }, [isAuthenticated]);

  // Light and Dark Theme state & Palette state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('pos_theme') as 'dark' | 'light') || 'dark';
  });

  const [palette, setPalette] = useState<string>(() => {
    return localStorage.getItem('pos_palette') || 'espresso';
  });

  useEffect(() => {
    if (user?.themeMode && (user.themeMode === 'light' || user.themeMode === 'dark')) {
      setTheme(user.themeMode);
    }
    if (user?.themePalette) {
      setPalette(user.themePalette);
    }
  }, [user?.themeMode, user?.themePalette]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pos_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
    localStorage.setItem('pos_palette', palette);
  }, [palette]);

  useEffect(() => {
    const getVersion = window.electronAPI?.getVersion;
    if (getVersion) {
      void getVersion().then(setAppVersion).catch(() => undefined);
    }
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Restore stored auth session on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    if (storedToken && storedUser && !isAuthenticated) {
      try {
        const parsedUser = JSON.parse(storedUser);
        dispatch(loginSuccess({ user: parsedUser, token: storedToken }));
      } catch (e) {
        clearSession();
      }
    }
  }, [dispatch, isAuthenticated]);

  // Start offline sync engine for tenant orders
  useEffect(() => {
    if (!isAuthenticated) return;
    void syncEngine.init();
    const unsubscribe = syncEngine.onServerOrder(({ serverOrder }) => {
      if (!serverOrder) return;
      dispatch(updateOrder(mapOrderRecord(serverOrder)));
    });
    return () => unsubscribe();
  }, [dispatch, isAuthenticated]);

  // Hydrate Menu Items & Orders ONLY when authenticated
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!isAuthenticated || !token) return;

    const hydrateData = async () => {
      try {
        const [dbMenu, dbOrders] = await Promise.all([
          menuApi.getMenu(),
          orderApi.getAllOrders(),
        ]);
        if (dbMenu && dbMenu.length > 0) {
          dispatch(setMenuItems(dbMenu));
        }
        if (dbOrders && dbOrders.length > 0) {
          dispatch(setOrders(dbOrders));
        }
      } catch (e) {
        console.warn('Data hydration error:', e);
      }
    };
    hydrateData();
  }, [dispatch, isAuthenticated]);

  // Connect socket and listen for low stock alerts only when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      socketClient.disconnect();
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (token) {
      socketClient.connect(token);
      const socket = socketClient.getSocket();
      if (socket) {
        const handleAlert = (data: any) => {
          setLiveAlert(data.message || `⚠️ Low stock: ${data.name}`);
          setTimeout(() => setLiveAlert(null), 8000);
        };
        socket.on('inventory:alert', handleAlert);
        return () => {
          socket.off('inventory:alert', handleAlert);
        };
      }
    }
  }, [isAuthenticated]);

  const handleLogout = () => {
    socketClient.disconnect();
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    clearSession();
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  // Determine user's first permitted route
  const firstPermittedRoute = useMemo((): string => {
    if (!user) return '/login';
    const perms = new Set(user.permissions || []);
    if (user.isOwnerRole || perms.has('pos.use')) return '/pos';
    if (perms.has('kitchen.view')) return '/kitchen';
    if (perms.has('invoices.view') || perms.has('orders.view')) return '/invoices';
    if (perms.has('payments.view') || perms.has('payments.process')) return '/payments';
    if (perms.has('menu.view')) return '/menu';
    if (perms.has('deals.view')) return '/deals';
    if (perms.has('customers.view') || perms.has('customers.manage')) return '/customers';
    if (perms.has('inventory.view')) return '/inventory';
    if (perms.has('dues.view')) return '/dues';
    if (perms.has('costing.view')) return '/costing';
    if (perms.has('employees.view')) return '/employees';
    if (perms.has('roles.view') || perms.has('roles.manage')) return '/roles';
    if (perms.has('settings.manage')) return '/settings';
    if (perms.has('analytics.view')) return '/analytics';
    return '/pos';
  }, [user]);

  // Permission helpers for sidebar
  const isOwner = user?.isOwnerRole === true;
  const permsSet = useMemo(() => new Set(user?.permissions || []), [user]);

  const canSeePos = isOwner || permsSet.has('pos.use');
  const canSeeInvoices = isOwner || permsSet.has('invoices.view') || permsSet.has('orders.view');
  const canSeeKitchen = isOwner || permsSet.has('kitchen.view');
  const canSeePayments = isOwner || permsSet.has('payments.view') || permsSet.has('payments.process');
  const canSeeMenu = isOwner || permsSet.has('menu.view');
  const canSeeDeals = isOwner || permsSet.has('deals.view');
  const canSeeInventory = isOwner || permsSet.has('inventory.view');
  const canSeeCustomers = isOwner || permsSet.has('customers.view') || permsSet.has('customers.manage');
  const canSeeDues = isOwner || permsSet.has('dues.view');
  const canSeeCosting = (isOwner || permsSet.has('costing.view')) && user?.features?.includes('costing');
  const canSeeEmployees = isOwner || permsSet.has('employees.view');
  const canSeeRoles = isOwner || permsSet.has('roles.view') || permsSet.has('roles.manage');
  const canSeeSettings = isOwner || permsSet.has('settings.manage');
  const canSeeAnalytics = isOwner || permsSet.has('analytics.view');

  // ============================================
  // 1. PLATFORM ROUTE HANDLING
  // ============================================
  if (location.pathname === '/platform/login') {
    if (getPlatformAccessToken()) {
      return <Navigate to="/platform" replace />;
    }
    return <PlatformLoginPage />;
  }

  if (location.pathname.startsWith('/platform')) {
    const platformToken = getPlatformAccessToken();
    if (!platformToken) {
      return <Navigate to="/platform/login" replace />;
    }
    return <PlatformDashboardPage />;
  }

  // ============================================
  // 2. TENANT LOGIN ROUTE HANDLING
  // ============================================
  const hasToken = Boolean(localStorage.getItem('auth_token'));

  if (location.pathname === '/login' || (!isAuthenticated && !hasToken)) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage appVersion={appVersion} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // ============================================
  // 3. TENANT APPLICATION WITH SIDEBAR & GUARDS
  // ============================================
  const getPageTitle = () => {
    switch (location.pathname) {
      case '/pos':
      case '/':
        return '🛒 POS & Order Terminal (Dine In • Take Away • Delivery)';
      case '/invoices':
      case '/sale-invoices':
        return '🧾 Sale Invoices & Billing History';
      case '/kitchen':
        return '🍳 Kitchen Display System (KDS)';
      case '/menu':
        return '📋 Menu & Recipe Management';
      case '/deals':
        return '🎁 Deals & Combo Bundles Management';
      case '/payments':
        return '💵 Cash Register & Receipts';
      case '/inventory':
        return '📦 Inventory & Stock Adjustments';
      case '/customers':
        return '👤 Customers';
      case '/dues':
        return '💳 Customer Dues & Receivables (Udhaar)';
      case '/costing':
        return '📊 Menu & Inventory Costing (COGS)';
      case '/employees':
        return '👥 Staff Directory & Time Clock';
      case '/roles':
        return '🛡️ Roles & Granular Permissions';
      case '/settings':
        return '⚙️ Business Profile & Store Settings';
      case '/analytics':
        return '📊 Analytics & Sales Reports';
      case '/forbidden':
        return '🔒 Access Restricted';
      default:
        return user?.restaurantName || 'Restaurant POS System';
    }
  };

  const currentUser = user || {
    firstName: 'Alex',
    lastName: 'Morgan',
    role: 'WAITER',
    email: 'staff@restaurant.com',
  };

  return (
    <div className="app-layout">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar Navigation */}
        <aside className="sidebar no-print">
          <div className="sidebar-header">
            {user?.restaurantLogoUrl ? (
              <img
                src={user.restaurantLogoUrl}
                alt="Logo"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  objectFit: 'contain',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                }}
              />
            ) : (
              <div className="brand-icon">🍽️</div>
            )}
            <div style={{ overflow: 'hidden' }}>
              <div
                className="brand-title"
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '160px',
                }}
                title={user?.restaurantName || 'Restaurant POS'}
              >
                {user?.restaurantName || 'Restaurant POS'}
              </div>
              <div className="brand-subtitle">
                {user?.restaurantSlug ? `@${user.restaurantSlug}` : 'Dine In • Take Away'}
              </div>
            </div>
          </div>

          <nav className="sidebar-nav">
            {canSeePos && (
              <NavLink to="/pos" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">🛒</span>
                <span>POS / Ordering</span>
              </NavLink>
            )}

            {canSeeInvoices && (
              <NavLink to="/invoices" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">🧾</span>
                <span>Sale Invoices</span>
              </NavLink>
            )}

            {canSeeKitchen && (
              <NavLink to="/kitchen" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">🍳</span>
                <span>Kitchen Display</span>
              </NavLink>
            )}

            {canSeePayments && (
              <NavLink to="/payments" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">💵</span>
                <span>Cash Register</span>
              </NavLink>
            )}

            {canSeeMenu && (
              <NavLink to="/menu" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">📋</span>
                <span>Menu & Recipes</span>
              </NavLink>
            )}

            {canSeeDeals && (
              <NavLink to="/deals" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">🎁</span>
                <span>Deals & Combos</span>
              </NavLink>
            )}

            {canSeeInventory && (
              <NavLink to="/inventory" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">📦</span>
                <span>Inventory Stock</span>
              </NavLink>
            )}

            {canSeeCustomers && (
              <NavLink to="/customers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">👤</span>
                <span>Customers</span>
              </NavLink>
            )}

            {canSeeDues && (
              <NavLink to="/dues" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">💳</span>
                <span>Dues & Udhaar</span>
              </NavLink>
            )}

            {canSeeCosting && (
              <NavLink to="/costing" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">📊</span>
                <span>Costing</span>
              </NavLink>
            )}

            {canSeeEmployees && (
              <NavLink to="/employees" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">👥</span>
                <span>Staff & Time Clock</span>
              </NavLink>
            )}

            {canSeeRoles && (
              <NavLink to="/roles" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">🛡️</span>
                <span>Staff Roles</span>
              </NavLink>
            )}

            {canSeeSettings && (
              <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">⚙️</span>
                <span>Store Settings</span>
              </NavLink>
            )}

            {canSeeAnalytics && (
              <NavLink to="/analytics" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">📊</span>
                <span>Sales & Analytics</span>
              </NavLink>
            )}
          </nav>

          {/* Sidebar Footer User Info */}
          <div className="sidebar-footer">
            <div className="user-badge">
              <div className="user-avatar">
                {formatPersonName(currentUser.firstName)?.[0] || 'U'}{formatPersonName(currentUser.lastName)?.[0] || 'S'}
              </div>
              <div className="user-info">
                <div className="user-name">
                  {formatPersonName(currentUser.firstName)} {formatPersonName(currentUser.lastName)}
                </div>
                <div className="user-role">
                  {(currentUser as any).roleName || currentUser.role}
                </div>
              </div>
            </div>

            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={handleLogout}
            >
              🔒 Switch User / Logout
            </button>
            {(user?.supportMode || isSupportMode()) && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                onClick={() => {
                  exitSupportMode();
                  dispatch(logout());
                  navigate('/platform');
                }}
              >
                Exit support mode
              </button>
            )}
            <div className="app-version">Version {appVersion}</div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          {/* Top Header Bar */}
          <header className="topbar no-print">
            <div className="page-title">{getPageTitle()}</div>

            <div className="topbar-actions">
              {/* Light / Dark Mode Toggle */}
              <button
                className="theme-toggle-btn"
                onClick={toggleTheme}
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              >
                <span className="theme-icon-anim">{theme === 'dark' ? '☀️' : '🌙'}</span>
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>

              {liveAlert && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span>{liveAlert}</span>
                  <button
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                    onClick={() => setLiveAlert(null)}
                  >
                    ✕
                  </button>
                </div>
              )}

              <SyncStatusIndicator />
            </div>
          </header>

          {/* Dynamic Route Pages with Permission Checks */}
          <div className="route-container">
            <Routes>
              <Route path="/" element={<Navigate to={firstPermittedRoute} replace />} />
              <Route
                path="/pos"
                element={
                  <RequirePermission permissions={['pos.use']}>
                    <PosPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/invoices"
                element={
                  <RequirePermission permissions={['invoices.view', 'orders.view']}>
                    <SaleInvoicesPage />
                  </RequirePermission>
                }
              />
              <Route path="/sale-invoices" element={<Navigate to="/invoices" replace />} />
              <Route
                path="/kitchen"
                element={
                  <RequirePermission permissions={['kitchen.view']}>
                    <KitchenPage />
                  </RequirePermission>
                }
              />
              <Route path="/tables" element={<Navigate to="/pos" replace />} />
              <Route
                path="/menu"
                element={
                  <RequirePermission permissions={['menu.view']}>
                    <MenuPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/deals"
                element={
                  <RequirePermission permissions={['deals.view']}>
                    <DealsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/inventory"
                element={
                  <RequireFeature feature="costing">
                    <RequirePermission permissions={['inventory.view']}>
                      <InventoryPage />
                    </RequirePermission>
                  </RequireFeature>
                }
              />
              <Route
                path="/customers"
                element={
                  <RequirePermission permissions={['customers.view', 'customers.manage']}>
                    <CustomersPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/dues"
                element={
                  <RequirePermission permissions={['dues.view']}>
                    <DuesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/costing"
                element={
                  <RequireFeature feature="costing">
                    <RequirePermission permissions={['costing.view']}>
                      <CostingPage />
                    </RequirePermission>
                  </RequireFeature>
                }
              />
              <Route
                path="/employees"
                element={
                  <RequirePermission permissions={['employees.view']}>
                    <EmployeesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/roles"
                element={
                  <RequirePermission permissions={['roles.view', 'roles.manage']}>
                    <RolesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequirePermission permissions={['settings.manage']}>
                    <SettingsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/payments"
                element={
                  <RequirePermission permissions={['payments.view', 'payments.process']}>
                    <PaymentsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/analytics"
                element={
                  <RequirePermission permissions={['analytics.view']}>
                    <AnalyticsPage />
                  </RequirePermission>
                }
              />
              <Route path="/forbidden" element={<ForbiddenPage />} />
              <Route path="*" element={<Navigate to={firstPermittedRoute} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
