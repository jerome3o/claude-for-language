/**
 * Claude threads — the context descriptor (docs/CHAT.md "Claude threads"; the unified-Claude-chats
 * plan §2.3). Every conversation with Claude is a THREAD in some context: a chat about anything
 * (`general` — the Chats composer, the Sentence Coach, its "💬 Ask Claude" chat), Ask Claude on a
 * study card (`card`), a Claude practice / role-play chat (`practice` — the copied old ones from
 * the tutor-chat tables carry their `conversation_id` and stay read-only; new ones carry the scenario,
 * shared/claude/practice.ts), Discuss with Claude about one chat message (`chat_message`), a page of a
 * graded reader (`reader`) or one exercise of a mini lesson (`exercise`).
 *
 * Stored on the thread as `context_kind` + `context_ref` (canonical ref) + `context_json` (the
 * descriptor + a snapshot — label / sublabel — so the inbox draws a badge offline, without a fetch).
 * Pure: used by the worker (validation, titles, badges) and, later, both apps (Lab port + parity).
 */

export type ClaudeContextKind = 'general' | 'card' | 'practice' | 'chat_message' | 'reader' | 'exercise';

export const CLAUDE_CONTEXT_KINDS: readonly ClaudeContextKind[] = ['general', 'card', 'practice', 'chat_message', 'reader', 'exercise'];

/** At most this many looked-up / said-wrong words of a reader page ride on the context. */
export const READER_CONTEXT_WORDS_MAX = 12;

/**
 * The learner's answer to an exercise as the exercise context carries it (what he wrote / said, and
 * Claude's answer check of it when there was one — shared/lesson/answerCheck.ts, trimmed).
 */
export interface ExerciseAnswerContext {
  text: string;
  /** correct | acceptable | almost | wrong */
  verdict?: string;
  headline?: string;
  corrected?: string;
  /** ≤ 3 one-line tips. */
  tips?: string[];
}

export type ClaudeThreadContext =
  | { kind: 'general' }
  | {
      kind: 'card';
      note_id: string;
      card_type?: string;
      /** The answer typed on a meaning → hanzi / audio → hanzi card, when he asks right after it. */
      typed?: { answer: string; correct?: string };
    }
  | {
      kind: 'practice';
      /** An old practice chat copied from the tutor-chat tables (`pc-<id>`, read-only). New ones have none. */
      conversation_id?: string;
      /** The situation ("在饭店点菜"), who Claude plays, who the learner is. */
      scenario?: string;
      ai_role?: string;
      user_role?: string;
      /** beginner | intermediate | advanced (shared/claude/practice.ts PRACTICE_LEVELS). */
      level?: string;
      /** The persona's voice for read-aloud (a LESSON_VOICE_IDS id; the server picks it at creation). */
      voice_id?: string;
      /** Started from a study card ("Roleplay this word"): its note. */
      note_id?: string;
    }
  | { kind: 'chat_message'; message_id: string; conversation_id?: string }
  | {
      kind: 'reader';
      reader_id: string;
      /** The page he asked on (a thread is about one page); none = the whole story. */
      page_id?: string;
      /** Its 1-based number (the badge: "p.3"). */
      page?: number;
      /** Words he tapped on this page in this reading (the reader word recap's run), story order. */
      looked_up?: string[];
      /** Words a 🎤 Read it aloud take heard wrong on this page. */
      said_wrong?: string[];
    }
  | {
      kind: 'exercise';
      lesson_id: string;
      /** `s<section>e<index>` (shared/study/lessonRun.ts `exerciseKey`). */
      exercise_key: string;
      exercise_type?: string;
      /** His answer on this showing (+ its check), when he asks after answering. */
      answer?: ExerciseAnswerContext;
    };

/** What a learner's message asks for: a plain question, or one of the Coach's buttons. */
export type ClaudeIntent = 'ask' | 'check' | 'explain' | 'translate';

export const CLAUDE_INTENTS: readonly ClaudeIntent[] = ['ask', 'check', 'explain', 'translate'];

/** The snapshot kept beside the descriptor: what the badge says without a fetch. */
export interface ClaudeContextSnapshot {
  /** 银行 (card), 点菜 (practice), the first words of the message (chat_message), the story's title (reader), the exercise type's name (exercise). */
  label?: string;
  /** The deck (card), the role (practice), the lesson's title (exercise). */
  sublabel?: string;
}

export type StoredClaudeContext = ClaudeThreadContext & ClaudeContextSnapshot;

