/**
 * Settings → "Video call alerts" (ring or silent for the account; notifications
 * on this device on / off / test) and the one-line nudge on a student / tutor
 * page that asks for notification permission from a tap.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  callAlertsMode,
  disablePush,
  enablePush,
  pushState,
  pushSupported,
  sendTestPush,
  setCallAlerts,
  type CallAlertsMode,
  type PushState,
} from '../../services/push';
import './CallBanner.css';

function usePushState(): [PushState | null, () => void] {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = () => void pushState().then(setState);
  useEffect(refresh, []);
  return [state, refresh];
}

export function CallAlertsSection() {
  const { user } = useAuth();
  const [mode, setMode] = useState<CallAlertsMode>(user?.call_alerts ?? callAlertsMode());
  const [state, refresh] = usePushState();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const choose = async (next: CallAlertsMode) => {
    const prev = mode;
    setMode(next);
    setNote(null);
    try {
      await setCallAlerts(next);
    } catch (err) {
      setMode(prev);
      setNote(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await fn());
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const status =
    state === null ? 'Checking…'
      : state === 'on' ? 'On — calls reach this device even when the app is closed.'
        : state === 'denied' ? 'Blocked in this browser’s site settings.'
          : state === 'unsupported' ? 'This browser can’t show notifications. The banner and ring still work while the app is open.'
            : 'Off on this device.';

  return (
    <div className="settings-section" data-testid="call-alerts">
      <h2>Video call alerts</h2>
      <p className="settings-section-desc">When your tutor or student starts a video call.</p>
      <div className="settings-segmented" role="radiogroup" aria-label="Call alerts">
        {([['ring', 'Ring + notify'], ['silent', 'Silent']] as const).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} className={`settings-segment${mode === value ? ' selected' : ''}`} onClick={() => void choose(value)}>
            {label}
          </button>
        ))}
      </div>
      <p className="settings-section-desc" style={{ marginTop: '0.6rem' }}>
        {mode === 'silent' ? 'Silent: a banner in the app, no sound and no notifications.' : 'The app rings and vibrates, and a notification comes when it’s closed.'}
      </p>
      {mode === 'ring' && (
        <>
          <p className="settings-section-desc" data-testid="push-status"><strong>Notifications here:</strong> {status}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(state === 'off' || state === 'denied') && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
                const r = await enablePush();
                return r.ok ? 'Notifications are on for this device.' : r.reason;
              })}>
                Turn on notifications
              </button>
            )}
            {state === 'on' && (
              <>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => {
                  const r = await sendTestPush();
                  return r.sent > 0 ? 'Sent — it should appear in a moment (close or hide the app to see it).' : 'Nothing was delivered. Turn notifications off and on again.';
                })}>
                  Send a test
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => {
                  await disablePush();
                  return 'Notifications are off for this device.';
                })}>
                  Turn off here
                </button>
              </>
            )}
          </div>
        </>
      )}
      {note && <p className="settings-section-desc" role="status" style={{ marginTop: '0.5rem' }}>{note}</p>}
    </div>
  );
}

const NUDGE_KEY = 'call-alerts-nudge-dismissed';

/** "🔔 Get a notification when <name> calls — Turn on" (only while permission hasn't been asked). */
export function CallAlertsNudge({ name }: { name: string }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(NUDGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [error, setError] = useState<string | null>(null);
  if (hidden || !pushSupported() || Notification.permission !== 'default' || callAlertsMode() === 'silent') return null;
  const dismiss = () => {
    try {
      localStorage.setItem(NUDGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  return (
    <div className="call-alerts-nudge" data-testid="call-alerts-nudge">
      <span aria-hidden="true">🔔</span>
      <span className="call-alerts-nudge-text">{error ?? `Get a notification when ${name} calls you, even with the app closed.`}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={async () => {
        const r = await enablePush();
        if (r.ok) setHidden(true);
        else setError(r.reason);
      }}>
        Turn on
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={dismiss}>Not now</button>
    </div>
  );
}
