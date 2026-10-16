import React, { useState } from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { syncEngine } from '../lib/offline/syncEngine';

function formatTime(ts: number | null): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'never';
  }
}

/**
 * Live connectivity + sync badge shown in the top bar.
 * - Green: online and everything is synced.
 * - Amber: offline, or orders are queued waiting to sync.
 * - Blue: actively syncing.
 */
export const SyncStatusIndicator: React.FC = () => {
  const { online, syncing, pending, failed, lastSyncedAt, lastError } = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await syncEngine.syncNow();
    } finally {
      setBusy(false);
    }
  };

  const queued = pending + failed;

  let dotColor = '#10b981';
  let bg = 'rgba(16, 185, 129, 0.12)';
  let fg = '#10b981';
  let label = 'Online • Synced';

  if (!online) {
    dotColor = '#f59e0b';
    bg = 'rgba(245, 158, 11, 0.15)';
    fg = '#fbbf24';
    label = queued > 0 ? `Offline • ${queued} queued` : 'Offline • POS ready';
  } else if (syncing || busy) {
    dotColor = '#38bdf8';
    bg = 'rgba(56, 189, 248, 0.15)';
    fg = '#38bdf8';
    label = 'Syncing…';
  } else if (failed > 0) {
    dotColor = '#ef4444';
    bg = 'rgba(239, 68, 68, 0.15)';
    fg = '#f87171';
    label = pending > 0 ? `${pending} pending • ${failed} failed` : `${failed} failed`;
  } else if (queued > 0) {
    dotColor = '#f59e0b';
    bg = 'rgba(245, 158, 11, 0.15)';
    fg = '#fbbf24';
    label = `${pending} pending sync`;
  }

  const showSyncButton = online && queued > 0 && !syncing;
  const tooltip = [
    `Last synced: ${formatTime(lastSyncedAt)}`,
    lastError ? `Last error: ${lastError}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div
        title={tooltip}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: bg,
          color: fg,
          padding: '6px 12px',
          borderRadius: '9999px',
          fontSize: '12px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: dotColor,
            animation: syncing ? 'pulse 1.2s ease-in-out infinite' : undefined,
          }}
        />
        <span>{label}</span>
      </div>

      {showSyncButton && (
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={busy}
          className="btn btn-secondary btn-sm"
          style={{ whiteSpace: 'nowrap' }}
          title="Push queued offline orders to the server now"
        >
          🔄 Sync now
        </button>
      )}
    </div>
  );
};

export default SyncStatusIndicator;
