/**
 * Claude threads — every conversation with Claude, one API (docs/CHAT.md "Claude threads"; the
 * unified-Claude-chats plan §7). Mounted under /api after the auth middleware; `/api/claude/*` POSTs
 * are in the cost guard's `ai` group. Storage + SQL: services/claude-agent/store.ts; a reply:
 * services/claude-agent/thread-turn.ts (inline start + lease + watchdog, streamed over ChatHub
 * `claude_turn` events); the older chats are copied in lazily (claude-agent/backfill.ts).
 *
 *   GET    /claude/threads?since=&limit=&context_kind=&note_id=&archived=
 *          → { threads: ClaudeThreadSummary[], deleted_ids, server_time } (the first call copies the older
 *            chats in; `since` = a previous server_time: threads changed since + the ids deleted since)
 *   POST   /claude/threads { client_id, context, intent?, text, message_client_id?, language?, title? }
 *          → 202 { thread, messages: [mine, pending reply] } (200 { …, existing: true } for a known client_id)
 *   GET    /claude/threads/:id?since= → { thread, messages, server_time } (a reply being written comes
 *          with its text so far, `streaming: true`; the thread's unread count is cleared)
 *   POST   /claude/threads/:id/messages { client_id?, text, intent?, language? } → 202 { thread, messages }
 *          (200 for a known client_id; 409 while a reply is being written or for a read-only thread)
 *   POST   /claude/threads/:id/messages/:messageId/retry → 202 { thread, messages }
 *   PATCH  /claude/threads/:id { title?, archived?, read?, tutor_visible?, language? } → { thread }
 *   DELETE /claude/threads/:id → { deleted: true } (a tombstone the next `?since=` list reports)
 *   POST   /admin/claude-threads/backfill { user_id? } (admin) → { counts } — the copy again, idempotent
 *
 * Intents: `ask` (every context) is answered by the Claude agent harness, streamed; a general chat may
 * START with ✏️ check / 🔍 explain / translate — the Coach's structured first replies (coach-replies.ts,
 * not streamed); its later messages are the Coach's follow-ups.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import * as db from '../db/queries';
import {
  CLAUDE_CONTEXT_KINDS,
  CLAUDE_TITLE_MAX,
  intentsFor,
  parseClaudeContext,
  parseIntent,
  previewOf,
  titleFor,
  type ClaudeContextKind,
  type ClaudeContextSnapshot,
  type ClaudeIntent,
  type ClaudeThreadContext,
} from '@shared/claude/context';
import { resolveCoachAction } from '@shared/coach';
import { COACH_ASK_MAX_CHARS } from '@shared/coach/askChat';
import { parseAskLanguage, turnLanguage, type AskLanguage } from '@shared/study/askClaude';
import { askSettings } from '../services/ask-claude';
import { coachAvailable, enqueueCoachReply, retryCoachReply, sweepStaleCoachReplies } from '../services/coach-replies';
import { loadDiscussedMessage } from '../services/claude-agent/contexts/chat_message';
import { ClaudeContextError } from '../services/claude-agent/types';
import { backfillClaudeThreads, ensureClaudeThreadsBackfilled } from '../services/claude-agent/backfill';
import { adminMiddleware } from '../middleware/auth';
import { startThreadTurn } from '../services/claude-agent/thread-turn';
import * as store from '../services/claude-agent/store';

const threads = new Hono<{ Bindings: Env }>();

const CLIENT_ID_MAX = 100;

function userIdOf(c: Context<{ Bindings: Env }>): string {
  return (c.get('user' as never) as { id: string }).id;
}

function waitUntilOf(c: Context<{ Bindings: Env }>): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx;
    return (p) => ctx.waitUntil(p);
  } catch {
    return undefined;
  }
}

function clientIdOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.length <= CLIENT_ID_MAX ? v.trim() : null;
}

const hasHan = (t: string) => /\p{Script=Han}/u.test(t);

/** The language of an ask turn: the request's choice, the thread's, the account's; "in English please" wins. */
async function askTurnLanguage(database: D1Database, userId: string, requested: unknown, thread: string | null | undefined, text: string): Promise<AskLanguage> {
  const setting = parseAskLanguage(requested) ?? parseAskLanguage(thread) ?? (await askSettings(database, userId)).language;
  return turnLanguage(setting, text);
}

