/**
 * "🔔 Get notified of new messages — Turn on": a slim, dismissible line under the
 * chat header while this browser could show notifications but isn't subscribed
 * (pushState 'off' — not when blocked or unsupported). Turning on runs from the
 * tap, as browsers require. Dismissal is remembered on the device.
 */

import { useEffect, useState } from 'react';
import { enablePush, pushState } from '../../services/push';
import { chatNudgeDismissed, dismissChatNudge } from '../../services/chatNotifications';

export function ChatNotifyNudge() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (chatNudgeDismissed()) return;
    let alive = true;
    void pushState().then((s) => {
      if (alive && s === 'off') setVisible(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) setVisible(false);
    else setError(r.reason);
  };

  return (
    <div className="chat-notify-nudge" data-testid="chat-notify-nudge" role="region" aria-label="Message notifications">
      <span aria-hidden="true">🔔</span>
      <span className="chat-notify-nudge-text">{error ?? 'Get notified of new messages'}</span>
      <button type="button" className="chat-notify-nudge-on" disabled={busy} onClick={() => void turnOn()}>
        Turn on
      </button>
      <button
        type="button"
        className="chat-notify-nudge-close"
        aria-label="Dismiss"
        onClick={() => {
          dismissChatNudge();
          setVisible(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}
