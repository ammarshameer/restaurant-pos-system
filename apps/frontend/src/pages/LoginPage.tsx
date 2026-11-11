import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { loginSuccess, loginFailure, clearError } from '../store/slices/authSlice';
import { RootState } from '../store/store';
import { api } from '../lib/api';
import { storeSession, getAccessToken, getStoredUser } from '../lib/session';
import { isNetworkError } from '../lib/offline/network';
import {
  cachePasswordCredential,
  cachePinCredential,
  verifyOfflinePassword,
  verifyOfflinePin,
} from '../lib/offline/authCache';

export const LoginPage: React.FC<{ appVersion: string }> = ({ appVersion }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { error, loading } = useSelector((state: RootState) => state.auth);

  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [tenantSlug, setTenantSlug] = useState(() => {
    return localStorage.getItem('pos_tenant_slug') || '';
  });

  const getInitialRoute = (user: any): string => {
    if (!user) return '/pos';
    const perms = new Set(user.permissions || []);
    if (user.isOwnerRole === true || (!user.isOwnerRole && perms.has('pos.use'))) return '/pos';
    if (perms.has('kitchen.view')) return '/kitchen';
    if (perms.has('invoices.view') || perms.has('orders.view')) return '/invoices';
    if (perms.has('payments.view') || perms.has('payments.process')) return '/payments';
    if (perms.has('menu.view')) return '/menu';
    if (perms.has('deals.view')) return '/deals';
    if (perms.has('inventory.view')) return '/inventory';
    if (perms.has('employees.view')) return '/employees';
    if (perms.has('analytics.view')) return '/analytics';
    return '/pos';
  };

  /**
   * Enter the POS using a locally cached user while offline. The previously
   * stored token is reused only when it belongs to the same user so a
   * different cashier cannot inherit someone else's session.
   */
  const enterOfflineSession = (cachedUser: any) => {
    const existingUser = getStoredUser();
    const reusableToken =
      existingUser && cachedUser?.id && existingUser.id === cachedUser.id ? getAccessToken() : null;
    const token = reusableToken || 'offline';
    storeSession({ accessToken: token, user: cachedUser });
    dispatch(loginSuccess({ user: cachedUser, token }));
    navigate(getInitialRoute(cachedUser));
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(clearError());
    try {
      const data: any = await api.post('/auth/login', { email, password });
      storeSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      if (data.user?.restaurantSlug) {
        localStorage.setItem('pos_tenant_slug', data.user.restaurantSlug);
        setTenantSlug(data.user.restaurantSlug);
      }
      void cachePasswordCredential(data.user, password);
      dispatch(loginSuccess({ user: data.user, token: data.accessToken }));
      navigate(getInitialRoute(data.user));
    } catch (err: any) {
      if (isNetworkError(err)) {
        // Offline: allow unlock only if this device verified these creds before.
        const cachedUser = await verifyOfflinePassword(email, password);
        if (cachedUser) {
          enterOfflineSession(cachedUser);
          return;
        }
        dispatch(
          loginFailure(
            'No internet connection. Sign in once while online to enable offline access on this device.'
          )
        );
        return;
      }
      dispatch(loginFailure(err?.response?.data?.error || err?.response?.data?.message || 'Invalid email or password.'));
    }
  };

  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    if (!tenantSlug.trim()) {
      dispatch(loginFailure('Please enter your Business Code (slug) for PIN authentication.'));
      return;
    }

    dispatch(clearError());
    try {
      const cleanSlug = tenantSlug.trim().toLowerCase();
      localStorage.setItem('pos_tenant_slug', cleanSlug);

      const data: any = await api.post('/auth/pin-login', {
        pin,
        tenantSlug: cleanSlug,
      });

      storeSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      void cachePinCredential(data.user, pin);
      dispatch(loginSuccess({ user: data.user, token: data.accessToken }));
      navigate(getInitialRoute(data.user));
    } catch (err: any) {
      if (isNetworkError(err)) {
        const cachedUser = await verifyOfflinePin(pin);
        if (cachedUser) {
          enterOfflineSession(cachedUser);
          return;
        }
        dispatch(
          loginFailure(
            'No internet connection. Sign in once while online to enable offline access on this device.'
          )
        );
        return;
      }
      dispatch(loginFailure(err?.response?.data?.error || err?.response?.data?.message || 'Invalid PIN or Business Code.'));
    }
  };

  const handlePinInput = (digit: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + digit);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, var(--bg-tertiary) 0%, var(--bg-primary) 60%, #1a020b 100%)',
        padding: '20px',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          padding: '32px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--primary), var(--accent))',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 0 24px rgba(var(--primary-rgb), 0.4)',
              marginBottom: '14px',
            }}
          >
            🍽️
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Restaurant POS
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
            Point of Sale & Restaurant Management Terminal
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '8px' }}>
            Version {appVersion}
          </p>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: '4px',
            marginBottom: '24px',
          }}
        >
          <button
            type="button"
            className={`btn ${mode === 'password' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '8px' }}
            onClick={() => setMode('password')}
          >
            Email Login
          </button>
          <button
            type="button"
            className={`btn ${mode === 'pin' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '8px' }}
            onClick={() => setMode('pin')}
          >
            Quick PIN Pad
          </button>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              marginBottom: '18px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            {error}
          </div>
        )}

        {mode === 'password' ? (
          <form onSubmit={handlePasswordLogin}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="owner@restaurant.com or staff@restaurant.com"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              disabled={loading}
            >
              Sign In to POS
            </button>
          </form>
        ) : (
          <form onSubmit={handlePinLogin}>
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontSize: '12px' }}>
                Business Code / Slug
              </label>
              <input
                type="text"
                className="form-input"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="e.g. dimlight-cafe"
                required
                style={{ padding: '8px 12px', fontSize: '13px' }}
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Ask your manager for the Business Code and your PIN.
              </div>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <div
                style={{
                  letterSpacing: '0.4em',
                  fontSize: '28px',
                  fontWeight: 700,
                  height: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {pin ? '•'.repeat(pin.length) : <span style={{ color: 'var(--text-muted)', fontSize: '14px', letterSpacing: 'normal' }}>Enter 4-Digit PIN</span>}
              </div>
            </div>

            {/* PIN Pad Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '10px',
                marginBottom: '16px',
              }}
            >
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    height: '52px',
                    fontSize: '18px',
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    if (k === 'C') setPin('');
                    else if (k === '⌫') setPin((p) => p.slice(0, -1));
                    else handlePinInput(k);
                  }}
                >
                  {k}
                </button>
              ))}
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              disabled={!pin || !tenantSlug.trim()}
            >
              Unlock Terminal
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