/** The context checked against the caller (404 / 403) + its snapshot for the badge. */
async function checkedContext(c: Context<{ Bindings: Env }>, userId: string, ctx: ClaudeThreadContext): Promise<ClaudeContextSnapshot> {
  if (ctx.kind === 'card') {
    const note = await db.getNoteById(c.env.DB, ctx.note_id, userId);
    if (!note) throw new ClaudeContextError('Note not found', 404);
    const deck = await db.getDeckById(c.env.DB, note.deck_id, userId);
    return { label: note.hanzi.slice(0, 80), ...(deck?.name ? { sublabel: deck.name.slice(0, 80) } : {}) };
  }
  if (ctx.kind === 'chat_message') {
    const m = await loadDiscussedMessage(c.env, ctx.message_id, userId);
    const label = previewOf(m.content || '').slice(0, 40);
    return label ? { label } : {};
  }
  if (ctx.kind === 'practice') throw new ClaudeContextError('Practice chats can’t be started here yet', 400);
  return {};
}

function badRequest(c: Context<{ Bindings: Env }>, error: string) {
  return c.json({ error }, 400);
}

threads.get('/claude/threads', async (c) => {
  const userId = userIdOf(c);
  try {
    await ensureClaudeThreadsBackfilled(c.env.DB, userId);
  } catch (err) {
    // The list never fails on the copy; it runs again next time (nothing was stamped).
    console.error('[claude-threads] backfill failed', userId, err instanceof Error ? err.message : err);
  }
  await sweepStaleCoachReplies(c.env.DB, userId);
  const q = c.req.query();
  const contextKind = q.context_kind && (CLAUDE_CONTEXT_KINDS as readonly string[]).includes(q.context_kind) ? (q.context_kind as ClaudeContextKind) : null;
  if (q.context_kind && !contextKind) return badRequest(c, `context_kind must be one of ${CLAUDE_CONTEXT_KINDS.join(', ')}`);
  const since = q.since && !Number.isNaN(Date.parse(q.since)) ? new Date(q.since).toISOString() : null;
  if (q.since && !since) return badRequest(c, 'since must be an ISO time');
  const archived = q.archived === '1' || q.archived === 'true' ? true : q.archived === 'all' ? null : false;
  const limit = q.limit ? Number(q.limit) : undefined;
  const out = await store.listThreads(c.env.DB, userId, {
    since,
    limit: Number.isFinite(limit) ? limit : undefined,
    contextKind,
    noteId: q.note_id || null,
    archived: since ? null : archived,
  });
  return c.json(out);
});

threads.post('/claude/threads', async (c) => {
  const userId = userIdOf(c);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const context = parseClaudeContext(body.context ?? { kind: 'general' });
  if (!context) return badRequest(c, 'context must be { kind: general } | { kind: card, note_id } | { kind: chat_message, message_id }');
  const intent: ClaudeIntent | null = body.intent === undefined || body.intent === null ? 'ask' : parseIntent(body.intent);
  if (!intent) return badRequest(c, 'intent must be ask, check, explain or translate');
  if (!intentsFor(context.kind).includes(intent)) return badRequest(c, `A ${context.kind} chat takes ${intentsFor(context.kind).join(', ') || 'no messages'} here`);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return badRequest(c, 'text is required');
  if (text.length > COACH_ASK_MAX_CHARS) return badRequest(c, `Keep a message under ${COACH_ASK_MAX_CHARS} characters`);
  if (intent !== 'ask') {
    const resolved = resolveCoachAction(text, intent);
    if (!resolved.ok) return badRequest(c, resolved.error);
  }
  const clientId = clientIdOf(body.client_id);
  const messageClientId = clientIdOf(body.message_client_id);

  if (clientId) {
    const existing = await store.getThreadByClientId(c.env.DB, userId, clientId);
    if (existing) {
      const messages = await store.getThreadMessages(c.env.DB, existing.id);
      return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, existing.id), messages: messages.map(store.toThreadMessage), existing: true }, 200);
    }
  }
  if (!coachAvailable(c.env)) return c.json({ error: 'AI is not configured', retryable: false }, 503);

  let snapshot: ClaudeContextSnapshot;
  try {
    snapshot = await checkedContext(c, userId, context);
  } catch (err) {
    if (err instanceof ClaudeContextError) return c.json({ error: err.message }, err.status);
    throw err;
  }
  const language = intent === 'ask' && context.kind !== 'chat_message' ? await askTurnLanguage(c.env.DB, userId, body.language, null, text) : null;
  const threadLanguage = parseAskLanguage(body.language);
  const requestedTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, CLAUDE_TITLE_MAX) : null;
  const general = context.kind === 'general';
  const { thread, created } = await store.createThread(c.env.DB, {
    userId,
    clientId,
    context,
    snapshot,
    title: requestedTitle ?? titleFor({ ...context, ...snapshot }, text),
    // Older apps list general chats on the Coach page by action / kind.
    action: general ? intent : null,
    kind: general && intent === 'ask' ? 'ask' : null,
    inputLanguage: hasHan(text) ? 'zh' : 'en',
    language: threadLanguage,
    source: 'app',
  });
  if (!created) {
    const messages = await store.getThreadMessages(c.env.DB, thread.id);
    return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, thread.id), messages: messages.map(store.toThreadMessage), existing: true }, 200);
  }
  const turn = await store.appendTurn(
    c.env.DB,
    { threadId: thread.id, clientId: messageClientId, role: 'user', content: text, intent },
    { contentType: intent === 'ask' ? 'text' : 'analysis', answerLang: language },
  );
  if (turn.reply) await startReply(c, turn.reply);
  const messages = [turn.user, turn.reply].filter((m): m is store.MessageRow => !!m).map(store.toThreadMessage);
  return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, thread.id), messages }, 202);
});

