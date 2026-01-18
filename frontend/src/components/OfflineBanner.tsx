import { useState, useEffect, useRef } from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import './OfflineBanner.css';

function formatLastSync(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export function OfflineBanner() {
  const { isOnline, isSyncing, pendingReviewsCount, triggerSync } = useNetwork();
  const [showSyncedMessage, setShowSyncedMessage] = useState(false);
  const wasSyncing = useRef(false);

  // Show "Synced" briefly after sync completes
  useEffect(() => {
    if (wasSyncing.current && !isSyncing && isOnline && pendingReviewsCount === 0) {
      setShowSyncedMessage(true);
      const timer = setTimeout(() => setShowSyncedMessage(false), 2000);
      return () => clearTimeout(timer);
    }
    wasSyncing.current = isSyncing;
  }, [isSyncing, isOnline, pendingReviewsCount]);

  // Offline banner
  if (!isOnline) {
    return (
      <div className="offline-banner offline-banner-warning">
        <span className="offline-banner-icon">!</span>
        <span className="offline-banner-text">
          Offline - {pendingReviewsCount > 0
            ? `${pendingReviewsCount} review${pendingReviewsCount !== 1 ? 's' : ''} will sync when connected`
            : 'studying in offline mode'}
        </span>
      </div>
    );
  }

  // Syncing banner
  if (isSyncing) {
    return (
      <div className="offline-banner offline-banner-syncing">
        <span className="offline-banner-spinner"></span>
        <span className="offline-banner-text">
          Syncing{pendingReviewsCount > 0 ? ` ${pendingReviewsCount} review${pendingReviewsCount !== 1 ? 's' : ''}` : ''}...
        </span>
      </div>
    );
  }

  // Pending reviews (online but not yet synced)
  if (pendingReviewsCount > 0) {
    return (
      <div className="offline-banner offline-banner-pending" onClick={triggerSync}>
        <span className="offline-banner-icon">!</span>
        <span className="offline-banner-text">
          {pendingReviewsCount} review{pendingReviewsCount !== 1 ? 's' : ''} pending - tap to sync
        </span>
      </div>
    );
  }

  // Brief "Synced" confirmation
  if (showSyncedMessage) {
    return (
      <div className="offline-banner offline-banner-synced">
        <span className="offline-banner-check">✓</span>
        <span className="offline-banner-text">Synced</span>
      </div>
    );
  }

  return null;
}

// Small sync status indicator for Header (optional use)
export function SyncStatusIndicator() {
  const { isOnline, isSyncing, pendingReviewsCount, lastSyncTime, triggerSync } = useNetwork();

  if (!isOnline) {
    return (
      <span className="sync-indicator sync-indicator-offline" title="Offline">
        ○
      </span>
    );
  }

  if (isSyncing) {
    return (
      <span className="sync-indicator sync-indicator-syncing" title="Syncing...">
        ↻
      </span>
    );
  }

  if (pendingReviewsCount > 0) {
    return (
      <span
        className="sync-indicator sync-indicator-pending"
        title={`${pendingReviewsCount} pending - tap to sync`}
        onClick={triggerSync}
      >
        ●
      </span>
    );
  }

  return (
    <span
      className="sync-indicator sync-indicator-synced"
      title={lastSyncTime ? `Synced ${formatLastSync(lastSyncTime)}` : 'Synced'}
    >
      ●
    </span>
  );
}
