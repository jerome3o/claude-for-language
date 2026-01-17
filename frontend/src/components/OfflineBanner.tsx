import { useNetwork } from '../contexts/NetworkContext';
import './OfflineBanner.css';

export function OfflineBanner() {
  const { isOnline, isSyncing, pendingReviewsCount, triggerSync } = useNetwork();

  // Don't show banner if online and no pending changes and not syncing
  if (isOnline && pendingReviewsCount === 0 && !isSyncing) {
    return null;
  }

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

  return null;
}
