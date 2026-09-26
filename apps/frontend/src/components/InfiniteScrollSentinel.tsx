import React from 'react';
import { useInfiniteScrollSentinel } from '../hooks/useInfiniteScrollSentinel';

interface InfiniteScrollSentinelProps {
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage: () => void;
  totalCount?: number;
  currentCount?: number;
  emptyText?: string;
  className?: string;
}

export const InfiniteScrollSentinel: React.FC<InfiniteScrollSentinelProps> = ({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  totalCount,
  currentCount,
  emptyText = 'No records found',
  className = '',
}) => {
  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  if (totalCount === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '36px', marginBottom: '8px' }}>📭</div>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>{emptyText}</div>
      </div>
    );
  }

  return (
    <div className={className} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
      {/* Invisible sentinel element observed by IntersectionObserver */}
      <div ref={sentinelRef} style={{ height: '4px', width: '100%', pointerEvents: 'none' }} aria-hidden="true" />

      {/* Loading state indicator when fetching next page */}
      {isFetchingNextPage && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 20px',
            borderRadius: '9999px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
          <span>Loading more records (50 per batch)...</span>
        </div>
      )}

      {/* End of results message */}
      {!hasNextPage && currentCount !== undefined && currentCount > 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '12px 0',
            fontSize: '12px',
            color: 'var(--text-muted)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}
        >
          <span style={{ width: '40px', height: '1px', background: 'var(--border-color)' }} />
          <span>Showing all {currentCount}{totalCount !== undefined ? ` of ${totalCount}` : ''} records</span>
          <span style={{ width: '40px', height: '1px', background: 'var(--border-color)' }} />
        </div>
      )}
    </div>
  );
};
