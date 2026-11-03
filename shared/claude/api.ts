/**
 * Claude threads — the shapes of `/api/claude/threads*` and of the live `claude_turn` event
 * (docs/CHAT.md "Claude threads"). Types only; the worker builds them (claude-agent/store.ts,
 * routes/claude-threads.ts), the apps read them.
 */
import type { ClaudeContextKind, ClaudeIntent, ContextBadge, StoredClaudeContext } from './context';

/** One inbox row. */
export interface ClaudeThreadSummary {
  id: string;
  client_id: string | null;
  title: string;
  context_kind: ClaudeContextKind;
  /** The descriptor + its snapshot (label / sublabel). */
  context: StoredClaudeContext;
  /** The row's chip ("📇 Asked on card · 银行"), null for a plain chat. */
  badge: ContextBadge | null;
  /** The first message's intent (a chat started with ✏️ Check …). */
  first_intent: ClaudeIntent | null;
  preview: string | null;
  /** ISO. */
  last_message_at: string | null;
  created_at: string;
  /** Replies finished since the thread was last opened. */
  unread: number;
  /** Claude is writing a reply / a reply failed (Retry). */
  pending: boolean;
  failed: boolean;
  /** No reply path yet (practice chats copied from the tutor-chat tables). */
  read_only: boolean;
  archived: boolean;
  /** null = the account's default (card questions visible to the tutor). */
  tutor_visible: boolean | null;
  /** The thread's answer language (null = the account's Ask Claude language). */
  language: 'zh' | 'en' | null;
  /** coach | ask | app | note_questions | practice | discussion */
  source: string | null;
}

export interface ClaudeThreadMessage {
  id: string;
  thread_id: string;
  client_id: string | null;
  role: 'user' | 'assistant';
  /** text | analysis (a Coach check / explain / translate result, JSON) | mistake_lesson (JSON) */
  content_type: string;
  /** For a reply still being written: the text so far. */
  content: string;
  intent: ClaudeIntent | null;
  /** null = done; 'pending' = being written (see `streaming`); 'failed' (see error; Retry). */
  status: 'pending' | 'failed' | null;
  /** Pending with some text already: the reply is streaming. */
  streaming: boolean;
  error: string | null;
  answer_lang: 'zh' | 'en' | null;
  translation: string | null;
  /** JSON of the tool results (cards made, a lesson, a bump…), as the Coach stores them. */
  tool_results: string | null;
  created_at: string;
  updated_at: string | null;
}

export type ClaudeTurnStatus = 'thinking' | 'tool' | 'streaming' | 'done' | 'failed';

/**
 * The live event of a reply being written, pushed to the OWNER's sockets only (ChatHub). `text` is
 * the WHOLE text so far (a dropped frame never matters); `seq` grows per reply — keep the highest.
 */
export interface ClaudeTurnEvent {
  type: 'claude_turn';
  thread_id: string;
  message_id: string;
  seq: number;
  status: ClaudeTurnStatus;
  text?: string;
  /** The read tool running (status 'tool'), e.g. search_cards. */
  tool?: string;
  /** A failed reply's readable reason. */
  error?: string;
}
