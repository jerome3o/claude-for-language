/**
 * Claude threads — the shapes of `/api/claude/threads*` and of the live `claude_turn` event
 * (docs/CHAT.md "Claude threads"). Types only; the worker builds them (claude-agent/store.ts,
 * routes/claude-threads.ts), the apps read them.
 */
import type { AutoCheckResult } from '../chats/autoCheck';
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
  /**
   * My message in a card thread: the chat's "check my Chinese" of it (the ✎ mark, How to say it
   * better, Open in Coach), written in the background beside the reply — null until then / when it
   * isn't checked (English, a suggestion chip, the switch off). Absent from older servers.
   */
  auto_check?: AutoCheckResult | null;
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

/**
 * The tutor's read-only view of a student's Claude chats (`GET /api/relationships/:relId/claude-threads`,
 * shared/claude/visibility.ts): only the chats the student lets her read, trimmed — no client ids,
 * leases, unread counts, the check of his own Chinese or anything else of the learner's own.
 */
export interface TutorClaudeThread {
  id: string;
  title: string;
  context_kind: ClaudeContextKind;
  /** The descriptor for the chip (card: note_id → her card hub view of the note). No chat / message ids. */
  context: StoredClaudeContext;
  badge: ContextBadge | null;
  preview: string | null;
  /** ISO. */
  last_message_at: string | null;
  created_at: string;
  /** Finished messages (his + Claude's). */
  message_count: number;
  /** He shared this one chat himself (thread ⋯ → Share with my tutor). */
  shared: boolean;
}

export interface TutorClaudeMessage {
  id: string;
  role: 'user' | 'assistant';
  /** text | analysis (a Coach check / explain / translate result, JSON) */
  content_type: 'text' | 'analysis';
  content: string;
  answer_lang: 'zh' | 'en' | null;
  translation: string | null;
  /** JSON of the tool results (cards made, a bump…), as stored. */
  tool_results: string | null;
  created_at: string;
}

export interface TutorClaudeThreadsResponse {
  threads: TutorClaudeThread[];
  /** What the student lets his tutor read ('card_only' | 'all' | 'none'). */
  visibility: 'card_only' | 'all' | 'none';
  /** Visible chats in all. */
  total: number;
  /** Pass back as `before` for older chats; null = no more. */
  next_cursor: string | null;
}

export interface TutorClaudeThreadResponse {
  thread: TutorClaudeThread;
  messages: TutorClaudeMessage[];
}