const ID_MAX = 100;
const TEXT_MAX = 200;

function id(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.length <= ID_MAX ? v.trim() : null;
}

function text(v: unknown, max = TEXT_MAX): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

/** A list of short words: trimmed, de-duplicated, ≤ READER_CONTEXT_WORDS_MAX; none → undefined. */
function words(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const w of v) {
    const t = text(w, 20);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= READER_CONTEXT_WORDS_MAX) break;
  }
  return out.length ? out : undefined;
}

/** An exercise answer from a request / the stored context, checked and trimmed; none → undefined. */
export function parseExerciseAnswer(v: unknown): ExerciseAnswerContext | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const answer = text(r.text, 400);
  if (!answer) return undefined;
  const out: ExerciseAnswerContext = { text: answer };
  const verdict = text(r.verdict, 20);
  if (verdict) out.verdict = verdict;
  const headline = text(r.headline, 200);
  if (headline) out.headline = headline;
  const corrected = text(r.corrected, 400);
  if (corrected) out.corrected = corrected;
  if (Array.isArray(r.tips)) {
    const tips = r.tips.map((t) => text(t, 200)).filter((t): t is string => !!t).slice(0, 3);
    if (tips.length) out.tips = tips;
  }
  return out;
}

/** `s<section>e<index>`. */
const EXERCISE_KEY = /^s\d{1,3}e\d{1,3}$/;

/**
 * A context as an app sends it (or as stored), checked: unknown kinds, missing refs and wrong types
 * → null. Unknown fields are dropped.
 */
export function parseClaudeContext(raw: unknown): ClaudeThreadContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'general':
      return { kind: 'general' };
    case 'card': {
      const noteId = id(r.note_id);
      if (!noteId) return null;
      const out: ClaudeThreadContext = { kind: 'card', note_id: noteId };
      const cardType = text(r.card_type, 40);
      if (cardType) out.card_type = cardType;
      const typed = r.typed as Record<string, unknown> | undefined;
      const answer = typed && typeof typed === 'object' ? text(typed.answer, 400) : undefined;
      if (answer) {
        const correct = text(typed!.correct, 400);
        out.typed = correct ? { answer, correct } : { answer };
      }
      return out;
    }
    case 'practice': {
      // An old copied chat (its conversation), or a new one: a situation and / or a card's word.
      const out: Extract<ClaudeThreadContext, { kind: 'practice' }> = { kind: 'practice' };
      const conversationId = id(r.conversation_id);
      if (conversationId) out.conversation_id = conversationId;
      for (const k of ['scenario', 'ai_role', 'user_role', 'voice_id'] as const) {
        const v = text(r[k]);
        if (v) out[k] = v;
      }
      const level = text(r.level, 40);
      if (level) out.level = level;
      const noteId = id(r.note_id);
      if (noteId) out.note_id = noteId;
      if (!out.conversation_id && !out.scenario && !out.note_id) return null;
      return out;
    }
    case 'chat_message': {
      const messageId = id(r.message_id);
      if (!messageId) return null;
      const conversationId = id(r.conversation_id);
      return conversationId ? { kind: 'chat_message', message_id: messageId, conversation_id: conversationId } : { kind: 'chat_message', message_id: messageId };
    }
    case 'reader': {
      const readerId = id(r.reader_id);
      if (!readerId) return null;
      const out: Extract<ClaudeThreadContext, { kind: 'reader' }> = { kind: 'reader', reader_id: readerId };
      const pageId = id(r.page_id);
      if (pageId) out.page_id = pageId;
      if (typeof r.page === 'number' && Number.isInteger(r.page) && r.page >= 1 && r.page <= 999) out.page = r.page;
      const lookedUp = words(r.looked_up);
      if (lookedUp) out.looked_up = lookedUp;
      const saidWrong = words(r.said_wrong);
      if (saidWrong) out.said_wrong = saidWrong;
      return out;
    }
    case 'exercise': {
      const lessonId = id(r.lesson_id);
      const key = typeof r.exercise_key === 'string' ? r.exercise_key.trim() : '';
      if (!lessonId || !EXERCISE_KEY.test(key)) return null;
      const out: Extract<ClaudeThreadContext, { kind: 'exercise' }> = { kind: 'exercise', lesson_id: lessonId, exercise_key: key };
      const type = text(r.exercise_type, 40);
      if (type) out.exercise_type = type;
      const answer = parseExerciseAnswer(r.answer);
      if (answer) out.answer = answer;
      return out;
    }
    default:
      return null;
  }
}

