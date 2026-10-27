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
  const [email, setEmail] = useState('manager@restaurant.com');
  const [password, setPassword] = useState('password123');
  const [pin, setPin] = useState('');

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
    navigate('/pos');
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
      void cachePasswordCredential(data.user, password);
      dispatch(loginSuccess({ user: data.user, token: data.accessToken }));
      navigate('/pos');
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
      dispatch(loginFailure(err?.response?.data?.error || 'Invalid email or password.'));
    }
  };

  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    dispatch(clearError());
    try {
      const data: any = await api.post('/auth/pin-login', { pin });
      storeSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      void cachePinCredential(data.user, pin);
      dispatch(loginSuccess({ user: data.user, token: data.accessToken }));
      navigate('/pos');
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
      dispatch(loginFailure(err?.response?.data?.error || 'Invalid PIN.'));
    }
  };

  const handlePinInput = (digit: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + digit);
    }
  };

  const handleQuickRoleLogin = (role: string, name: string) => {
    const user = {
      id: `emp-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@restaurant.com`,
      firstName: name.split(' ')[0],
      lastName: name.split(' ')[1] || 'Staff',
      role,
    };
    const token = 'mock-jwt-token';
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
    dispatch(loginSuccess({ user, token }));
    navigate('/pos');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, #1e1b4b 0%, #0f172a 60%, #020617 100%)',
        padding: '20px',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
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
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 0 24px rgba(99, 102, 241, 0.4)',
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
                placeholder="manager@restaurant.com"
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
              style={{ width: '100%', marginBottom: '20px' }}
              disabled={loading}
            >
              Sign In to POS
            </button>
          </form>
        ) : (
          <form onSubmit={handlePinLogin}>
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
              style={{ width: '100%', marginBottom: '20px' }}
              disabled={!pin}
            >
              Unlock Terminal
            </button>
          </form>
        )}

        {/* Quick Demo Access Buttons */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Fast Switch / Demo Profiles
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleQuickRoleLogin('MANAGER', 'Alex Morgan')}
            >
              Manager
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleQuickRoleLogin('SERVER', 'Sam Rivera')}
            >
              Server
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleQuickRoleLogin('KITCHEN', 'Chef Marco')}
            >
              Chef
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleQuickRoleLogin('CASHIER', 'Taylor Swift')}
            >
              Cashier
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
