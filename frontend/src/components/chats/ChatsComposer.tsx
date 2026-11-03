/**
 * The box at the bottom of the Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"),
 * Claude.ai style and compact: it always goes to Claude (a chat with a person starts from ✏️ New chat
 * or her row). Idle it is one small row — ✏️ Type · 🎤 Say it. Ask is the main button (Enter); once
 * there is text (typed, or a finished dictation) ✏️ Check and 🔍 Explain sit beside it for Chinese,
 * 🔤 Translate for English (`composerFor('general', …)` + `coachButtons`, shared/claude/contexts.ts) —
 * never before. Sending starts a new general thread with that intent and opens it (offline: queued).
 *
 * `compact` (the tutor's view): Ask · Translate only (the Coach's Check / Explain are a learner's tools).
 */
import { useEffect, useState } from 'react';
import { composerFor, type ClaudeComposer } from '@shared/claude/contexts';
import type { ClaudeIntent } from '@shared/claude/context';
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
  busy: boolean;
  error: string | null;
  language: AskLanguage;
  online: boolean;
  compact?: boolean;
  /** Each new value > 0: open the box for typing (More → Ask Claude, ✏️ → Claude, a handed-over text). */
  openRequest?: number;
}

export function ChatsComposer(props: ChatsComposerProps) {
  const { value, onChange, busy, error, language, online, compact = false, openRequest = 0 } = props;
  const [typeRequest, setTypeRequest] = useState(0);

  useEffect(() => {
    if (openRequest > 0) setTypeRequest((n) => n + 1);
  }, [openRequest]);

  return (
    <div className="chats-composer" data-testid="chats-composer">
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
        intentsOnlyWithText
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
