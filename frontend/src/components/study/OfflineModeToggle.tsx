import { useNetwork } from '../../contexts/NetworkContext';
import { useManualOfflineMode, resolveOfflineMode, cycleOfflineMode, OfflineModeState } from '../../services/offlineMode';

/** Short forms for phone widths (the full label is in the title / aria-label). */
const SHORT_LABEL: Record<OfflineModeState, string> = {
  'auto-online': 'Auto',
  'auto-offline': 'Offline',
  'forced-offline': 'Forced',
};

/**
 * Top-bar offline control. Automatic from NetworkContext, with a manual
 * override kept for intermittent connections: tap cycles
 * auto → forced offline → auto. The label always says which one you're in.
 * While offline it also carries the number of reviews waiting to sync, so
 * the separate sync badge is not needed in the study top bar.
 */
export function OfflineModeToggle() {
  const forced = useManualOfflineMode();
  const { isOnline, pendingReviewsCount } = useNetwork();
  const mode = resolveOfflineMode({ forced, isOnline });
  const pending = mode.effectiveOffline && pendingReviewsCount > 0 ? ` (${pendingReviewsCount})` : '';

  return (
    <button
      type="button"
      className={`study-offline-pill study-offline-pill--${mode.state}`}
      onClick={() => cycleOfflineMode(isOnline)}
      aria-pressed={forced}
      aria-label={`Offline mode: ${mode.label}${pending ? `, ${pendingReviewsCount} reviews waiting to sync` : ''}. ${mode.description}`}
      title={mode.description}
      data-testid="offline-mode-toggle"
      data-state={mode.state}
    >
      <span aria-hidden="true">✈</span>
      <span className="study-offline-pill-label study-offline-pill-label--full">{mode.label}{pending}</span>
      <span className="study-offline-pill-label study-offline-pill-label--short" aria-hidden="true">{SHORT_LABEL[mode.state]}{pending}</span>
    </button>
  );
}