/** The reply starts: a structured Coach reply on its queue, an ask turn inline (+ the watchdog). */
async function startReply(c: Context<{ Bindings: Env }>, reply: store.MessageRow): Promise<void> {
  if (reply.content_type === 'text') await startThreadTurn(c.env, reply.id, { waitUntil: waitUntilOf(c) });
  else await enqueueCoachReply(c.env, reply.id, waitUntilOf(c));
}

threads.get('/claude/threads/:id', async (c) => {
  const userId = userIdOf(c);
  const id = c.req.param('id');
  const thread = await store.getThreadRow(c.env.DB, userId, id);
  if (!thread) return c.json({ error: 'Chat not found' }, 404);
  const sinceRaw = c.req.query('since');
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  if (sinceRaw && !since) return badRequest(c, 'since must be an ISO time');
  await sweepStaleCoachReplies(c.env.DB, userId, id);
  const serverTime = await store.serverNowIso(c.env.DB);
  const messages = await store.getThreadMessages(c.env.DB, id, since);
  if (thread.unread > 0) await store.markThreadRead(c.env.DB, userId, id);
  return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, id), messages: messages.map(store.toThreadMessage), server_time: serverTime });
});

threads.post('/claude/threads/:id/messages', async (c) => {
  const userId = userIdOf(c);
  const id = c.req.param('id');
  const thread = await store.getThreadRow(c.env.DB, userId, id);
  if (!thread) return c.json({ error: 'Chat not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return badRequest(c, 'text is required');
  if (text.length > COACH_ASK_MAX_CHARS) return badRequest(c, `Keep a message under ${COACH_ASK_MAX_CHARS} characters`);
  const intent = body.intent === undefined || body.intent === null ? 'ask' : parseIntent(body.intent);
  // ✏️ Check / 🔍 Explain / Translate start a chat; inside one, every message is a question.
  if (intent !== 'ask') return badRequest(c, 'Check, Explain and Translate start a new chat — send this as a question');
  const clientId = clientIdOf(body.client_id);

  if (clientId) {
    const existing = await c.env.DB.prepare('SELECT id FROM coach_messages WHERE conversation_id = ? AND client_id = ?').bind(id, clientId).first<{ id: string }>();
    if (existing) {
      const turn = await store.appendTurn(c.env.DB, { threadId: id, clientId, role: 'user', content: text, intent: 'ask' }, { contentType: 'text' });
      const messages = [turn.user, turn.reply].filter((m): m is store.MessageRow => !!m).map(store.toThreadMessage);
      return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, id), messages, existing: true }, 200);
    }
  }
  if (thread.read_only) return c.json({ error: 'This chat can’t continue here yet' }, 409);
  if (!coachAvailable(c.env)) return c.json({ error: 'AI is not configured', retryable: false }, 503);
  await sweepStaleCoachReplies(c.env.DB, userId, id);
  const busy = await c.env.DB
    .prepare("SELECT 1 FROM coach_messages WHERE conversation_id = ? AND status = 'pending' AND content_type != 'mistake_lesson' LIMIT 1")
    .bind(id)
    .first();
  if (busy) return c.json({ error: 'Claude is still answering your last message.' }, 409);

  const kind = thread.context_kind ?? 'general';
  const coachFollowUp = kind === 'general' && !!(await c.env.DB.prepare("SELECT 1 FROM coach_messages WHERE conversation_id = ? AND content_type = 'analysis' LIMIT 1").bind(id).first());
  const language = kind === 'chat_message' || coachFollowUp ? null : await askTurnLanguage(c.env.DB, userId, body.language, thread.language, text);
  const turn = await store.appendTurn(c.env.DB, { threadId: id, clientId, role: 'user', content: text, intent: 'ask' }, { contentType: 'text', answerLang: language });
  if (turn.reply && turn.created) await startReply(c, turn.reply);
  const messages = [turn.user, turn.reply].filter((m): m is store.MessageRow => !!m).map(store.toThreadMessage);
  return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, id), messages }, turn.created ? 202 : 200);
});

