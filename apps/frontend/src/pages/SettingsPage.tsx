import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { loginSuccess } from '../store/slices/authSlice';
import { settingsApi } from '../api/settings.api';
import { cacheReceiptBranding } from '../lib/receiptBranding';
import { PALETTE_OPTIONS } from '../lib/themePalettes';

export const SettingsPage: React.FC = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('Asia/Karachi');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoInputMode, setLogoInputMode] = useState<'upload' | 'url'>('upload');
  const [customLogoUrl, setCustomLogoUrl] = useState('');

  // Appearance State
  const [themePalette, setThemePalette] = useState<string>(() => {
    return localStorage.getItem('pos_palette') || 'espresso';
  });
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('pos_theme') as 'dark' | 'light') || 'dark';
  });

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await settingsApi.getBusinessSettings();
      cacheReceiptBranding(data);
      setName(data.name || '');
      setSlug(data.slug || '');
      setAddress(data.address || '');
      setPhone(data.phone || '');
      setEmail(data.email || '');
      setTimezone(data.timezone || 'Asia/Karachi');
      setLogoUrl(data.logoUrl || null);

      if (data.themePalette) {
        setThemePalette(data.themePalette);
        document.documentElement.setAttribute('data-palette', data.themePalette);
        localStorage.setItem('pos_palette', data.themePalette);
      }
      if (data.themeMode === 'dark' || data.themeMode === 'light') {
        setThemeMode(data.themeMode);
        document.documentElement.setAttribute('data-theme', data.themeMode);
        localStorage.setItem('pos_theme', data.themeMode);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load business settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleCopyCode = () => {
    const codeToCopy = slug || user?.restaurantSlug || '';
    if (!codeToCopy) return;
    navigator.clipboard.writeText(codeToCopy);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2500);
  };

  const handleSelectPalette = (p: string) => {
    setThemePalette(p);
    document.documentElement.setAttribute('data-palette', p);
    localStorage.setItem('pos_palette', p);
  };

  const handleSelectThemeMode = (m: 'dark' | 'light') => {
    setThemeMode(m);
    document.documentElement.setAttribute('data-theme', m);
    localStorage.setItem('pos_theme', m);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reject SVG files to prevent XSS
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      setError('SVG files are not permitted for security reasons. Please use PNG, JPEG, or WebP.');
      return;
    }

    // Enforce 2MB size limit
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo image must be smaller than 2MB.');
      return;
    }

    // Supported formats
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Only PNG, JPEG, and WebP images are allowed.');
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    setCustomLogoUrl('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Business name is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const finalLogo = logoInputMode === 'url' && customLogoUrl.trim()
        ? customLogoUrl.trim()
        : logoUrl;

      const updated = await settingsApi.updateBusinessSettings({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        timezone,
        logoUrl: finalLogo,
        themePalette,
        themeMode,
      });
      cacheReceiptBranding(updated);

      setSuccessMessage('Business profile and appearance settings updated successfully!');
      setName(updated.name);
      setLogoUrl(updated.logoUrl || null);
      if (updated.themePalette) setThemePalette(updated.themePalette);
      if (updated.themeMode === 'dark' || updated.themeMode === 'light') setThemeMode(updated.themeMode);

      // Update Redux state and local storage so the sidebar and theme reflect the update immediately
      if (user) {
        const updatedUser = {
          ...user,
          restaurantName: updated.name,
          restaurantSlug: updated.slug,
          restaurantLogoUrl: updated.logoUrl,
          themePalette: updated.themePalette || themePalette,
          themeMode: updated.themeMode || themeMode,
        };
        const token = localStorage.getItem('auth_token') || '';
        localStorage.setItem('auth_user', JSON.stringify(updatedUser));
        dispatch(loginSuccess({ user: updatedUser, token }));
      }

      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to update business settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading business settings...
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 6px 0' }}>
          Business Profile & Settings
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '14px' }}>
          Manage your restaurant details, staff login credentials, branding logo, theme palettes, and timezone.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: '10px' }}
          onClick={() => navigate('/website-settings')}
        >
          🌐 Website & WhatsApp Orders
        </button>
      </div>

      {/* Staff Login Business Code Banner */}
      <div
        style={{
          background: 'rgba(var(--primary-rgb, 224, 169, 63), 0.08)',
          border: '1px solid var(--border-active, rgba(224, 169, 63, 0.4))',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 700 }}>
            Staff Login Business Code (Tenant ID)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <code style={{ fontSize: '20px', fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.03em' }}>
              {slug || user?.restaurantSlug || '—'}
            </code>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              (Provide this code to your cashiers, chefs, and staff to log in with their PIN)
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleCopyCode}
          style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {codeCopied ? '✓ Copied to Clipboard!' : '📋 Copy Business Code'}
        </button>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#22c55e',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✓ {successMessage}
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#ef4444',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          ⚠ {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Appearance & Themes Card */}
        <div
          style={{
            background: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '24px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 4px 0' }}>
              Appearance & Themes
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
              Choose your display mode and brand palette. Changes take effect instantly and become the default for all staff.
            </p>
          </div>

          {/* Theme Mode Toggle (Dark vs Light) */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              Display Mode
            </label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => handleSelectThemeMode('dark')}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: '10px',
                  border: themeMode === 'dark' ? '2px solid var(--primary)' : '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  background: themeMode === 'dark' ? 'var(--primary-tint, rgba(224,169,63,0.15))' : 'rgba(0,0,0,0.2)',
                  color: themeMode === 'dark' ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '18px' }}>🌙</span>
                Dark Mode {themeMode === 'dark' && '✓'}
              </button>

              <button
                type="button"
                onClick={() => handleSelectThemeMode('light')}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: '10px',
                  border: themeMode === 'light' ? '2px solid var(--primary)' : '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  background: themeMode === 'light' ? 'var(--primary-tint, rgba(224,169,63,0.15))' : 'rgba(0,0,0,0.2)',
                  color: themeMode === 'light' ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '18px' }}>☀️</span>
                Light Mode {themeMode === 'light' && '✓'}
              </button>
            </div>
          </div>

          {/* 8 Theme Palettes */}
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              Accent Color Palette (8 Themes)
            </label>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
              Palettes change accent colors. Use Light/Dark mode above to change the background.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
              {PALETTE_OPTIONS.map((pal) => {
                const isSelected = themePalette === pal.id;
                return (
                  <div
                    key={pal.id}
                    onClick={() => handleSelectPalette(pal.id)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color, rgba(255,255,255,0.1))',
                      background: isSelected ? 'var(--primary-tint, rgba(224,169,63,0.12))' : 'rgba(0,0,0,0.2)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            background: pal.hex,
                            display: 'inline-block',
                            boxShadow: '0 0 8px ' + pal.hex + '66',
                          }}
                        />
                        <span style={{ fontWeight: 700, fontSize: '13px', color: isSelected ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {pal.name}
                        </span>
                      </div>
                      {isSelected && <span style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '14px' }}>✓</span>}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {pal.desc}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Brand Identity & Logo Card */}
        <div
          style={{
            background: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '24px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
            Brand Identity & Logo
          </h2>

          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Logo Preview */}
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '12px',
                border: '2px dashed var(--border-color, rgba(255, 255, 255, 0.2))',
                background: 'rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
                position: 'relative',
              }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Business Logo"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <span style={{ fontSize: '32px', display: 'block' }}>🍽️</span>
                  <span style={{ fontSize: '11px' }}>No Logo</span>
                </div>
              )}
            </div>

            {/* Logo Upload Controls */}
            <div style={{ flex: 1, minWidth: '280px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${logoInputMode === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLogoInputMode('upload')}
                >
                  File Upload
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${logoInputMode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLogoInputMode('url')}
                >
                  Image URL
                </button>
                {logoUrl && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={handleRemoveLogo}
                    style={{ marginLeft: 'auto' }}
                  >
                    Remove Logo
                  </button>
                )}
              </div>

              {logoInputMode === 'upload' ? (
                <div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    style={{ fontSize: '13px', color: 'var(--text-muted)' }}
                  />
                  <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Recommended: Square PNG, JPEG, or WebP. Max size: 2MB. SVGs are blocked for safety.
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={customLogoUrl}
                      onChange={(e) => setCustomLogoUrl(e.target.value)}
                      className="form-control"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                        color: 'var(--text-primary, #fff)',
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (customLogoUrl.trim()) {
                          setLogoUrl(customLogoUrl.trim());
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                  <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Paste a public HTTPS link to your hosted brand logo image.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Business Details Card */}
        <div
          style={{
            background: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '24px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
            Restaurant Information
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label htmlFor="business-name" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Business Name *
              </label>
              <input
                id="business-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dimlight Cafe & Bistro"
                className="form-control"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  color: 'var(--text-primary, #fff)',
                }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Business Code / Slug (Tenant ID)
              </label>
              <input
                type="text"
                value={slug}
                disabled
                className="form-control"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  color: 'var(--text-muted)',
                  cursor: 'not-allowed',
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                Used by staff during PIN login. Managed by platform administration.
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Contact Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+92 300 1234567"
                className="form-control"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  color: 'var(--text-primary, #fff)',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Official Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@restaurant.com"
                className="form-control"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  color: 'var(--text-primary, #fff)',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Physical Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop 4, Main Boulevard, Sector F"
                className="form-control"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  color: 'var(--text-primary, #fff)',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="form-control"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  color: 'var(--text-primary, #fff)',
                }}
              >
                <option value="Asia/Karachi">Asia/Karachi (PKT +05:00)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST +04:00)</option>
                <option value="Asia/Riyadh">Asia/Riyadh (AST +03:00)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ padding: '10px 24px', fontSize: '14px', fontWeight: 700 }}
          >
            {saving ? 'Saving Settings...' : '💾 Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SettingsPage;
