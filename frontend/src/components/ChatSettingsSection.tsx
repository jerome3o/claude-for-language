/**
 * Settings → Chat: "Check my Chinese automatically" (docs/CHAT.md "Auto-check").
 * On by default for learners; a tutor account can switch it on for itself.
 * Then, for a learner, "Your tutor can see": which of his chats with Claude his tutor may read
 * (shared/claude/visibility.ts — card questions by default, all, or none; one chat's ⋯ overrides it).
 */

import { useEffect, useState } from 'react';
import { autoCheckSettingShown } from '@shared/chats/autoCheck';
import { useAuth } from '../contexts/AuthContext';
import { setChatAutoCheck } from '../services/push';
import { parseTutorVisibility, TUTOR_VISIBILITY_EXPLAINER, TUTOR_VISIBILITY_OPTIONS, type ClaudeTutorVisibility } from '@shared/claude/visibility';
import { setClaudeTutorVisibility } from '../api/claudeThreads';
import { track } from '../services/analytics';

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
      {user?.role !== 'tutor' && <ClaudeTutorVisibilitySetting />}
    </div>
  );
}

/** "Your tutor can see": Card questions (default) · All Claude chats · None. */
export function ClaudeTutorVisibilitySetting() {
  const { user, refreshUser } = useAuth();
  const stored = parseTutorVisibility(user?.claude_tutor_visibility);
  const [value, setValue] = useState<ClaudeTutorVisibility>(stored);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setValue(stored);
  }, [stored]);

  const pick = async (next: ClaudeTutorVisibility) => {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setNote(null);
    try {
      await setClaudeTutorVisibility(next === 'card_only' ? null : next);
      track('claude.share_with_tutor', { on: next !== 'none', scope: 'account', visibility: next });
      void refreshUser().catch(() => {});
    } catch (err) {
      setValue(prev);
      setNote(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <fieldset className="settings-radio-group" data-testid="claude-tutor-visibility">
      <legend>✦ Your tutor can see your chats with Claude</legend>
      <p className="settings-section-desc" style={{ marginTop: '0.25rem' }}>{TUTOR_VISIBILITY_EXPLAINER}</p>
      {TUTOR_VISIBILITY_OPTIONS.map((o) => (
        <label key={o.id} className="settings-toggle-row" data-testid={`claude-tutor-visibility-${o.id}`}>
          <input type="radio" name="claude-tutor-visibility" value={o.id} checked={value === o.id} onChange={() => void pick(o.id)} />
          <span>
            {o.label}
            {o.id === 'card_only' ? ' (default)' : ''}
            <span className="settings-radio-hint">{o.hint}</span>
          </span>
        </label>
      ))}
      {note && <p className="settings-section-desc" role="status">{note}</p>}
    </fieldset>
  );
}
