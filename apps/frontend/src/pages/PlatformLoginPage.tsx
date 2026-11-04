import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { platformApi } from '../api/platform.api';
import { getPlatformAccessToken, storePlatformSession } from '../lib/session';
import PlatformThemeToggle from '../components/PlatformThemeToggle';

export const PlatformLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getPlatformAccessToken()) {
      navigate('/platform', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);

    try {
      const data = await platformApi.login(email, password);
      storePlatformSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      navigate('/platform');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Invalid platform admin credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="platform-page platform-login-page"
    >
      <PlatformThemeToggle />
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '36px',
          borderRadius: '16px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 0 24px rgba(59, 130, 246, 0.4)',
              marginBottom: '14px',
            }}
          >
            🛡️
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: '#f8fafc' }}>
            Platform Administration
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
            Product Owner & Support Portal
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              marginBottom: '20px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ color: '#cbd5e1' }}>Admin / Support Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="superadmin@restaurantpos.com"
              style={{ background: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '24px' }}>
            <label className="form-label" style={{ color: '#cbd5e1' }}>Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••••••"
              style={{ background: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', background: '#2563eb', borderColor: '#2563eb' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In to Platform'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PlatformLoginPage;
