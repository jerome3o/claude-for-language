import { useState, useEffect, useRef } from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import './OfflineBanner.css';

export function OfflineBanner() {
  const { isOnline, isSyncing, syncProgress, pendingReviewsCount, triggerSync } = useNetwork();
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

  // Offline - small badge
  if (!isOnline) {
    return (
      <div className="sync-badge sync-badge-offline">
        <span className="sync-badge-dot"></span>
        <span>Offline</span>
        {pendingReviewsCount > 0 && <span>({pendingReviewsCount})</span>}
      </div>
    );
  }

  // Syncing - small badge with spinner and progress info
  if (isSyncing) {
    let progressText = 'Syncing';
    if (syncProgress) {
      if (syncProgress.current && syncProgress.total) {
        progressText = `${syncProgress.message} (${syncProgress.current}/${syncProgress.total})`;
      } else {
        progressText = syncProgress.message;
      }
    }

    return (
      <div className="sync-badge sync-badge-syncing">
        <span className="sync-badge-spinner"></span>
        <span>{progressText}</span>
      </div>
    );
  }

  // Pending reviews - tappable badge
  if (pendingReviewsCount > 0) {
    return (
      <div className="sync-badge sync-badge-pending" onClick={triggerSync}>
        <span className="sync-badge-dot"></span>
        <span>{pendingReviewsCount} pending</span>
      </div>
    );
  }

  // Brief "Synced" confirmation
  if (showSyncedMessage) {
    return (
      <div className="sync-badge sync-badge-synced">
        <span className="sync-badge-check">✓</span>
        <span>Synced</span>
      </div>
    );
  }

  return null;
}
