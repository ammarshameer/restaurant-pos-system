import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout } from '../store/slices/authSlice';
import { clearSession } from '../lib/session';
import { socketClient } from '../lib/socket';
import { ownerProfileApi } from '../api/ownerProfile.api';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
  color: 'var(--text-primary, #fff)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  marginBottom: '6px',
};

export const OwnerProfilePage: React.FC = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [businessLabel, setBusinessLabel] = useState('');

  useEffect(() => {
    let active = true;
    ownerProfileApi
      .get()
      .then((profile) => {
        if (!active) return;
        setFirstName(profile.firstName || '');
        setLastName(profile.lastName || '');
        setUsername(profile.username || '');
        setEmail(profile.email || '');
        setPhone(profile.phone || '');
        setAddress(profile.address || '');
        setBusinessLabel(
          profile.restaurant?.name
            ? `${profile.restaurant.name}${profile.restaurant.slug ? ` (${profile.restaurant.slug})` : ''}`
            : ''
        );
      })
      .catch((err: any) => {
        if (active) setError(err?.response?.data?.error || err?.message || 'Failed to load owner profile');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !address.trim() || !currentPassword) {
      setError('Please complete all required fields, including your current password.');
      return;
    }

    setSaving(true);
    try {
      await ownerProfileApi.update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        currentPassword,
      });

      // The server revoked all refresh tokens. Clear this browser's session too.
      socketClient.disconnect();
      clearSession();
      dispatch(logout());
      navigate('/login', {
        replace: true,
        state: { profileUpdated: true },
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update owner profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading owner profile...
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 6px 0' }}>Owner Profile</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '14px' }}>
          {businessLabel || 'Update your personal login and contact details for this business.'}
        </p>
      </div>

      <div
        style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: '12px',
          padding: '14px 18px',
          marginBottom: '20px',
          color: '#fbbf24',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        🔒 For security, saving any change signs you out of every device. You will be asked to log in again immediately.
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#ef4444',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ⚠ {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-card, #1e293b)',
          border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          borderRadius: '16px',
          padding: '24px',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 18px 0' }}>Personal Details</h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          <div>
            <label style={labelStyle}>First Name *</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Last Name *</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={fieldStyle} />
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          <div>
            <label style={labelStyle}>Login Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Username (optional)</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Used with your business code"
              style={fieldStyle}
            />
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          <div>
            <label style={labelStyle}>Mobile Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+92 300 1234567"
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Address *</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Your personal or mailing address"
              style={fieldStyle}
            />
          </div>
        </div>

        <div style={{ maxWidth: '360px', marginBottom: '24px' }}>
          <label style={labelStyle}>Current Password *</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Required to confirm this change"
            style={fieldStyle}
            autoComplete="current-password"
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : '💾 Save & Sign Out'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(-1)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default OwnerProfilePage;
