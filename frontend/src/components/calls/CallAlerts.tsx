/**
 * App-wide call alerts (rendered once in App.tsx):
 *  - a "📹 <name> is calling — Join" bar across the top of every normal page
 *    (not on full-screen pages like a study session, not where the page shows
 *    its own banner: Home and that relationship's page),
 *  - the in-app ring (sound + vibration) when an incoming call starts, unless
 *    the account is set to silent,
 *  - a notification tap in the service worker navigates the open app,
 *  - after sign-in, the push subscription is refreshed (services/push.ts).
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { callIdFromPath, callToRing, pickCallBanner } from '@shared/calls';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveCalls } from '../../hooks/useLiveCalls';
import { isImmersiveRoute } from '../nav/tabs';
import { callAlertsMode, refreshPushSubscription, rememberCallAlerts } from '../../services/push';
import { isRinging, startRinging, stopRinging } from '../../services/calls/ringtone';
import { CallBannerView, dismissCallBanner, useDismissedCalls } from './CallBanner';

const RUNG_KEY = 'calls-rung';

function readRung(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RUNG_KEY) || '[]');
  } catch {
    return [];
  }
}

function addRung(id: string) {
  try {
    localStorage.setItem(RUNG_KEY, JSON.stringify([...readRung().filter((x) => x !== id), id].slice(-30)));
  } catch {
    /* ignore */
  }
}

/** Pages that show the call banner themselves. */
function pageShowsOwnBanner(path: string, relationshipId: string | null): boolean {
  if (path === '/') return true;
  return !!relationshipId && (path === `/connections/${relationshipId}` || path.startsWith(`/connections/${relationshipId}/`));
}

export function CallAlerts() {
  const { user, isAuthenticated } = useAuth();
  const calls = useLiveCalls();
  const dismissed = useDismissedCalls();
  const location = useLocation();
  const navigate = useNavigate();
  const ringingFor = useRef<string | null>(null);
  const path = location.pathname;

  // Settings mirrored on the device; the push subscription kept current.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    rememberCallAlerts(user.call_alerts);
    void refreshPushSubscription();
  }, [isAuthenticated, user]);

  // A tap on a notification while the app is open: go there without a reload.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigate' && typeof event.data.url === 'string' && event.data.url.startsWith('/')) {
        stopRinging();
        navigate(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  // Ring once per incoming call; stop when it's answered, gone, dismissed or opened.
  useEffect(() => {
    if (!user) return;
    const immersive = isImmersiveRoute(path);
    const current = ringingFor.current;
    if (current && (!calls.some((c) => c.id === current) || callIdFromPath(path) === current || dismissed.includes(current) || immersive)) {
      stopRinging();
      ringingFor.current = null;
    }
    if (immersive) return;
    const target = callToRing(calls, { myUserId: user.id, now: Date.now(), rung: readRung(), mode: callAlertsMode(), path });
    if (target && !dismissed.includes(target.id)) {
      addRung(target.id);
      ringingFor.current = target.id;
      startRinging();
    }
  }, [calls, path, user, dismissed]);

  useEffect(() => () => {
    if (isRinging()) stopRinging();
  }, []);

  if (!user || isImmersiveRoute(path)) return null;
  const banner = pickCallBanner(calls, { myUserId: user.id, path, now: Date.now(), dismissed });
  if (!banner || pageShowsOwnBanner(path, banner.relationship_id)) return null;
  return (
    <CallBannerView
      banner={banner}
      variant="top"
      onJoin={() => {
        stopRinging();
        navigate(banner.url);
      }}
      onDismiss={() => dismissCallBanner(banner.call_id)}
    />
  );
}
