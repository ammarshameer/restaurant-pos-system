import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from './store/store';
import { logout, loginSuccess } from './store/slices/authSlice';
import { setMenuItems } from './store/slices/menuSlice';
import { setOrders } from './store/slices/orderSlice';
import { menuApi } from './api/menu.api';
import { orderApi } from './api/order.api';
import { socketClient } from './lib/socket';

// Page Imports
import LoginPage from './pages/LoginPage';
import PosPage from './pages/PosPage';
import SaleInvoicesPage from './pages/SaleInvoicesPage';
import KitchenPage from './pages/KitchenPage';
import MenuPage from './pages/MenuPage';
import InventoryPage from './pages/InventoryPage';
import EmployeesPage from './pages/EmployeesPage';
import PaymentsPage from './pages/PaymentsPage';
import AnalyticsPage from './pages/AnalyticsPage';

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  const [liveAlert, setLiveAlert] = useState<string | null>(null);

  // Light and Dark Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('pos_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pos_theme', theme);
  }, [theme]);

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
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }
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
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  const hasToken = Boolean(localStorage.getItem('auth_token'));

  // If on login page or unauthenticated on launch, render the login screen directly
  if (location.pathname === '/login' || (!isAuthenticated && !hasToken)) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

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
      case '/payments':
        return '💵 Cash Register & Receipts';
      case '/inventory':
        return '📦 Inventory & Stock Adjustments';
      case '/employees':
        return '👥 Staff Directory & Time Clock';
      case '/analytics':
        return '📊 Analytics & Sales Reports';
      default:
        return 'Restaurant POS System';
    }
  };

  const currentUser = user || {
    firstName: 'Alex',
    lastName: 'Morgan',
    role: 'MANAGER',
    email: 'manager@restaurant.com',
  };

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar no-print">
        <div className="sidebar-header">
          <div className="brand-icon">🍽️</div>
          <div>
            <div className="brand-title">Restaurant POS</div>
            <div className="brand-subtitle">Dine In • Take Away • Delivery</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/pos" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🛒</span>
            <span>POS / Ordering</span>
          </NavLink>

          <NavLink to="/invoices" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🧾</span>
            <span>Sale Invoices</span>
          </NavLink>

          <NavLink to="/kitchen" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🍳</span>
            <span>Kitchen Display</span>
          </NavLink>

          <NavLink to="/payments" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">💵</span>
            <span>Cash Register</span>
          </NavLink>

          <NavLink to="/menu" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📋</span>
            <span>Menu & Recipes</span>
          </NavLink>

          <NavLink to="/inventory" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📦</span>
            <span>Inventory Stock</span>
          </NavLink>

          <NavLink to="/employees" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">👥</span>
            <span>Staff & Time Clock</span>
          </NavLink>

          <NavLink to="/analytics" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📊</span>
            <span>Sales & Analytics</span>
          </NavLink>
        </nav>

        {/* Sidebar Footer User Info */}
        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-avatar">
              {currentUser.firstName[0]}{currentUser.lastName[0]}
            </div>
            <div className="user-info">
              <div className="user-name">
                {currentUser.firstName} {currentUser.lastName}
              </div>
              <div className="user-role">{currentUser.role}</div>
            </div>
          </div>

          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleLogout}
          >
            🔒 Switch User / Logout
          </button>
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

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                padding: '6px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
              <span>Offline POS Active</span>
            </div>
          </div>
        </header>

        {/* Dynamic Route Pages */}
        <Routes>
          <Route path="/" element={<PosPage />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/invoices" element={<SaleInvoicesPage />} />
          <Route path="/sale-invoices" element={<SaleInvoicesPage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="/tables" element={<Navigate to="/pos" replace />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
