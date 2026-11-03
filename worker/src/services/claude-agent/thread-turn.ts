/**
 * Claude threads — running one reply (docs/CHAT.md "Claude threads — a reply is never lost"; the
 * unified-Claude-chats plan §3.5). A reply is a PENDING assistant row; this writes it.
 *
 *   1. The POST stores the learner's message + the pending reply (one batch) and answers 202.
 *   2. `startThreadTurn`: a WATCHDOG `{ kind: 'claude_turn', messageId }` goes on coach-reply-queue
 *      (delayed 45 s), then the reply starts INLINE in the same request (waitUntil — no queue hop).
 *   3. `runThreadTurn` claims the row with a LEASE (`lease_until`, 40 s): only a pending row nobody
 *      holds. The lease is renewed by every partial write and by stream activity.
 *   4. The model is STREAMED (the harness's streaming flag): the text so far goes to the owner's
 *      sockets as `claude_turn` events (live.ts, ≤ every 120 ms) and into the row (≤ every 400 ms)
 *      for the apps that poll.
 *   5. The answer + its tool actions are CHECKPOINTED before any action runs (`applyCheckpointed`), so
 *      a resume never asks Claude again nor makes a card twice; then the row is finished, the thread
 *      touched (+1 unread), `claude_turn {done}` pushed; a card turn also writes `note_questions`
 *      (the older apps' history, card hub, tutor view read it).
 *   6. The watchdog delivery finds the row done (ack), still leased (`busy` → again in 45 s) or
 *      abandoned — an isolate killed mid-stream, the waitUntil limit — and resumes it. A busy model
 *      → `retry` (another delivery); a refusal or the last attempt → failed + a readable reason
 *      (Retry: `POST /api/claude/threads/:id/messages/:mid/retry`).
 *
 * Contexts (the thread's `context_kind`): `general` (a plain chat — or, when it began with ✏️ Check /
 * 🔍 Explain / Translate, the Coach's follow-up context `coach`), `card` (Ask Claude on a card),
 * `chat_message` (Discuss with Claude — create_flashcards proposals are returned, never saved).
 * `practice` threads are read-only for now. The Coach's structured first replies (check / explain /
 * translate) and mistake lessons stay on `runCoachReply` (coach-replies.ts) — not streamed.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { parseStoredContext } from '@shared/claude/context';
import type { AskLanguage } from '@shared/study/askClaude';
import type { CoachMessage, Env } from '../../types';
import * as db from '../../db/queries';
import { cachedConversationTTS } from '../tts-cache';
import { askSettings, pregenerateAskClip, type AskClipMaker } from '../ask-claude';
import { coachAskTurns, storedAskAnswer } from '../claude-chat';
import { buildCoachHistory, deckListFor, defaultApply, isRetryableCoachError, readOnlyResults, type CoachApplyFn } from '../coach-replies';
import { StructuredCallError } from '../structured-call';
import { applyCardAction, type AppliedToolResult } from './apply';
import { fakeStreamingClient } from './fake';
import { LiveTurn, type LiveTurnOptions } from './live';
import { applyCheckpointed, type ActionCheckpoint } from './run';
import { proposedFlashcards } from './contexts/chat_message';
import { runClaudeTurn } from './index';
import * as store from './store';
import { ClaudeContextError, type AgentRuntime, type ChatTurn, type ClaudeContext, type ToolAction } from './types';

export interface ClaudeTurnQueueMessage {
  kind: 'claude_turn';
  messageId: string;
}

/** The watchdog's delay: a little longer than the lease. */
export const WATCHDOG_DELAY_SECONDS = 45;
/** A quick second go after a busy model in the inline run. */
export const RETRY_DELAY_SECONDS = 5;
export const THREAD_TURN_MAX_ATTEMPTS = 3;

export type ThreadTurnOutcome = 'done' | 'skipped' | 'busy' | 'retry' | 'failed';

export type ThreadTurnEnv = Env;

export interface ThreadTurnDeps {
  /** The model (tests). Default: the E2E stand-in in E2E_TEST_MODE (checked first), else the real one. */
  client?: Pick<Anthropic, 'messages'>;
  runtime?: AgentRuntime;
  /** A card turn's write actions (default: apply.ts, through the content service). */
  applyCard?: (userId: string, noteId: string, action: ToolAction) => Promise<AppliedToolResult>;
  /** A coach follow-up's write actions (default: coach-replies `defaultApply`). */
  applyCoach?: CoachApplyFn;
  live?: LiveTurnOptions;
  leaseSeconds?: number;
  /** 🎧 the answer's clip (null = never; default: the shared TTS cache, never in E2E). */
  clip?: AskClipMaker | null;
  /** Background work after the reply (the clip); default: awaited. */
  waitUntil?: (p: Promise<unknown>) => void;
}

