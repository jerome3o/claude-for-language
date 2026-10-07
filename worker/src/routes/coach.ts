/**
 * Sentence Coach conversations (page /coach). Mounted under /api after the auth middleware.
 *
 *   POST   /coach/conversations { text, action?, explanation?, background?, chat_message_id? }
 *          → 202 { conversation, messages: [user, pending analysis] } with background: true (the
 *            coach-reply-queue writes it — services/coach-replies.ts); 201 when the analysis is
 *            ready at once (Explain's cached breakdown, or "Open in Coach" from a chat message
 *            whose auto-check is about this text); 200 { …, reused: true } = that chat message's
 *            conversation again; without background: the answer inline (older clients)
 *   GET    /coach/conversations                → [{ …, message_count, pending_reply, failed_reply }]
 *   GET    /coach/conversations/:id            → { conversation, messages } (status: null | pending | failed)
 *   DELETE /coach/conversations/:id
 *   POST   /coach/conversations/:id/messages { message, background? } → 202 { messages: [user, pending] }
 *          (409 while a reply is pending); without background: the agent loop inline
 *   POST   /coach/conversations/:id/messages/:messageId/retry → 202 { conversation, messages }
 *
 * docs/CHAT.md "Chat ↔ Coach".
 */
import { Hono } from 'hono';
import type { CoachAnalysis, CoachMessage, Env } from '../types';
import * as db from '../db/queries';
import { resolveCoachAction, conversationAction } from '@shared/coach';
import { autoCheckText, parseAutoCheck } from '@shared/chats/autoCheck';
import { parseStoredAttachment } from '../services/chat/media';
import { parseClientBriefExplanation, toCoachBreakdown } from '../services/sentence-explain-brief';
import { StructuredCallError } from '../services/structured-call';
import { trackServer } from '../services/analytics/server-events';
import {
  buildCoachHistory,
  coachAnalysisFromAutoCheck,
  coachAvailable,
  deckListFor,
  defaultAnalyse,
  defaultApply,
  defaultChat,
  enqueueCoachReply,
  readOnlyResults,
  retryCoachReply,
  sweepStaleCoachReplies,
} from '../services/coach-replies';

const coach = new Hono<{ Bindings: Env }>();

/** waitUntil when there is an execution context (tests have none). */
function waitUntilOf(c: { executionCtx: ExecutionContext }): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx;
    return (p) => ctx.waitUntil(p);
  } catch {
    return undefined;
  }
}

function bgCtx(c: { executionCtx: ExecutionContext }): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}


// Any Han character means the input is (at least partly) Chinese — treat it
// as a sentence to coach/explain. Pure English gets translated instead.
function containsChinese(text: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(text);
}

