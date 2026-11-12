import React, { useEffect, useState } from 'react';
import { webordersApi, WebsiteSettings, OpeningHours } from '../api/weborders.api';
import { compressImageFile } from '../utils/image';

const DAYS: Array<{ key: keyof OpeningHours; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const DAY_LABELS_UR: Record<string, string> = {
  Monday: 'پیر',
  Tuesday: 'منگل',
  Wednesday: 'بدھ',
  Thursday: 'جمعرات',
  Friday: 'جمعہ',
  Saturday: 'ہفتہ',
  Sunday: 'اتوار',
};

function parseHours(json?: string): OpeningHours {
  try {
    return JSON.parse(json || '{}') || {};
  } catch {
    return {};
  }
}

/** Keep only images the API will accept (HTTPS URL or PNG/JPEG/WebP data URL). */
function isUsableImage(value?: string | null): boolean {
  if (!value) return true;
  if (value.startsWith('https://')) return true;
  const match = value.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return false;
  // A length of 1 mod 4 is an incomplete base64 payload (truncated image).
  return match[2].length % 4 !== 1;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary, rgba(255,255,255,0.04))',
  color: 'inherit',
  fontSize: '13px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  marginBottom: '4px',
  opacity: 0.85,
};

export const WebsiteSettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [settings, setSettings] = useState<WebsiteSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [about, setAbout] = useState('');
  const [hours, setHours] = useState<OpeningHours>({});
  const [orderTypes, setOrderTypes] = useState<string[]>(['PICKUP', 'DELIVERY']);
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [freeDeliveryAbove, setFreeDeliveryAbove] = useState('');
  const [minOrder, setMinOrder] = useState('0');
  const [paymentNote, setPaymentNote] = useState('');
  const [testingWa, setTestingWa] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await webordersApi.getSettings();
      setSettings(data);
      setEnabled(!!data.onlineOrderingEnabled);
      setWhatsapp(data.whatsappNumber || '');
      setSlug(data.websiteSlug || '');
      // Older builds truncated base64 images at 500 chars. Drop those broken
      // values instead of re-submitting them (the owner can upload again).
      setLogoUrl(isUsableImage(data.logoUrl) ? data.logoUrl || '' : '');
      setCoverUrl(isUsableImage(data.websiteCoverUrl) ? data.websiteCoverUrl || '' : '');
      setAbout(data.websiteAbout || '');
      setHours(parseHours(data.websiteOpeningHours));
      setOrderTypes(
        (data.websiteOrderTypes || 'DELIVERY,PICKUP').split(',').map((t) => t.trim()).filter(Boolean)
      );
      setDeliveryFee(String(data.websiteDeliveryFee ?? 0));
      setFreeDeliveryAbove(data.websiteFreeDeliveryAbove != null ? String(data.websiteFreeDeliveryAbove) : '');
      setMinOrder(String(data.websiteMinOrder ?? 0));
      setPaymentNote(data.websitePaymentNote || '');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load website settings');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (
    file: File | undefined,
    target: 'logo' | 'cover'
  ) => {
    if (!file) return;
    setError(null);
    setSuccess(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Please choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be smaller than 2 MB.');
      return;
    }
    try {
      const dataUrl = await compressImageFile(file, target === 'logo' ? 600 : 1400, 0.85);
      if (target === 'logo') setLogoUrl(dataUrl);
      else setCoverUrl(dataUrl);
    } catch (e: any) {
      setError(e?.message || 'Could not read that image.');
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const data = await webordersApi.updateSettings({
        onlineOrderingEnabled: enabled,
        whatsappNumber: whatsapp,
        websiteSlug: slug,
        logoUrl: logoUrl || null,
        websiteCoverUrl: coverUrl || null,
        websiteAbout: about || null,
        websiteOpeningHours: JSON.stringify(hours),
        websiteOrderTypes: orderTypes,
        websiteDeliveryFee: Number(deliveryFee) || 0,
        websiteFreeDeliveryAbove: freeDeliveryAbove ? Number(freeDeliveryAbove) : null,
        websiteMinOrder: Number(minOrder) || 0,
        websitePaymentNote: paymentNote || null,
      });
      setSettings(data);
      setSlug(data.websiteSlug || '');
      setWhatsapp(data.whatsappNumber || '');
      setSuccess('Website settings saved.');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWhatsApp = async () => {
    try {
      setTestingWa(true);
      setError(null);
      const res = await webordersApi.testWhatsApp(whatsapp || undefined);
      window.open(res.whatsappUrl, '_blank', 'noopener');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Test failed');
    } finally {
      setTestingWa(false);
    }
  };

  const publicLink = settings?.websiteSlug
    ? `${window.location.origin}/m/${settings.websiteSlug}`
    : '';

  const copyLink = async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link');
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="card">Loading website settings…</div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '40px' }}>
      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>🌐 Website & WhatsApp Orders</h2>
        <p style={{ margin: '6px 0 0', fontSize: '13px', opacity: 0.75 }}>
          Publish your menu online and receive orders from customers via your website and WhatsApp.
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '12px', borderLeft: '3px solid #ef4444' }}>
          <span style={{ color: '#ef4444', fontSize: '13px' }}>{error}</span>
        </div>
      )}
      {success && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '12px', borderLeft: '3px solid #22c55e' }}>
          <span style={{ color: '#22c55e', fontSize: '13px' }}>{success}</span>
        </div>
      )}

      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0, fontSize: '15px' }}>Online Ordering</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>Enable online ordering</span>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>WhatsApp number (orders arrive here)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={inputStyle}
                placeholder="0300 1234567"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
              <button type="button" className="btn" onClick={handleTestWhatsApp} disabled={testingWa}>
                {testingWa ? '…' : 'Test'}
              </button>
            </div>
            <span style={{ fontSize: '11px', opacity: 0.6 }}>
              Stored as international digits (03xx… becomes +92 3xx…)
            </span>
          </div>
          <div>
            <label style={labelStyle}>Public page link (slug)</label>
            <input
              style={inputStyle}
              placeholder="my-restaurant"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
        </div>

        {publicLink && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <code
              style={{
                flex: 1,
                minWidth: '220px',
                padding: '8px 10px',
                background: 'rgba(127,127,127,0.1)',
                borderRadius: '6px',
                fontSize: '12px',
                overflowWrap: 'anywhere',
              }}
            >
              {publicLink}
            </code>
            <button type="button" className="btn" onClick={copyLink}>
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
            {settings?.websiteSlug && (
              <a href={publicLink} target="_blank" rel="noopener noreferrer">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(publicLink)}`}
                  alt="QR code"
                  style={{ width: '60px', height: '60px', borderRadius: '6px', background: '#fff', padding: '4px' }}
                  title="Scan to open your menu"
                />
              </a>
            )}
            {settings?.websiteSlug && (
              <a
                className="btn"
                href={`https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(publicLink)}`}
                download={`${settings.websiteSlug}-qr.png`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download QR
              </a>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0, fontSize: '15px' }}>Page Branding</h3>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <label style={labelStyle}>Logo</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', background: '#fff', border: '1px solid var(--border-color)' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void handleImageUpload(e.target.files?.[0], 'logo');
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              {logoUrl && (
                <button type="button" className="btn" onClick={() => setLogoUrl('')}>
                  Remove
                </button>
              )}
            </div>
            <div style={{ fontSize: '11.5px', opacity: 0.6, margin: '6px 0' }}>
              Upload a square PNG/JPEG/WebP (max 2 MB), or paste an HTTPS URL.
            </div>
            <input
              style={inputStyle}
              value={logoUrl.startsWith('data:') ? '' : logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div>
            <label style={labelStyle}>Cover image</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt="Cover preview"
                  style={{ width: 96, height: 48, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border-color)' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
                Upload cover
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void handleImageUpload(e.target.files?.[0], 'cover');
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              {coverUrl && (
                <button type="button" className="btn" onClick={() => setCoverUrl('')}>
                  Remove
                </button>
              )}
            </div>
            <div style={{ fontSize: '11.5px', opacity: 0.6, margin: '6px 0' }}>
              Best at 1400×500. Upload PNG/JPEG/WebP (max 2 MB), or paste an HTTPS URL.
            </div>
            <input
              style={inputStyle}
              value={coverUrl.startsWith('data:') ? '' : coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div>
            <label style={labelStyle}>About text</label>
            <textarea style={{ ...inputStyle, minHeight: '70px' }} value={about} onChange={(e) => setAbout(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0, fontSize: '15px' }}>Opening Hours</h3>
        <div style={{ display: 'grid', gap: '8px' }}>
          {DAYS.map((day) => {
            const dayHours = hours[day.key] || {};
            return (
              <div key={day.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '150px' }}>
                  <input
                    type="checkbox"
                    checked={!!dayHours.closed}
                    onChange={(e) => setHours((h) => ({ ...h, [day.key]: { ...dayHours, closed: e.target.checked } }))}
                  />
                  <span style={{ fontSize: '13px' }}>
                    {day.label} <span style={{ opacity: 0.55 }}>({DAY_LABELS_UR[day.label]})</span>
                  </span>
                </label>
                {dayHours.closed ? (
                  <span style={{ fontSize: '12px', color: '#ef4444' }}>Closed</span>
                ) : (
                  <>
                    <input
                      type="time"
                      style={{ ...inputStyle, width: '110px' }}
                      value={dayHours.open || ''}
                      onChange={(e) => setHours((h) => ({ ...h, [day.key]: { ...dayHours, open: e.target.value } }))}
                    />
                    <span style={{ opacity: 0.6 }}>→</span>
                    <input
                      type="time"
                      style={{ ...inputStyle, width: '110px' }}
                      value={dayHours.close || ''}
                      onChange={(e) => setHours((h) => ({ ...h, [day.key]: { ...dayHours, close: e.target.value } }))}
                    />
                    {!dayHours.open && !dayHours.close && <span style={{ fontSize: '11px', opacity: 0.6 }}>Open 24 hours</span>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0, fontSize: '15px' }}>Orders & Delivery</h3>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={orderTypes.includes('DELIVERY')}
              onChange={(e) =>
                setOrderTypes((types) =>
                  e.target.checked ? [...types, 'DELIVERY'] : types.filter((t) => t !== 'DELIVERY')
                )
              }
            />
            <span style={{ fontSize: '13px' }}>Delivery</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={orderTypes.includes('PICKUP')}
              onChange={(e) =>
                setOrderTypes((types) =>
                  e.target.checked ? [...types, 'PICKUP'] : types.filter((t) => t !== 'PICKUP')
                )
              }
            />
            <span style={{ fontSize: '13px' }}>Pickup</span>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Default delivery fee (Rs, optional)</label>
            <input type="number" min="0" style={inputStyle} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
            <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>
              Leave 0 to let staff add the charge when accepting each order.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Free delivery above (Rs, optional)</label>
            <input type="number" min="0" style={inputStyle} value={freeDeliveryAbove} onChange={(e) => setFreeDeliveryAbove(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Minimum order (Rs)</label>
            <input type="number" min="0" style={inputStyle} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Payment note shown to customers (e.g. “Cash on delivery”)</label>
          <input style={inputStyle} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default WebsiteSettingsPage;