threads.post('/claude/threads/:id/messages/:messageId/retry', async (c) => {
  const userId = userIdOf(c);
  const id = c.req.param('id');
  const messageId = c.req.param('messageId');
  const thread = await store.getThreadRow(c.env.DB, userId, id);
  if (!thread) return c.json({ error: 'Chat not found' }, 404);
  if (thread.read_only) return c.json({ error: 'This chat can’t continue here yet' }, 409);
  if (!coachAvailable(c.env)) return c.json({ error: 'AI is not configured', retryable: false }, 503);
  await sweepStaleCoachReplies(c.env.DB, userId, id);
  const row = await c.env.DB.prepare('SELECT * FROM coach_messages WHERE id = ? AND conversation_id = ?').bind(messageId, id).first<store.MessageRow>();
  if (!row) return c.json({ error: 'Message not found' }, 404);
  const reopened = row.content_type === 'text' ? await store.reopenTurn(c.env.DB, messageId) : await retryCoachReply(c.env.DB, messageId);
  if (!reopened) return c.json({ error: 'That reply is not waiting for a retry' }, 409);
  await startReply(c, row);
  const messages = await store.getThreadMessages(c.env.DB, id);
  return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, id), messages: messages.map(store.toThreadMessage) }, 202);
});

threads.patch('/claude/threads/:id', async (c) => {
  const userId = userIdOf(c);
  const id = c.req.param('id');
  const thread = await store.getThreadRow(c.env.DB, userId, id);
  if (!thread) return c.json({ error: 'Chat not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const patch: store.ThreadPatch = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return badRequest(c, 'title must be a non-empty string');
    patch.title = body.title.trim().slice(0, CLAUDE_TITLE_MAX);
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return badRequest(c, 'archived must be true or false');
    patch.archived = body.archived;
  }
  if (body.read !== undefined) {
    if (body.read !== true) return badRequest(c, 'read must be true');
    patch.read = true;
  }
  if (body.tutor_visible !== undefined) {
    if (body.tutor_visible !== null && typeof body.tutor_visible !== 'boolean') return badRequest(c, 'tutor_visible must be true, false or null');
    patch.tutor_visible = body.tutor_visible as boolean | null;
  }
  if (body.language !== undefined) {
    const language = body.language === null ? null : parseAskLanguage(body.language);
    if (body.language !== null && !language) return badRequest(c, "language must be 'zh', 'en' or null");
    patch.language = language;
  }
  await store.patchThread(c.env.DB, userId, id, patch);
  return c.json({ thread: await store.getThreadSummary(c.env.DB, userId, id) });
});

threads.delete('/claude/threads/:id', async (c) => {
  const userId = userIdOf(c);
  const deleted = await store.deleteThread(c.env.DB, userId, c.req.param('id'));
  if (!deleted) return c.json({ error: 'Chat not found' }, 404);
  return c.json({ deleted: true });
});

// Admin: run the copy again (idempotent) for one account — `user_id` (default: the caller).
threads.post('/admin/claude-threads/backfill', adminMiddleware, async (c) => {
  const user = c.get('user' as never) as { id: string };
  const body = await c.req.json<{ user_id?: unknown }>().catch(() => ({} as { user_id?: unknown }));
  const target = typeof body.user_id === 'string' && body.user_id ? body.user_id : user.id;
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target).first();
  if (!exists) return c.json({ error: 'User not found' }, 404);
  return c.json({ user_id: target, counts: await backfillClaudeThreads(c.env.DB, target) });
});

export default threads;