// Start a conversation from a sentence with the button the learner pressed
// (shared/coach): check → coachSentence (grade / correct what I wrote);
// explain → the brief Haiku breakdown (translation + word rows + construction,
// the same generator as "What's going on here?"); translate → translateSentence.
// No `action` (older clients) auto-detects: Chinese → check, English → translate.
// Explain may carry the breakdown the client already has cached, which is stored
// as is (validated) instead of asking Claude again.
coach.post('/coach/conversations', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ text: string; action?: unknown; explanation?: unknown; background?: unknown; chat_message_id?: unknown }>();
  const { text, action: requested, explanation: clientExplanation } = body;
  // New clients (web + Lab) ask for the reply in the background (docs/CHAT.md "Chat ↔ Coach");
  // older ones still get the answer inline.
  const inBackground = body.background === true;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return c.json({ error: 'text is required' }, 400);
  }
  const input = text.trim();
  const resolved = resolveCoachAction(input, requested);
  // No action = an old client relying on auto-detect (the Coach page always sends one now).
  if (requested === undefined || requested === null) void trackServer('server.coach_auto_detect');
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, 400);
  }
  const action = resolved.action;
  const isChinese = containsChinese(input);

  // "Open in Coach" from a chat message: the same conversation again, or one seeded with the
  // message's auto-check result (no second Claude call) when it is about this very text.
  const chatMessageId = typeof body.chat_message_id === 'string' && body.chat_message_id ? body.chat_message_id.slice(0, 100) : null;
  let seeded: CoachAnalysis | null = null;
  if (chatMessageId) {
    const existing = await db.getCoachConversationBySource(c.env.DB, userId, chatMessageId);
    if (existing && conversationAction(existing) === action && existing.title === input.slice(0, 120)) {
      await sweepStaleCoachReplies(c.env.DB, userId, existing.id);
      const messages = await db.getCoachMessages(c.env.DB, existing.id);
      return c.json({ conversation: existing, messages: messages.map(publicCoachMessage), reused: true }, 200);
    }
    if (action === 'check') {
      const row = await c.env.DB
        .prepare('SELECT sender_id, content, attachment, auto_check, deleted_at FROM messages WHERE id = ?')
        .bind(chatMessageId)
        .first<{ sender_id: string; content: string; attachment: string | null; auto_check: string | null; deleted_at: string | null }>();
      if (row && row.sender_id === userId && !row.deleted_at) {
        const checkedText = autoCheckText({ content: row.content, attachment: parseStoredAttachment(row.attachment) });
        const stored = parseAutoCheck(row.auto_check, checkedText);
        if (stored && checkedText.trim() === input) seeded = coachAnalysisFromAutoCheck(stored);
      }
    }
  }

  const cached = action === 'explain' ? parseClientBriefExplanation(clientExplanation) : null;
  const ready: CoachAnalysis | null = seeded ?? (cached ? { kind: 'explain', breakdown: toCoachBreakdown(input, cached) } : null);
  if (!ready && !coachAvailable(c.env)) {
    return c.json({ error: 'AI coaching is not configured' }, 500);
  }

  if (ready || inBackground) {
    const conversation = await db.createCoachConversation(c.env.DB, userId, input.slice(0, 120), isChinese ? 'zh' : 'en', action, chatMessageId);
    const userMsg = await db.addCoachMessage(c.env.DB, conversation.id, 'user', 'text', input);
    if (ready) {
      const assistantMsg = await db.addCoachMessage(c.env.DB, conversation.id, 'assistant', 'analysis', JSON.stringify(ready));
      return c.json({ conversation, messages: [userMsg, assistantMsg].map(publicCoachMessage) }, 201);
    }
    // The analysis is written by the coach-reply-queue consumer; the page polls until it is there.
    const pending = await db.addCoachMessage(c.env.DB, conversation.id, 'assistant', 'analysis', '', null, 'pending');
    await enqueueCoachReply(c.env, pending.id, waitUntilOf(c));
    return c.json({ conversation, messages: [userMsg, pending].map(publicCoachMessage) }, 202);
  }

  // Older clients: the answer inline (cancelled if they leave, as before).
  try {
    const analyse = defaultAnalyse(c.env)!;
    const analysis = await analyse(action, input);
    const conversation = await db.createCoachConversation(
      c.env.DB, userId, input.slice(0, 120), isChinese ? 'zh' : 'en', action, chatMessageId
    );
    const userMsg = await db.addCoachMessage(c.env.DB, conversation.id, 'user', 'text', input);
    const assistantMsg = await db.addCoachMessage(
      c.env.DB, conversation.id, 'assistant', 'analysis', JSON.stringify(analysis)
    );

    return c.json({ conversation, messages: [userMsg, assistantMsg].map(publicCoachMessage) });
  } catch (error) {
    console.error('Coach conversation start error:', error);
    // 503 = worth another try (the client retries once on its own); 502 = Claude refused / request rejected.
    const retryable = !(error instanceof StructuredCallError) || error.retryable;
    return c.json(
      { error: retryable ? 'Claude is busy right now — try again in a moment.' : 'Claude couldn’t answer this one — try rephrasing it.', retryable },
      retryable ? 503 : 502,
    );
  }
});

coach.get('/coach/conversations', async (c) => {
  const userId = c.get('user').id;
  await sweepStaleCoachReplies(c.env.DB, userId);
  const conversations = await db.getCoachConversations(c.env.DB, userId);
  return c.json(conversations.map((conv) => ({ ...conv, pending_reply: !!conv.pending_reply, failed_reply: !!conv.failed_reply })));
});

coach.get('/coach/conversations/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const conversation = await db.getCoachConversation(c.env.DB, id, userId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  await sweepStaleCoachReplies(c.env.DB, userId, id);
  const messages = await db.getCoachMessages(c.env.DB, id);
  return c.json({ conversation, messages: messages.map(publicCoachMessage) });
});