type Checkpoint = ActionCheckpoint<ToolAction, AppliedToolResult>;

type Mode = 'general' | 'coach' | 'card' | 'chat_message';

interface PreparedThreadTurn {
  mode: Mode;
  ctx: ClaudeContext;
  turns: ChatTurn[];
  language?: AskLanguage;
  /** The learner's message this reply answers. */
  question: { id: string; content: string } | null;
}

/** The text turns of a thread before the reply (finished messages; one role in a row merged). */
export function threadTextTurns(before: readonly store.MessageRow[]): ChatTurn[] {
  return coachAskTurns(before as unknown as CoachMessage[]);
}

/** What a reply is written for, from its thread. Throws a non-retryable error when it can't be. */
export async function prepareThreadTurn(database: D1Database, row: store.TurnRow, before: store.MessageRow[]): Promise<PreparedThreadTurn> {
  if (row.t_read_only) throw new StructuredCallError('This chat can’t continue here yet', false);
  const context = parseStoredContext(row.t_context_kind, row.t_context_json);
  const lastUser = [...before].reverse().find((m) => m.role === 'user');
  const question = lastUser ? { id: lastUser.id, content: lastUser.content } : null;
  const language: AskLanguage | undefined = row.answer_lang === 'zh' || row.answer_lang === 'en' ? row.answer_lang : undefined;
  switch (context.kind) {
    case 'card':
      return {
        mode: 'card',
        ctx: { kind: 'card', note_id: context.note_id, ...(context.typed ? { typed: context.typed } : {}) },
        turns: threadTextTurns(before),
        language: language ?? 'en',
        question,
      };
    case 'chat_message':
      return { mode: 'chat_message', ctx: { kind: 'chat_message', message_id: context.message_id }, turns: threadTextTurns(before), question };
    case 'practice':
      throw new StructuredCallError('This chat can’t continue here yet', false);
    default: {
      // A chat that began with the Coach's ✏️ Check / 🔍 Explain / Translate continues as a coach follow-up.
      if (before.some((m) => m.content_type === 'analysis')) {
        const turns = buildCoachHistory(before as unknown as CoachMessage[], await deckListFor(database, row.t_user_id));
        return { mode: 'coach', ctx: { kind: 'coach', conversation_id: row.conversation_id }, turns, question };
      }
      return { mode: 'general', ctx: { kind: 'general' }, turns: threadTextTurns(before), language: language ?? 'zh', question };
    }
  }
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

function readableError(err: unknown, retryable: boolean): string {
  if (err instanceof ClaudeContextError) return err.status === 404 ? 'What this chat was about is gone.' : 'You can’t continue this chat any more.';
  if (err instanceof StructuredCallError && !retryable && /can’t continue/.test(err.message)) return err.message;
  if (!retryable) return 'Claude couldn’t answer this one — try rephrasing it.';
  return 'Claude is busy right now — try again in a moment.';
}

function retryableOf(err: unknown): boolean {
  if (err instanceof ClaudeContextError) return false;
  return isRetryableCoachError(err);
}

/** The model of a turn: the E2E stand-in first (hermetic E2E), else the caller's, else the real one (null = none). */
function clientFor(env: ThreadTurnEnv, deps: ThreadTurnDeps, language: AskLanguage | undefined): Pick<Anthropic, 'messages'> | undefined | null {
  if (env.E2E_TEST_MODE === 'true') return fakeStreamingClient(language ?? 'en');
  if (deps.client) return deps.client;
  return env.ANTHROPIC_API_KEY ? undefined : null;
}

/**
 * Writes one pending reply. Never throws. 'skipped' = nothing to do (done, failed, gone, not a
 * thread reply); 'busy' = another runner holds the lease; 'retry' = a busy model, the row is pending
 * again for the next delivery; 'failed' = marked failed with a readable reason.
 */
export async function runThreadTurn(env: ThreadTurnEnv, messageId: string, opts: ThreadTurnDeps & { inline?: boolean } = {}): Promise<ThreadTurnOutcome> {
  const row = await store.getTurnRow(env.DB, messageId);
  if (!row || row.role !== 'assistant' || row.status !== 'pending' || row.t_deleted_at) return 'skipped';
  if (row.content_type !== 'text') return 'skipped'; // the Coach's structured replies: runCoachReply
  const leaseSeconds = opts.leaseSeconds ?? store.TURN_LEASE_SECONDS;
  if (!(await store.claimTurn(env.DB, messageId, leaseSeconds))) return 'busy';
  const attempt = (row.attempts ?? 0) + 1;
  const userId = row.t_user_id;
  const threadId = row.conversation_id;
  const live = new LiveTurn(env, { userId, threadId, messageId }, { leaseSeconds, ...(opts.live ?? {}) });
  live.thinking();
  const started = Date.now();
  let firstTextAt: number | null = null;
  let rounds = 0;

  try {
    const stored = await store.getThreadMessages(env.DB, threadId);
    const index = stored.findIndex((m) => m.id === messageId);
    const before = index >= 0 ? stored.slice(0, index) : stored;
    const prepared = await prepareThreadTurn(env.DB, row, before);
    if (prepared.turns.length === 0 || prepared.turns[prepared.turns.length - 1].role !== 'user') throw new StructuredCallError('Nothing to answer', false);

    let cp = parseCheckpoint(row.checkpoint);
    if (!cp) {
      const client = clientFor(env, opts, prepared.language);
      if (client === null) throw new StructuredCallError('AI is not configured', false);
      const out = await runClaudeTurn(
        env,
        prepared.ctx,
        { userId, turns: prepared.turns, ...(prepared.language ? { language: prepared.language } : {}), bumpSource: bumpSourceOf(prepared.mode) },
        {
          ...(client ? { client } : {}),
          ...(opts.runtime ? { runtime: opts.runtime } : {}),
          inline: !!opts.inline,
          stream: {
            onText: (text) => {
              if (firstTextAt === null) firstTextAt = Date.now();
              live.update(text);
            },
            onTool: (tool) => live.tool(tool),
            onActivity: () => live.activity(),
          },
        },
      );
      rounds = out.rounds;
      const answer = prepared.mode === 'general' ? storedAskAnswer(out.answer, prepared.language ?? 'zh') : out.answer;
      if (!answer.trim()) throw new StructuredCallError('Claude gave an empty answer', true);
      const results: AppliedToolResult[] = readOnlyResults(out.readOnlyToolCalls);
      let actions = out.toolActions;
      if (prepared.mode === 'chat_message') {
        // Discuss with Claude: the cards come back for the app's review sheet, never saved here.
        const flashcards = proposedFlashcards(out.toolActions);
        if (flashcards) results.push({ tool: 'propose_flashcards', success: true, data: { flashcards } });
        actions = [];
      }
      await live.settle();
      const saved = await store.saveTurnCheckpoint(env.DB, messageId, JSON.stringify({ answer, actions, applied: 0, results } satisfies Checkpoint), true);
      cp = parseCheckpoint(saved) ?? { answer, actions, applied: 0, results };
    } else {
      await live.settle();
    }

    const apply = applierFor(env, prepared, userId, opts);
    await applyCheckpointed(cp, apply, (next) => store.saveTurnCheckpoint(env.DB, messageId, JSON.stringify(next)).then(() => undefined));

    const meta = {
      inline: !!opts.inline,
      attempt,
      total_ms: Date.now() - started,
      ...(firstTextAt !== null ? { first_token_ms: firstTextAt - started } : {}),
      ...(rounds ? { rounds } : {}),
    };
    const finished = await store.finishTurn(env.DB, messageId, threadId, cp.answer, cp.results.length ? JSON.stringify(cp.results) : null, meta);
    if (!finished) return 'skipped';
    await live.done(cp.answer);

    if (prepared.mode === 'card' && prepared.question) await dualWriteNoteQuestion(env.DB, row, prepared, cp.answer, messageId);
    if ((prepared.mode === 'general' || prepared.mode === 'card') && prepared.language === 'zh') {
      const clip = clipMaker(env, opts);
      if (clip) {
        const work = (async () => {
          if ((await askSettings(env.DB, userId)).listening) await pregenerateAskClip(env, { id: messageId, answer: cp!.answer, answer_lang: 'zh' }, clip);
        })().catch((err) => console.error('[claude-turn] clip failed', messageId, err instanceof Error ? err.message : err));
        if (opts.waitUntil) opts.waitUntil(work);
        else await work;
      }
    }
    return 'done';
  } catch (err) {
    const retryable = retryableOf(err);
    console.error('[claude-turn] reply failed', messageId, `attempt ${attempt}`, err instanceof Error ? err.message : err);
    if (retryable && attempt < THREAD_TURN_MAX_ATTEMPTS) {
      await live.settle();
      await store.releaseTurn(env.DB, messageId);
      await live.released();
      return 'retry';
    }
    const reason = readableError(err, retryable);
    await live.settle();
    await store.failTurn(env.DB, messageId, threadId, reason);
    await live.failed(reason);
    return 'failed';
  }
}

function bumpSourceOf(mode: Mode): string | undefined {
  return mode === 'card' ? 'ask_claude' : mode === 'coach' ? 'coach_chat' : mode === 'chat_message' ? 'chat_discuss' : undefined;
}

function clipMaker(env: ThreadTurnEnv, opts: ThreadTurnDeps): AskClipMaker | null {
  if (opts.clip !== undefined) return opts.clip;
  if (env.E2E_TEST_MODE === 'true') return null;
  return (e, text, v) => cachedConversationTTS(e, text, { voiceId: v.voiceId, speed: v.speed, priority: 'interactive' });
}

function applierFor(env: ThreadTurnEnv, prepared: PreparedThreadTurn, userId: string, opts: ThreadTurnDeps): (action: ToolAction) => Promise<AppliedToolResult> {
  if (prepared.mode === 'card') {
    const noteId = (prepared.ctx as { note_id: string }).note_id;
    if (opts.applyCard) return (action) => opts.applyCard!(userId, noteId, action);
    return async (action) => {
      const note = await db.getNoteById(env.DB, noteId, userId);
      if (!note) return { tool: action.tool, success: false, error: 'Note not found' };
      return applyCardAction(env, userId, note, action);
    };
  }
  if (prepared.mode === 'coach') {
    const apply = opts.applyCoach ?? defaultApply(env);
    return (action) => apply(userId, action);
  }
  return async (action) => ({ tool: action.tool, success: false, error: 'Unsupported tool' });
}

/**
 * A card turn → `note_questions` too (the older apps' note history, card hub, tutor's "Asked
 * Claude", MCP read it), its id kept as both messages' `legacy_id` so the backfill never copies it
 * back. Never throws.
 */
async function dualWriteNoteQuestion(database: D1Database, row: store.TurnRow, prepared: PreparedThreadTurn, answer: string, replyId: string): Promise<void> {
  try {
    const noteId = (prepared.ctx as { note_id: string }).note_id;
    const q = await db.createNoteQuestion(database, noteId, prepared.question!.content, answer, prepared.language ?? null);
    await store.setMessageLegacyId(database, [prepared.question!.id, replyId], q.id);
  } catch (err) {
    console.error('[claude-turn] note_questions dual-write failed', row.id, err instanceof Error ? err.message : err);
  }
}

// ---------- Starting a reply ----------

type QueueEnv = Pick<Env, 'COACH_REPLY_QUEUE'>;

/** The watchdog (or a quick second go): a `claude_turn` delivery on coach-reply-queue after `delaySeconds`. */
export async function scheduleThreadTurn(env: QueueEnv, messageId: string, delaySeconds = WATCHDOG_DELAY_SECONDS): Promise<boolean> {
  if (!env.COACH_REPLY_QUEUE) return false;
  try {
    await env.COACH_REPLY_QUEUE.send({ kind: 'claude_turn', messageId } satisfies ClaudeTurnQueueMessage, { delaySeconds });
    return true;
  } catch (err) {
    console.error('[claude-turn] could not schedule', messageId, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Starts a pending reply: the watchdog first (so nothing is lost if this isolate dies), then the
 * reply itself in `waitUntil` (awaited without one — tests). A busy model in the inline run asks for
 * another go in a few seconds.
 */
export async function startThreadTurn(env: ThreadTurnEnv, messageId: string, opts: ThreadTurnDeps = {}): Promise<void> {
  await scheduleThreadTurn(env, messageId);
  const run = runThreadTurn(env, messageId, { ...opts, inline: true }).then(async (outcome) => {
    console.log('[claude-turn] inline', messageId, outcome);
    if (outcome === 'retry') await scheduleThreadTurn(env, messageId, RETRY_DELAY_SECONDS);
    return outcome;
  });
  if (opts.waitUntil) opts.waitUntil(run);
  else await run;
}
