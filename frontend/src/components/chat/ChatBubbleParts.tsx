import type { SayBetterState } from '@shared/chats/autoCheck';

/*
 * Small pieces of a chat bubble shared by the chat page and Ask Claude on the study card
 * (components/askClaude): the translation line, the ✎ "could be better" mark in the meta row and
 * the "🎓 Open in Coach" chip under my bubble. Styles: chat-learning.css / chat-signal.css.
 */

/** The English under a message once Translate is on; null = still coming ("Translating…"). */
export function ChatTranslation({ text }: { text: string | null }) {
  return (
    <span className="chat-translation" data-testid="chat-translation">
      {text ?? (
        <span className="chat-translation-pending">
          <span className="chat-spinner" aria-hidden="true" /> Translating…
        </span>
      )}
    </span>
  );
}

/** The calm ✎ on my own message when the auto-check found something / the tutor corrected it. */
export function SayBetterMark({ state, label }: { state: Exclude<SayBetterState, null>; label: string }) {
  return (
    <span className={`chat-saybetter-mark ${state}`} data-testid="chat-saybetter-mark" data-state={state} role="img" aria-label={label} title={label}>
      ✎
    </span>
  );
}

/** "🎓 Open in Coach" under my bubble when the auto-check found something (docs/CHAT.md "Chat ↔ Coach"). */
export function CoachChip({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="chat-coach-chip" onClick={onClick} data-testid="chat-open-in-coach" title="Check it in the Sentence Coach">
      🎓 Open in Coach
    </button>
  );
}
