/**
 * Sentence Coach replies in the background (docs/CHAT.md "Chat ↔ Coach").
 *
 * The POST that starts a conversation or sends a follow-up stores the learner's
 * message and a PENDING assistant message, enqueues `{ messageId }` on
 * `coach-reply-queue` and returns at once. `runCoachReply` (the consumer) writes
 * the answer into that row, so pressing back, locking the phone or the isolate
 * ending never cancels the agent: reopening the conversation shows "Thinking…"
 * until the reply is there.
 *
 * Reliability, like the other long jobs (tutor-notes, audio lessons):
 *   - claim: a row is worked on only while `status = 'pending'`; every delivery
 *     bumps `attempts` and `started_at`;
 *   - checkpoint: the model's answer and its tool actions are saved BEFORE any
 *     action runs, and `applied` after each one — a redelivery never asks Claude
 *     again and never makes a card or a lesson twice;
 *   - retries: a busy / dropped model call is retried by the queue (≤ 3
 *     deliveries); a refusal or the last attempt marks the row `failed` with a
 *     readable reason, and Retry (`POST …/messages/:id/retry`) re-queues it;
 *   - stale sweep: a reply still pending after 10 minutes (a lost delivery) is
 *     marked failed when the conversation is read, so the page offers Retry.
 */

import type { CoachAnalysis, CoachConversation, CoachMessage, Env } from '../types';
import type { CoachChatTurn, ReadOnlyToolCall, ToolAction } from './ai';
import { coachChatWithTools } from './ai';
import { coachSentence } from './sentence-coach';
import { translateSentence } from './sentence-translate';
import { explainSentenceBriefly, toCoachBreakdown } from './sentence-explain-brief';
import { StructuredCallError } from './structured-call';
import { createCustomLessonFromSpec } from './custom-lesson';
import * as content from './content';
import * as db from '../db/queries';
import { conversationAction, type CoachAction } from '@shared/coach';
import type { AutoCheckResult } from '@shared/chats/autoCheck';

export interface CoachReplyMessage {
  messageId: string;
}

export const COACH_REPLY_MAX_ATTEMPTS = 3;
/** A pending reply older than this is taken as lost (the page offers Retry). */
export const COACH_REPLY_STALE_MINUTES = 10;

export interface CoachToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface Checkpoint {
  answer: string;
  actions: ToolAction[];
  /** How many of `actions` already ran (their results are in `results`). */
  applied: number;
  results: CoachToolResult[];
}

export type CoachChatFn = (history: CoachChatTurn[], ctx: { db: D1Database; userId: string }) => Promise<{
  answer: string;
  toolActions: ToolAction[];
  readOnlyToolCalls: ReadOnlyToolCall[];
}>;
export type CoachAnalyseFn = (action: CoachAction, input: string) => Promise<CoachAnalysis>;
export type CoachApplyFn = (userId: string, action: ToolAction) => Promise<CoachToolResult>;

export interface CoachReplyDeps {
  chat?: CoachChatFn | null;
  analyse?: CoachAnalyseFn | null;
  apply?: CoachApplyFn;
}

type CoachEnv = Pick<Env, 'DB' | 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'> & Partial<Env>;

// ---------- The model calls (real, or the E2E fake) ----------

/** Can the coach answer at all here (a key, or the E2E stand-in)? */
export function coachAvailable(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return !!env.ANTHROPIC_API_KEY || env.E2E_TEST_MODE === 'true';
}

/** The first reply of each action: correction, brief breakdown or translation. */
export function defaultAnalyse(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): CoachAnalyseFn | null {
  if (!env.ANTHROPIC_API_KEY) return env.E2E_TEST_MODE === 'true' ? fakeAnalyse : null;
  const key = env.ANTHROPIC_API_KEY;
  return async (action, input) => {
    if (action === 'check') return { kind: 'chinese', coach: await coachSentence(key, input) };
    if (action === 'explain') return { kind: 'explain', breakdown: toCoachBreakdown(input, await explainSentenceBriefly(key, { hanzi: input })) };
    return { kind: 'english', translation: await translateSentence(key, input) };
  };
}

export function defaultChat(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): CoachChatFn | null {
  if (!env.ANTHROPIC_API_KEY) return env.E2E_TEST_MODE === 'true' ? fakeChat : null;
  const key = env.ANTHROPIC_API_KEY;
  return (history, ctx) => coachChatWithTools(key, history, ctx);
}

