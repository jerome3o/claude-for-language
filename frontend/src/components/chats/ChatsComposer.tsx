/**
 * The box at the bottom of the Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"),
 * Claude.ai style: whatever is said (🎤, voice-first) or typed goes to Claude unless "To:" says
 * otherwise. Ask is the main button (Enter); for Chinese ✏️ Check and 🔍 Explain sit beside it, for
 * English 🔤 Translate (`composerFor('general', …)` + `coachButtons`, shared/claude/contexts.ts).
 * Sending starts a new general thread with that intent and opens it (offline: queued).
 *
 * "To: ✦ Claude ▾" lists the tutors: picking one opens her chat with the text as its draft.
 *
 * `compact` (the tutor's student-centric view): a single "✦ Ask Claude…" button until tapped, then
 * Ask · Translate only (the Coach's Check / Explain are a learner's tools).
 */
import { useEffect, useRef, useState } from 'react';
import { composerFor, type ClaudeComposer } from '@shared/claude/contexts';
import type { ClaudeIntent } from '@shared/claude/context';
import type { ComposeRecipient } from '@shared/claude/inbox';
import type { AskLanguage } from '@shared/study/askClaude';
import { ClaudeChatComposer } from '../claudeChat/ClaudeChatComposer';
import '../claudeChat/claude-chat.css';

export const CHATS_COMPOSE_PLACEHOLDER = 'Ask Claude anything…';

/** The box's buttons for a text: a new general chat's (Ask + Check / Explain / Translate); compact = Ask + Translate. */
export function chatsComposerFor(text: string, compact: boolean): ClaudeComposer {
  const c = composerFor('general', text, { started: false });
  if (!compact) return c;
  const intents = c.intents.filter((i) => i === 'ask' || i === 'translate');
  return { ...c, intents, hint: intents.length > 1 ? c.hint : null };
}

export interface ChatsComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSendToClaude: (text: string, intent: ClaudeIntent, spoken: boolean) => void;
  onSendToPerson: (to: ComposeRecipient, text: string) => void;
  recipients: ComposeRecipient[];
  busy: boolean;
  error: string | null;
  language: AskLanguage;
  online: boolean;
  compact?: boolean;
  /** Each new value > 0: open the box for typing (More → Ask Claude, ✏️ → Claude, a handed-over text). */
  openRequest?: number;
}

export function ChatsComposer(props: ChatsComposerProps) {
  const { value, onChange, recipients, busy, error, language, online, compact = false, openRequest = 0 } = props;
  const [expanded, setExpanded] = useState(!compact);
  const [toOpen, setToOpen] = useState(false);
  const [typeRequest, setTypeRequest] = useState(0);
  const toRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openRequest <= 0) return;
    setExpanded(true);
    setTypeRequest((n) => n + 1);
  }, [openRequest]);

  useEffect(() => {
    if (!toOpen) return;
    const close = (e: MouseEvent) => {
      if (toRef.current && !toRef.current.contains(e.target as Node)) setToOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [toOpen]);

  if (!expanded) {
    return (
      <button
        type="button"
        className="chats-compose-collapsed"
        onClick={() => {
          setExpanded(true);
          setTypeRequest((n) => n + 1);
        }}
        data-testid="chats-compose-open"
      >
        <span className="chats-compose-spark" aria-hidden="true">✦</span>
        <span>Ask Claude…</span>
      </button>
    );
  }

  return (
    <div className="chats-composer" data-testid="chats-composer">
      {recipients.length > 0 && (
        <div className="chats-compose-to" ref={toRef}>
          <button
            type="button"
            className="chats-compose-to-btn"
            aria-haspopup="menu"
            aria-expanded={toOpen}
            onClick={() => setToOpen((o) => !o)}
            data-testid="chats-compose-to"
          >
            To: <span className="chats-compose-to-claude">✦ Claude</span> ▾
          </button>
          {toOpen && (
            <div className="chats-compose-to-menu" role="menu" data-testid="chats-compose-to-menu">
              <button type="button" role="menuitemradio" aria-checked="true" onClick={() => setToOpen(false)}>
                <span aria-hidden="true">✦</span> Claude <span className="chats-compose-to-check" aria-hidden="true">✓</span>
              </button>
              {recipients.map((r) => (
                <button
                  key={r.relationship_id}
                  type="button"
                  role="menuitemradio"
                  aria-checked="false"
                  onClick={() => {
                    setToOpen(false);
                    props.onSendToPerson(r, value);
                  }}
                >
                  <span aria-hidden="true">🧑‍🏫</span> {r.name} <span className="chats-muted">· your tutor</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <ClaudeChatComposer
        value={value}
        onChange={onChange}
        onSend={(text, spoken, intent) => props.onSendToClaude(text, intent ?? 'ask', spoken)}
        busy={busy}
        failed={!!error}
        language={language}
        online={online}
        surface="chats_compose"
        placeholder={CHATS_COMPOSE_PLACEHOLDER}
        submitLabel="Ask"
        intentsLabel="Or send as"
        composer={(text) => chatsComposerFor(text, compact)}
        typeRequest={typeRequest}
      />
      {error && (
        <p className="chats-compose-error" role="alert">
          {error}
        </p>
      )}
      {!online && <p className="chats-compose-note">Offline — it will be sent to Claude when you're back online.</p>}
    </div>
  );
}
