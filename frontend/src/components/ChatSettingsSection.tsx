/**
 * Settings → Chat: "Check my Chinese automatically" (docs/CHAT.md "Auto-check").
 * On by default for learners; a tutor account can switch it on for itself.
 */

import { useEffect, useState } from 'react';
import { autoCheckSettingShown } from '@shared/chats/autoCheck';
import { useAuth } from '../contexts/AuthContext';
import { setChatAutoCheck } from '../services/push';

export function ChatSettingsSection() {
  const { user, refreshUser } = useAuth();
  const shown = autoCheckSettingShown(user?.chat_auto_check, user?.role);
  const [on, setOn] = useState(shown);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setOn(shown);
  }, [shown]);

  const toggle = async (next: boolean) => {
    setOn(next);
    setNote(null);
    try {
      await setChatAutoCheck(next);
      void refreshUser().catch(() => {});
    } catch (err) {
      setOn(!next);
      setNote(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div className="settings-section" data-testid="chat-settings">
      <h2>Chat</h2>
      <label className="settings-toggle-row" data-testid="chat-auto-check-toggle">
        <input type="checkbox" checked={on} onChange={(e) => void toggle(e.target.checked)} />
        <span>Check my Chinese automatically</span>
      </label>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        {on
          ? 'Your Chinese chat messages get a quiet ✎ when they could be better — hold the message to see how. Only you see it.'
          : 'Off — use “Check my Chinese” on a message or the ✓ in the message box when you want a check.'}
      </p>
      {note && <p className="settings-section-desc" role="status">{note}</p>}
    </div>
  );
}