/** The stored descriptor + snapshot (context_json), tolerant of NULL / bad JSON (→ general). */
export function parseStoredContext(kind: string | null | undefined, json: string | null | undefined): StoredClaudeContext {
  let raw: Record<string, unknown> = {};
  if (json) {
    try {
      const v = JSON.parse(json);
      if (v && typeof v === 'object') raw = v as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  const ctx = parseClaudeContext({ ...raw, kind: kind ?? raw.kind ?? 'general' }) ?? { kind: 'general' as const };
  const label = text(raw.label, 80);
  const sublabel = text(raw.sublabel, 80);
  return { ...ctx, ...(label ? { label } : {}), ...(sublabel ? { sublabel } : {}) };
}

/** The canonical ref stored in `context_ref` (null for general). */
export function contextRef(ctx: ClaudeThreadContext): string | null {
  switch (ctx.kind) {
    case 'card':
      return ctx.note_id;
    case 'practice':
      return ctx.conversation_id ?? null;
    case 'chat_message':
      return ctx.message_id;
    case 'reader':
      return ctx.page_id ? `${ctx.reader_id}:${ctx.page_id}` : ctx.reader_id;
    case 'exercise':
      return `${ctx.lesson_id}:${ctx.exercise_key}`;
    default:
      return null;
  }
}

/** Which intents a context's composer offers: the Coach's buttons only in a general chat; Ask elsewhere. */
export function intentsFor(kind: ClaudeContextKind): readonly ClaudeIntent[] {
  if (kind === 'general') return CLAUDE_INTENTS;
  return ['ask'];
}

export function parseIntent(v: unknown): ClaudeIntent | null {
  return typeof v === 'string' && (CLAUDE_INTENTS as readonly string[]).includes(v) ? (v as ClaudeIntent) : null;
}

export interface ContextBadge {
  icon: string;
  /** "Asked on card · 银行" */
  text: string;
}

const INTENT_BADGES: Record<Exclude<ClaudeIntent, 'ask'>, ContextBadge> = {
  check: { icon: '✏️', text: 'Check' },
  explain: { icon: '🔍', text: 'Explain' },
  translate: { icon: '🔤', text: 'Translate' },
};

/**
 * The chip on an inbox row / a thread header: where the chat happened. A general chat has none,
 * unless it started with one of the Coach's buttons (its first message's intent).
 */
export function contextBadge(ctx: StoredClaudeContext, firstIntent?: ClaudeIntent | null): ContextBadge | null {
  const label = ctx.label ? ` · ${ctx.label}` : '';
  switch (ctx.kind) {
    case 'card':
      return { icon: '📇', text: `Asked on card${label}` };
    case 'practice':
      return { icon: '🎭', text: `Practice${ctx.scenario ? ` · ${ctx.scenario.slice(0, 40)}` : label}` };
    case 'chat_message':
      return { icon: '💬', text: `About a message${label}` };
    case 'reader':
      return { icon: '📖', text: `Reader${label}${ctx.page ? ` p.${ctx.page}` : ''}` };
    case 'exercise':
      return { icon: '🧩', text: `Exercise${label}` };
    default:
      return firstIntent && firstIntent !== 'ask' ? INTENT_BADGES[firstIntent] : null;
  }
}

export const CLAUDE_TITLE_MAX = 120;

/** A thread's title: the first message on one line (≤ 120), else a word for the context. */
export function titleFor(ctx: StoredClaudeContext, firstText: string): string {
  const line = firstText.replace(/\s+/g, ' ').trim();
  if (line) return line.length > CLAUDE_TITLE_MAX ? `${line.slice(0, CLAUDE_TITLE_MAX - 1)}…` : line;
  switch (ctx.kind) {
    case 'card':
      return ctx.label ? `About ${ctx.label}` : 'About a card';
    case 'practice':
      return ctx.scenario ? `Practice: ${ctx.scenario}` : 'Practice with Claude';
    case 'chat_message':
      return 'About a message';
    case 'reader':
      return ctx.label ? `About ${ctx.label}` : 'About a story';
    case 'exercise':
      return 'About an exercise';
    default:
      return 'Chat with Claude';
  }
}

export const CLAUDE_PREVIEW_MAX = 120;

/** An inbox preview line from a message: one line, ≤ 120 characters. */
export function previewOf(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > CLAUDE_PREVIEW_MAX ? `${line.slice(0, CLAUDE_PREVIEW_MAX - 1)}…` : line;
}
