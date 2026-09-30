/**
 * "📹 <name> is calling — Join". One look, three places:
 *  - `top`    a slim bar across the top of every normal page (CallAlerts),
 *  - `card`   the big card at the top of Home,
 *  - `inline` on the student / tutor page and in the chat.
 * Which call to announce is shared/calls/alerts.ts `pickCallBanner`.
 */

import { useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { pickCallBanner, type CallBanner as Banner } from '@shared/calls';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveCalls } from '../../hooks/useLiveCalls';
import { stopRinging } from '../../services/calls/ringtone';
import './CallBanner.css';

// ---- calls the user closed the banner for (this tab / session)

const DISMISSED_KEY = 'call-banners-dismissed';
const listeners = new Set<() => void>();
let dismissedCache: string[] | null = null;

function readDismissed(): string[] {
  if (dismissedCache) return dismissedCache;
  try {
    dismissedCache = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]');
  } catch {
    dismissedCache = [];
  }
  return dismissedCache!;
}

export function dismissCallBanner(callId: string): void {
  dismissedCache = [...readDismissed().filter((id) => id !== callId), callId].slice(-50);
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedCache));
  } catch {
    /* ignore */
  }
  stopRinging();
  listeners.forEach((l) => l());
}

export function useDismissedCalls(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readDismissed,
    readDismissed,
  );
}

// ---- the banner itself

export type CallBannerVariant = 'top' | 'card' | 'inline';

export function CallBannerView({ banner, variant, onJoin, onDismiss }: { banner: Banner; variant: CallBannerVariant; onJoin: () => void; onDismiss?: () => void }) {
  const incoming = banner.kind === 'incoming';
  const testId = variant === 'top' ? 'call-alert-banner' : variant === 'card' ? 'home-call-banner' : 'live-call-banner';
  return (
    <div className={`call-banner call-banner-${variant}${incoming ? ' incoming' : ''}`} role={incoming ? 'alert' : 'status'} data-testid={testId}>
      <span className="call-banner-icon" aria-hidden="true">📹</span>
      <span className="call-banner-text">
        <strong>{banner.title}</strong>
        {variant === 'card' && <span className="call-banner-sub">{incoming ? 'Video lesson — tap Join to go straight in.' : 'The call is still open.'}</span>}
      </span>
      <button type="button" className="call-banner-join" onClick={onJoin} data-testid="call-banner-join">
        {banner.action}
      </button>
      {onDismiss && (
        <button type="button" className="call-banner-close" onClick={onDismiss} aria-label="Hide">
          ✕
        </button>
      )}
    </div>
  );
}

/** The banner for the call to announce here (optionally only one relationship's), or nothing. */
export function LiveCallBanner({ variant, relationshipId, includeTest, dismissible = true }: { variant: CallBannerVariant; relationshipId?: string | null; includeTest?: boolean; dismissible?: boolean }) {
  const { user } = useAuth();
  const calls = useLiveCalls();
  const dismissed = useDismissedCalls();
  const location = useLocation();
  const navigate = useNavigate();
  if (!user) return null;
  const banner = pickCallBanner(calls, {
    myUserId: user.id,
    path: location.pathname,
    now: Date.now(),
    dismissed: dismissible ? dismissed : [],
    relationshipId: relationshipId ?? undefined,
    includeTest,
  });
  if (!banner) return null;
  return (
    <CallBannerView
      banner={banner}
      variant={variant}
      onJoin={() => {
        stopRinging();
        navigate(banner.url);
      }}
      onDismiss={dismissible ? () => dismissCallBanner(banner.call_id) : undefined}
    />
  );
}