// E2E_TEST_MODE stand-ins: slow enough (2.5 s) that a test can leave the page first.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fakeAnalyse: CoachAnalyseFn = async (action, input) => {
  await sleep(2500);
  if (action === 'translate') {
    return { kind: 'english', translation: { originalInput: input, primary: { hanzi: '我要迟到了。', pinyin: 'wǒ yào chídào le.', english: input }, alternatives: [], words: [], grammar_points: [] } };
  }
  if (action === 'explain') {
    const words = fakeSegment(input);
    return {
      kind: 'explain',
      breakdown: { hanzi: input, pinyin: words.map((w) => w.pinyin).filter(Boolean).join(' '), translation: FAKE_SENTENCES[input] ?? '(E2E) The sentence explained.', words, construction: '(E2E) Time, then the action.' },
    };
  }
  return { kind: 'chinese', coach: { originalInput: input, inputLanguage: 'chinese', isCorrect: true, corrected: { hanzi: input, pinyin: '', english: '(E2E) Looks fine.' }, critique: '(E2E) The coach would explain here.', issues: [], alternatives: [], vocabSuggestions: [] } };
};

/** A tiny lexicon so the E2E breakdown splits words like the real one (longest match first). */
const FAKE_LEXICON: Record<string, [string, string]> = {
  我: ['wǒ', 'I'], 昨天: ['zuótiān', 'yesterday'], 去: ['qù', 'go'], 银行: ['yínháng', 'bank'], 买: ['mǎi', 'buy'],
  东西: ['dōngxi', 'things'], 了: ['le', '(completed action)'], 商店: ['shāngdiàn', 'shop'], 取钱: ['qǔ qián', 'withdraw money'],
};
const FAKE_SENTENCES: Record<string, string> = { 我昨天去银行取钱了: 'I went to the bank to withdraw money yesterday.' };

function fakeSegment(input: string): Array<{ hanzi: string; pinyin: string; gloss: string }> {
  const out: Array<{ hanzi: string; pinyin: string; gloss: string }> = [];
  for (let i = 0; i < input.length; ) {
    const two = input.slice(i, i + 2);
    const hit = FAKE_LEXICON[two] ? two : input[i];
    if (/\p{Script=Han}/u.test(hit)) out.push({ hanzi: hit, pinyin: FAKE_LEXICON[hit]?.[0] ?? '', gloss: FAKE_LEXICON[hit]?.[1] ?? '(E2E)' });
    i += hit.length;
  }
  return out;
}

const fakeChat: CoachChatFn = async (history) => {
  await sleep(2500);
  const last = history[history.length - 1]?.content ?? '';
  return { answer: `(E2E) The coach's answer to: ${last.slice(0, 80)}`, toolActions: [], readOnlyToolCalls: [] };
};

// ---------- History + tool actions (shared with the inline routes) ----------

/**
 * The model conversation from the stored messages: a context header on the
 * first user turn, the stored analysis JSON as the first assistant turn, then
 * the follow-ups. Pending / failed assistant rows are left out.
 */