coach.delete('/coach/conversations/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const deleted = await db.deleteCoachConversation(c.env.DB, id, userId);
  if (!deleted) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  return c.json({ success: true });
});

// Follow-up message in a coach conversation (agent loop with tools). `background: true`
// (web + Lab) → 202 with the learner's message and a pending reply, written by the
// coach-reply-queue consumer; older clients get the answer inline.
coach.post('/coach/conversations/:id/messages', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { message, background: bgFlag } = await c.req.json<{ message: string; background?: unknown }>();

  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'message is required' }, 400);
  }
  if (!coachAvailable(c.env)) {
    return c.json({ error: 'AI coaching is not configured' }, 500);
  }

  const conversation = await db.getCoachConversation(c.env.DB, id, userId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (bgFlag === true) {
    await sweepStaleCoachReplies(c.env.DB, userId, id);
    const stored = await db.getCoachMessages(c.env.DB, id);
    if (stored.some((m) => m.status === 'pending')) {
      return c.json({ error: 'Claude is still answering your last message.' }, 409);
    }
    const userMsg = await db.addCoachMessage(c.env.DB, id, 'user', 'text', message.trim());
    const pending = await db.addCoachMessage(c.env.DB, id, 'assistant', 'text', '', null, 'pending');
    await enqueueCoachReply(c.env, pending.id, waitUntilOf(c));
    return c.json({ messages: [userMsg, pending].map(publicCoachMessage), toolResults: [] }, 202);
  }

  try {
    const stored = await db.getCoachMessages(c.env.DB, id);
    const history = buildCoachHistory(stored, await deckListFor(c.env.DB, userId));
    const last = history[history.length - 1];
    if (last && last.role === 'user') last.content = `${last.content}\n\n${message.trim()}`;
    else history.push({ role: 'user', content: message.trim() });

    const chat = defaultChat(c.env)!;
    const { answer, toolActions, readOnlyToolCalls } = await chat(history, { db: c.env.DB, userId });

    const toolResults = readOnlyResults(readOnlyToolCalls);
    const apply = defaultApply(c.env, bgCtx(c));
    for (const action of toolActions) toolResults.push(await apply(userId, action));

    const userMsg = await db.addCoachMessage(c.env.DB, id, 'user', 'text', message.trim());
    const assistantMsg = await db.addCoachMessage(
      c.env.DB, id, 'assistant', 'text', answer,
      toolResults.length > 0 ? JSON.stringify(toolResults) : null
    );

    return c.json({ messages: [userMsg, assistantMsg].map(publicCoachMessage), toolResults });
  } catch (error) {
    console.error('Coach conversation message error:', error);
    return c.json({ error: 'Failed to get a response' }, 500);
  }
});

// Retry a reply that failed (or was swept as stuck): back on the queue, finished tool actions kept.
coach.post('/coach/conversations/:id/messages/:messageId/retry', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const messageId = c.req.param('messageId');
  const conversation = await db.getCoachConversation(c.env.DB, id, userId);
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404);
  if (!coachAvailable(c.env)) return c.json({ error: 'AI coaching is not configured' }, 500);
  await sweepStaleCoachReplies(c.env.DB, userId, id);
  const owned = await c.env.DB.prepare('SELECT id FROM coach_messages WHERE id = ? AND conversation_id = ?').bind(messageId, id).first();
  if (!owned) return c.json({ error: 'Message not found' }, 404);
  if (!(await retryCoachReply(c.env.DB, messageId))) {
    return c.json({ error: 'That reply is not waiting for a retry' }, 409);
  }
  await enqueueCoachReply(c.env, messageId, waitUntilOf(c));
  const messages = await db.getCoachMessages(c.env.DB, id);
  return c.json({ conversation, messages: messages.map(publicCoachMessage) }, 202);
});

/** A coach message as the client sees it (no checkpoint / attempts bookkeeping). */
function publicCoachMessage(m: CoachMessage): CoachMessage {
  const { checkpoint: _cp, attempts: _a, started_at: _s, ...rest } = m as CoachMessage & { checkpoint?: unknown; attempts?: unknown; started_at?: unknown };
  return { ...rest, status: m.status ?? null, error: m.error ?? null };
}


export default coach;
