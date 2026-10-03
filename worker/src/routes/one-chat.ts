/**
 * One chat per pair (docs/CHAT.md "One chat per pair", migration 0099).
 *
 * A tutor and a student have exactly ONE conversation. Migration 0099 merged the
 * old extras into it and marked them `merged_into`; a unique index keeps it single.
 * Claude role-play / practice chats are not tutor–student chats and may be many.
 *
 *   mountMergedConversations(app)               every /api/conversations/:id… request with a
 *                                               merged-away id is served as the chat it became
 *   GET   /conversations/:id                    the conversation (+ merged_from = the id asked for)
 *   POST  /relationships/:relId/conversations   with a person: THE chat (200, or 201 when made now;
 *                                               `title` ignored) — with Claude: a new practice chat
 *   PATCH /conversations/:id { title }          Claude practice chats only; a person's chat → 410
 *
 * `POST /relationships/:relId/conversations/open` (routes/tutor-dashboard.ts) is the
 * plain get-or-create every client uses to open the chat with someone.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import type { CreateConversationRequest, Env } from '../types';
import { createOrOpenConversation, getConversationById, resolveConversationId } from '../services/conversations';

type App = Hono<{ Bindings: Env }>;

/** Request header the re-dispatched request carries: the merged-away id that was asked for. */
export const MERGED_FROM_HEADER = 'X-Merged-From';
/** Response header: the conversation that actually answered. */
export const CONVERSATION_ID_HEADER = 'X-Conversation-Id';

/**
 * Serve a merged-away conversation id as the chat it was merged into, for every
 * `/api/conversations/:id…` route. The request is re-dispatched inside the worker
 * with the new id — no redirect, so POST bodies and the Authorization header
 * survive on every client (old notifications, e-mail links, cached ids, outboxes).
 * Register after the auth middleware and before the conversation routes.
 */
export function mountMergedConversations(app: App): void {
  const follow: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
    const id = c.req.param('id');
    if (!id || c.req.header(MERGED_FROM_HEADER)) return next();
    const row = await c.env.DB
      .prepare('SELECT merged_into FROM conversations WHERE id = ?')
      .bind(id)
      .first<{ merged_into: string | null }>()
      .catch(() => null);
    if (!row?.merged_into) return next();
    const target = (await resolveConversationId(c.env.DB, row.merged_into)) ?? row.merged_into;
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(`/api/conversations/${id}`, `/api/conversations/${target}`);
    const headers = new Headers(c.req.raw.headers);
    headers.set(MERGED_FROM_HEADER, id);
    const method = c.req.method;
    const init: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') init.body = await c.req.raw.arrayBuffer();
    let ctx: ExecutionContext | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined;
    }
    const res = await app.fetch(new Request(url.toString(), init), c.env, ctx);
    const out = new Response(res.body, res);
    out.headers.set(CONVERSATION_ID_HEADER, target);
    return out;
  };
  app.use('/api/conversations/:id', follow);
  app.use('/api/conversations/:id/*', follow);
}

const oneChat = new Hono<{ Bindings: Env }>();

oneChat.get('/conversations/:id', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const conv = await getConversationById(c.env.DB, convId, userId);
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);
  const asked = c.req.header(MERGED_FROM_HEADER) || convId;
  return c.json({
    ...conv,
    is_ai_conversation: !!conv.is_ai_conversation,
    merged_into: null,
    merged_from: asked !== conv.id ? asked : null,
  });
});

oneChat.post('/relationships/:relId/conversations', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const body = await c.req.json<CreateConversationRequest>().catch(() => ({} as CreateConversationRequest));
  try {
    const { conversation, created } = await createOrOpenConversation(c.env.DB, relId, userId, body);
    return c.json(conversation, created ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create conversation';
    return c.json({ error: message }, 400);
  }
});

oneChat.patch('/conversations/:id', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const { title } = await c.req.json<{ title?: string | null }>().catch(() => ({} as { title?: string | null }));
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return c.json({ error: 'title must be a string' }, 400);
  }
  if (title === undefined) return c.json({ error: 'No updates provided' }, 400);
  try {
    const conv = await getConversationById(c.env.DB, convId, userId);
    if (!conv) return c.json({ error: 'Conversation not found' }, 404);
    if (!conv.is_ai_conversation) {
      return c.json({ error: 'A chat with a person has no title: there is one chat per pair.' }, 410);
    }
    const trimmed = (title || '').trim().slice(0, 120);
    await c.env.DB.prepare('UPDATE conversations SET title = ? WHERE id = ?').bind(trimmed || null, conv.id).run();
    return c.json(await getConversationById(c.env.DB, conv.id, userId));
  } catch (error) {
    console.error('Rename conversation error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to rename conversation' }, 500);
  }
});

export default oneChat;
