import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useNetwork } from '../contexts/NetworkContext';
import './OfflineBanner.css';

/**
 * Sync status badge. Renders offline / syncing / pending / synced states.
 * By default it floats fixed in the bottom-right corner; pass `inline` to
 * render it as a normal inline element (used in the study session topbar
 * so it doesn't overlap the rating buttons).
 */
export function SyncBadge({ inline = false }: { inline?: boolean }) {
  const { isOnline, isSyncing, syncProgress, pendingReviewsCount, triggerSync } = useNetwork();
  const [showSyncedMessage, setShowSyncedMessage] = useState(false);
  const wasSyncing = useRef(false);

  const badgeClass = inline ? 'sync-badge sync-badge-inline' : 'sync-badge';

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
      <div className={`${badgeClass} sync-badge-offline`}>
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
      <div className={`${badgeClass} sync-badge-syncing`}>
        <span className="sync-badge-spinner"></span>
        <span>{inline ? 'Syncing' : progressText}</span>
      </div>
    );
  }

  // Pending reviews - tappable badge
  if (pendingReviewsCount > 0) {
    return (
      <div className={`${badgeClass} sync-badge-pending`} onClick={triggerSync}>
        <span className="sync-badge-dot"></span>
        <span>{pendingReviewsCount} pending</span>
      </div>
    );
  }

  // Brief "Synced" confirmation
  if (showSyncedMessage) {
    return (
      <div className={`${badgeClass} sync-badge-synced`}>
        <span className="sync-badge-check">✓</span>
        <span>Synced</span>
      </div>
    );
  }

  return null;
}

/**
 * Global floating sync badge (bottom-right corner). Hidden on the study
 * page, where the badge is shown inline in the study topbar instead so it
 * never overlaps the Again/Hard/Good/Easy buttons.
 */
export function OfflineBanner() {
  const location = useLocation();

  if (location.pathname.startsWith('/study')) {
    return null;
  }

  return <SyncBadge />;
}