export function buildCoachHistory(stored: CoachMessage[], deckList: string): CoachChatTurn[] {
  const history: CoachChatTurn[] = [];
  for (const m of stored) {
    if (m.role === 'assistant' && m.status) continue;
    if (m.role === 'user' && history.length === 0) {
      history.push({
        role: 'user',
        content: [`The user's decks: ${deckList}`, '', `The user submitted this sentence to the Sentence Coach: "${m.content}"`].join('\n'),
      });
    } else if (m.content_type === 'analysis') {
      history.push({ role: 'assistant', content: `Here is the structured analysis I gave the user (rendered as rich UI):\n${m.content}` });
    } else {
      // Two user turns in a row (a failed reply in between) are merged: the API wants alternation.
      const prev = history[history.length - 1];
      if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${m.content}`;
      else history.push({ role: m.role, content: m.content });
    }
  }
  return history;
}

export async function deckListFor(database: D1Database, userId: string): Promise<string> {
  const decks = await db.getAllDecks(database, userId);
  return decks.length > 0 ? decks.map((d) => `${d.name} (id: ${d.id})`).join(', ') : 'none';
}

/** bump_cards already ran inside the loop ("⚡ Study it today"): reported so the client pulls the pocket. */
export function readOnlyResults(calls: ReadOnlyToolCall[]): CoachToolResult[] {
  return calls.filter((c) => c.tool === 'bump_cards').map((c) => ({ tool: 'bump_cards', success: !c.result.error, data: c.result }));
}

/** One mutating tool action (create_flashcards / create_custom_lesson) through the content service. */
export function defaultApply(env: Env, bg?: ExecutionContext): CoachApplyFn {
  return async (userId, action) => {
    if (action.tool === 'create_custom_lesson') {
      const result = await createCustomLessonFromSpec(env, userId, action.input, 'chat');
      return result.ok
        ? { tool: 'create_custom_lesson', success: true, data: { lesson_id: result.lesson.id, title: result.lesson.title, image_jobs: result.imageJobs } }
        : { tool: 'create_custom_lesson', success: false, error: `Invalid lesson spec: ${result.errors.join('; ')}` };
    }
    if (action.tool !== 'create_flashcards') return { tool: action.tool, success: false, error: 'Unsupported tool' };
    try {
      const input = action.input as { deck_id?: string; flashcards: Array<{ hanzi: string; pinyin: string; english: string; fun_facts?: string }> };
      const targetDeck = input.deck_id ? await db.getDeckById(env.DB, input.deck_id, userId) : null;
      if (!targetDeck) return { tool: 'create_flashcards', success: false, error: 'Target deck not found' };
      const made = await content.createNotes(env, userId, targetDeck.id, input.flashcards || [], bg ? { audio: 'background', bg } : { audio: 'queue' });
      return {
        tool: 'create_flashcards',
        success: true,
        data: { deck_name: targetDeck.name, notes: made.created.map((n) => ({ hanzi: n.hanzi, pinyin: n.pinyin, english: n.english })) },
      };
    } catch (err) {
      console.error('Coach create_flashcards error:', err);
      return { tool: 'create_flashcards', success: false, error: 'Failed to create flashcards' };
    }
  };
}

// ---------- "Open in Coach" with the chat's auto-check result ----------

/**
 * A chat message's stored auto-check (shared/chats/autoCheck.ts) as the Coach's
 * "Check my sentence" analysis, so opening it in the Coach shows the result at
 * once instead of asking Claude again.
 */
export function coachAnalysisFromAutoCheck(r: AutoCheckResult): CoachAnalysis {
  const ok = r.status === 'ok';
  const critique = ok
    ? 'This reads naturally — nothing to fix.'
    : r.mistakes.map((m) => `${m.quote ? `${m.quote} → ` : ''}${m.fix}: ${m.why}`).join('\n') || 'A small fix makes this more natural.';
  return {
    kind: 'chinese',
    coach: {
      originalInput: r.text,
      inputLanguage: 'chinese',
      isCorrect: ok,
      corrected: { hanzi: ok ? r.text : r.corrected, pinyin: r.corrected_pinyin, english: r.corrected_english },
      critique,
      issues: r.mistakes.map((m) => ({ type: 'grammar' as const, original: m.quote, suggestion: m.fix, explanation: m.why })),
      alternatives: r.alternative ? [{ hanzi: r.alternative.hanzi, pinyin: r.alternative.pinyin, english: r.alternative.english, ...(r.alternative.note ? { note: r.alternative.note } : {}) }] : [],
      vocabSuggestions: r.mistakes.flatMap((m) => (m.card ? [{ hanzi: m.card.hanzi, pinyin: m.card.pinyin, english: m.card.english, reason: m.why }] : [])),
    },
  };
}

// ---------- Queue + sweep ----------

/** Queue the reply; without the queue binding (tests, a misconfigured env) it runs in waitUntil. */
export async function enqueueCoachReply(
  env: Env,
  messageId: string,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  if (env.COACH_REPLY_QUEUE) {
    await env.COACH_REPLY_QUEUE.send({ messageId });
    return;
  }
  const run = runCoachReply(env, messageId).then((o) => console.log('[coach] reply (inline)', messageId, o));
  if (waitUntil) waitUntil(run);
  else await run;
}

/** Pending replies of this user's conversations that are stuck → failed (Retry shows). */
export async function sweepStaleCoachReplies(database: D1Database, userId: string, conversationId?: string): Promise<number> {
  const res = await database
    .prepare(
      `UPDATE coach_messages
          SET status = 'failed', error = 'This reply took too long — try again.'
        WHERE status = 'pending'
          AND COALESCE(started_at, created_at) < datetime('now', '-${COACH_REPLY_STALE_MINUTES} minutes')
          AND conversation_id IN (SELECT id FROM coach_conversations WHERE user_id = ?${conversationId ? ' AND id = ?' : ''})`,
    )
    .bind(...(conversationId ? [userId, conversationId] : [userId]))
    .run();
  return res.meta?.changes ?? 0;
}

// ---------- The job ----------

export type CoachReplyOutcome = 'done' | 'skipped' | 'retry' | 'failed';

/** Busy / dropped / overloaded = worth another delivery; a refusal (4xx) is not. */
export function isRetryableCoachError(err: unknown): boolean {
  if (err instanceof StructuredCallError) return err.retryable;
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') return status === 429 || status === 408 || status >= 500;
  return true;
}

function readableError(err: unknown, retryable: boolean): string {
  if (!retryable) return 'Claude couldn’t answer this one — try rephrasing it.';
  return 'Claude is busy right now — try again in a moment.';
}

function parseCheckpoint(raw: string | null | undefined): Checkpoint | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Checkpoint;
    return v && typeof v.answer === 'string' && Array.isArray(v.actions) && Array.isArray(v.results) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Write the reply into one pending assistant message. Never throws: 'retry'
 * asks the queue for another delivery (the row stays pending), 'failed' marked
 * it failed, 'skipped' = nothing pending there (done, deleted, or claimed).
 */
export async function runCoachReply(env: CoachEnv, messageId: string, deps: CoachReplyDeps = {}): Promise<CoachReplyOutcome> {
  const row = await env.DB
    .prepare(
      `SELECT m.*, c.user_id AS c_user_id, c.action AS c_action, c.input_language AS c_input_language
         FROM coach_messages m JOIN coach_conversations c ON c.id = m.conversation_id
        WHERE m.id = ?`,
    )
    .bind(messageId)
    .first<CoachMessage & { c_user_id: string; c_action: CoachConversation['action']; c_input_language: string; attempts: number; checkpoint: string | null }>();
  if (!row || row.status !== 'pending' || row.role !== 'assistant') return 'skipped';
  const claimed = await env.DB
    .prepare(`UPDATE coach_messages SET attempts = attempts + 1, started_at = datetime('now') WHERE id = ? AND status = 'pending'`)
    .bind(messageId)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) return 'skipped';
  const attempt = (row.attempts ?? 0) + 1;
  const userId = row.c_user_id;

  try {
    const stored = await db.getCoachMessages(env.DB, row.conversation_id);
    const index = stored.findIndex((m) => m.id === messageId);
    const before = index >= 0 ? stored.slice(0, index) : stored;

    if (row.content_type === 'analysis') {
      const input = before.find((m) => m.role === 'user')?.content ?? '';
      const analyse = deps.analyse === undefined ? defaultAnalyse(env) : deps.analyse;
      if (!analyse || !input) throw new StructuredCallError('The coach is not configured', false);
      const action = conversationAction({ action: row.c_action, input_language: row.c_input_language });
      const analysis = await analyse(action, input);
      await finish(env.DB, messageId, JSON.stringify(analysis), null);
      return 'done';
    }

    let cp = parseCheckpoint(row.checkpoint);
    if (!cp) {
      const chat = deps.chat === undefined ? defaultChat(env) : deps.chat;
      if (!chat) throw new StructuredCallError('The coach is not configured', false);
      const history = buildCoachHistory(before, await deckListFor(env.DB, userId));
      if (history.length === 0 || history[history.length - 1].role !== 'user') throw new StructuredCallError('Nothing to answer', false);
      const out = await chat(history, { db: env.DB, userId });
      cp = { answer: out.answer, actions: out.toolActions, applied: 0, results: readOnlyResults(out.readOnlyToolCalls) };
      await saveCheckpoint(env.DB, messageId, cp);
    }
    const apply = deps.apply ?? defaultApply(env as Env);
    while (cp.applied < cp.actions.length) {
      cp.results.push(await apply(userId, cp.actions[cp.applied]));
      cp.applied += 1;
      await saveCheckpoint(env.DB, messageId, cp);
    }
    await finish(env.DB, messageId, cp.answer, cp.results.length ? JSON.stringify(cp.results) : null);
    return 'done';
  } catch (err) {
    const retryable = isRetryableCoachError(err);
    console.error('[coach] reply failed', messageId, `attempt ${attempt}`, err instanceof Error ? err.message : err);
    if (retryable && attempt < COACH_REPLY_MAX_ATTEMPTS) return 'retry';
    await env.DB
      .prepare(`UPDATE coach_messages SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'`)
      .bind(readableError(err, retryable), messageId)
      .run();
    return 'failed';
  }
}

async function saveCheckpoint(database: D1Database, messageId: string, cp: Checkpoint): Promise<void> {
  await database.prepare(`UPDATE coach_messages SET checkpoint = ? WHERE id = ? AND status = 'pending'`).bind(JSON.stringify(cp), messageId).run();
}

async function finish(database: D1Database, messageId: string, body: string, toolResults: string | null): Promise<void> {
  await database
    .prepare(
      `UPDATE coach_messages SET content = ?, tool_results = ?, status = NULL, error = NULL, checkpoint = NULL
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(body, toolResults, messageId)
    .run();
  await database
    .prepare(`UPDATE coach_conversations SET updated_at = datetime('now') WHERE id = (SELECT conversation_id FROM coach_messages WHERE id = ?)`)
    .bind(messageId)
    .run();
}

/** Back to pending for another go (Retry); the checkpoint is kept so finished tool actions don't run twice. */
export async function retryCoachReply(database: D1Database, messageId: string): Promise<boolean> {
  const res = await database
    .prepare(`UPDATE coach_messages SET status = 'pending', error = NULL, attempts = 0, started_at = NULL WHERE id = ? AND status = 'failed'`)
    .bind(messageId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
