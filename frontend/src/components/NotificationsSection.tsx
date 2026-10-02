/**
 * Settings → "Notifications (messages & calls)": this device's Web Push
 * subscription (on / off / test) — used for new chat messages (docs/CHAT.md)
 * and video calls — plus the account's call alert style (ring or silent).
 * Replaces the calls-only "Video call alerts" section on the Settings page.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  callAlertsMode,
  disablePush,
  enablePush,
  pushState,
  sendTestPush,
  setCallAlerts,
  type CallAlertsMode,
  type PushState,
} from '../services/push';

function usePushState(): [PushState | null, () => void] {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = () => void pushState().then(setState);
  useEffect(refresh, []);
  return [state, refresh];
}

export function NotificationsSection() {
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
      : state === 'on' ? 'On — new messages and calls reach this device even when the app is closed.'
        : state === 'denied' ? 'Blocked in this browser’s site settings.'
          : state === 'unsupported' ? 'This browser can’t show notifications. Messages and calls still show while the app is open.'
            : 'Off on this device.';

  return (
    <div className="settings-section" data-testid="notifications-settings">
      <h2>Notifications (messages &amp; calls)</h2>
      <p className="settings-section-desc">
        A notification when your tutor or student sends a message or starts a video call — on this device, even with the app closed.
      </p>
      <p className="settings-section-desc" data-testid="push-status"><strong>On this device:</strong> {status}</p>
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

      <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.4rem' }}>Video calls</h3>
      <div className="settings-segmented" role="radiogroup" aria-label="Call alerts">
        {([['ring', 'Ring + notify'], ['silent', 'Silent']] as const).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} className={`settings-segment${mode === value ? ' selected' : ''}`} onClick={() => void choose(value)}>
            {label}
          </button>
        ))}
      </div>
      <p className="settings-section-desc" style={{ marginTop: '0.6rem' }}>
        {mode === 'silent' ? 'Silent: a banner in the app, no sound and no call notifications. Messages still notify.' : 'The app rings and vibrates, and a notification comes when it’s closed.'}
      </p>
      {note && <p className="settings-section-desc" role="status" style={{ marginTop: '0.5rem' }}>{note}</p>}
    </div>
  );
}
