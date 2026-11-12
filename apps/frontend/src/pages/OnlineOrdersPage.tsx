import React, { useCallback, useEffect, useRef, useState } from 'react';
import { webordersApi, WebOrder } from '../api/weborders.api';
import { socketClient } from '../lib/socket';

const STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  NEW: { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa' },
  ACCEPTED: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
  REJECTED: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
  EXPIRED: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  DELIVERED: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7' },
};

function formatMoney(n: number): string {
  return `Rs ${Math.round(n * 100) / 100}`;
}

function parseModifiers(mods: WebOrder['items'][number]['modifiers']): { name: string }[] {
  if (Array.isArray(mods)) return mods;
  try {
    const parsed = JSON.parse(mods || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const beep = (startTime: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    };
    const now = ctx.currentTime;
    beep(now);
    beep(now + 0.45);
  } catch {
    // Audio not available (autoplay policy etc.) — ignore
  }
}

export const OnlineOrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WebOrder | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [deliveryFees, setDeliveryFees] = useState<Record<string, string>>({});
  const inboxRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await webordersApi.listOrders({ limit: 100 });
      setOrders(list);
      // Seed the delivery-charge field once per order, without clobbering
      // whatever the manager is currently typing while polling.
      setDeliveryFees((prev) => {
        const next = { ...prev };
        for (const o of list) {
          if (o.status === 'NEW' && o.orderType === 'DELIVERY' && next[o.id] === undefined) {
            next[o.id] = o.deliveryFee > 0 ? String(o.deliveryFee) : '';
          }
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load online orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const socket = socketClient.getSocket();
    const onNew = () => {
      playNotificationSound();
      void refresh();
    };
    socket?.on('weborder:new', onNew);

    const poll = setInterval(() => void refresh(), 30000);

    return () => {
      socket?.off('weborder:new', onNew);
      clearInterval(poll);
    };
  }, [refresh]);

  const handleAccept = async (order: WebOrder) => {
    let deliveryFee: number | undefined;
    if (order.orderType === 'DELIVERY') {
      const raw = (deliveryFees[order.id] ?? '').trim();
      if (raw === '') {
        setError('Please enter the delivery charge before accepting (enter 0 for free delivery).');
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Please enter a valid delivery charge (0 or more).');
        return;
      }
      deliveryFee = parsed;
    }
    try {
      setBusyId(order.id);
      setError(null);
      await webordersApi.acceptOrder(order.id, deliveryFee);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to accept order');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      setBusyId(rejectTarget.id);
      setError(null);
      await webordersApi.rejectOrder(rejectTarget.id, rejectReason);
      setRejectTarget(null);
      setRejectReason('');
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to reject order');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelivered = async (order: WebOrder) => {
    try {
      setBusyId(order.id);
      await webordersApi.markDelivered(order.id);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to update order');
    } finally {
      setBusyId(null);
    }
  };

  const handleReplyWhatsApp = async (order: WebOrder) => {
    try {
      const { whatsappUrl } = await webordersApi.replyUrl(order.id);
      window.open(whatsappUrl, '_blank', 'noopener');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not build the WhatsApp link');
    }
  };

  const fresh = orders.filter((o) => o.status === 'NEW');
  const past = orders.filter((o) => o.status !== 'NEW');
  const visible = showHistory ? past : fresh;

  const renderCard = (order: WebOrder) => {
    const statusStyle = STATUS_STYLES[order.status] || STATUS_STYLES.EXPIRED;
    const isNew = order.status === 'NEW';
    const created = new Date(order.createdAt);
    const ageMinutes = Math.floor((Date.now() - created.getTime()) / 60000);
    const previewTotal =
      isNew && order.orderType === 'DELIVERY'
        ? order.subtotal + (Number(deliveryFees[order.id]) || 0)
        : order.total;
    return (
      <div
        key={order.id}
        className="card"
        style={{
          padding: '14px 16px',
          marginBottom: '12px',
          borderLeft: isNew ? '3px solid #3b82f6' : '3px solid transparent',
          opacity: order.status === 'EXPIRED' ? 0.65 : 1,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontWeight: 800, fontSize: '15px' }}>{order.reference}</span>
            <span
              style={{
                marginLeft: '10px',
                padding: '2px 10px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                background: statusStyle.bg,
                color: statusStyle.fg,
              }}
            >
              {order.status}
            </span>
            {isNew && ageMinutes >= 0 && (
              <span style={{ marginLeft: '8px', fontSize: '11px', opacity: 0.6 }}>
                {ageMinutes < 1 ? 'just now' : `${ageMinutes} min ago`}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 800, fontSize: '15px' }}>{formatMoney(previewTotal)}</div>
        </div>

        <div style={{ marginTop: '6px', fontSize: '13px', lineHeight: 1.6 }}>
          <div>
            <strong>{order.customerName}</strong> · {order.customerPhone} ·{' '}
            <span style={{ opacity: 0.8 }}>{order.orderType}</span>
            {order.orderType === 'DELIVERY' && order.address ? ` · ${order.address}` : ''}
          </div>
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
            {order.items.map((item) => (
              <li key={item.id}>
                {item.qty} × {item.name} — {formatMoney(item.unitPrice * item.qty)}
                {parseModifiers(item.modifiers).length > 0 && (
                  <span style={{ opacity: 0.7 }}>
                    {' '}
                    (+ {parseModifiers(item.modifiers).map((m) => m.name).join(', ')})
                  </span>
                )}
                {item.notes ? <em style={{ opacity: 0.7 }}> — “{item.notes}”</em> : null}
              </li>
            ))}
          </ul>
          <div style={{ opacity: 0.8, marginTop: '4px' }}>
            Subtotal {formatMoney(order.subtotal)}
            {order.orderType === 'DELIVERY'
              ? order.deliveryFee > 0
                ? ` · Delivery ${formatMoney(order.deliveryFee)}`
                : ' · Delivery charge not added yet'
              : ''}
            {order.rejectionReason ? ` · Reason: ${order.rejectionReason}` : ''}
            {order.notes ? ` · Notes: ${order.notes}` : ''}
          </div>
        </div>

        {isNew && order.orderType === 'DELIVERY' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            <label htmlFor={`delivery-${order.id}`} style={{ fontSize: '12.5px', fontWeight: 700 }}>
              Delivery charge (Rs)
            </label>
            <input
              id={`delivery-${order.id}`}
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              placeholder="0 for free"
              required
              value={deliveryFees[order.id] ?? ''}
              onChange={(e) =>
                setDeliveryFees((prev) => ({ ...prev, [order.id]: e.target.value }))
              }
              style={{
                width: '110px',
                padding: '7px 9px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'inherit',
                fontSize: '13px',
              }}
            />
            <span style={{ fontSize: '11.5px', opacity: 0.65 }}>
              Required — added to the customer’s POS bill when you accept.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          {isNew && (
            <>
              <button type="button" className="btn btn-primary" disabled={busyId === order.id} onClick={() => void handleAccept(order)}>
                ✓ Accept
              </button>
              <button
                type="button"
                className="btn"
                style={{ borderColor: '#ef4444', color: '#ef4444' }}
                disabled={busyId === order.id}
                onClick={() => {
                  setRejectTarget(order);
                  setRejectReason('');
                }}
              >
                ✕ Reject
              </button>
            </>
          )}
          {(order.status === 'ACCEPTED' || order.status === 'REJECTED') && (
            <>
              <button type="button" className="btn" onClick={() => void handleReplyWhatsApp(order)}>
                💬 Reply on WhatsApp
              </button>
              {order.status === 'ACCEPTED' && (
                <button type="button" className="btn" disabled={busyId === order.id} onClick={() => void handleDelivered(order)}>
                  ✓ Mark Delivered
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page-container" style={{ maxWidth: '760px', margin: '0 auto', paddingBottom: '40px' }}>
      <div className="card" style={{ padding: '14px 18px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }} ref={inboxRef}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>📥 Online Orders</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', opacity: 0.7 }}>
            🔴 Live{fresh.length > 0 ? ` · ${fresh.length} waiting` : ''}
          </span>
          <button type="button" className="btn" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? 'Show Inbox' : 'Show History'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '12px', borderLeft: '3px solid #ef4444' }}>
          <span style={{ color: '#ef4444', fontSize: '13px' }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: '18px' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: '18px', textAlign: 'center', opacity: 0.7 }}>
          {showHistory ? 'No past orders yet.' : 'No new online orders right now.'}
        </div>
      ) : (
        visible.map(renderCard)
      )}

      {rejectTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setRejectTarget(null)}
        >
          <div className="card" style={{ width: '90%', maxWidth: '420px', padding: '20px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: '16px' }}>Reject {rejectTarget.reference}</h3>
            <p style={{ fontSize: '13px', opacity: 0.8 }}>A reason is required — it is shared with the customer.</p>
            <input
              autoFocus
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
              placeholder="e.g. Closed for the day / item sold out"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && rejectReason.trim()) void handleReject();
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
              <button type="button" className="btn" onClick={() => setRejectTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={!rejectReason.trim() || busyId === rejectTarget.id} onClick={() => void handleReject()}>
                Reject Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlineOrdersPage;
