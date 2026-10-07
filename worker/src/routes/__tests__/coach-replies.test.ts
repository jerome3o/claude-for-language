/**
 * Sentence Coach replies in the background (docs/CHAT.md "Chat ↔ Coach") against
 * real SQLite with every migration: the POST returns at once with a pending
 * reply (the client may leave — nothing waits on it), the job writes the reply,
 * a redelivery resumes from the checkpoint (Claude is not asked again, a card is
 * not made twice), busy models are retried, the last failure is readable and
 * Retry re-queues it, a lost delivery is swept to failed, and "Open in Coach"
 * reuses the chat message's auto-check. The model is a mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import coachRoutes from '../coach';
import {
  runCoachReply,
  buildCoachHistory,
  COACH_REPLY_MAX_ATTEMPTS,
  type CoachChatFn,
  type CoachApplyFn,
} from '../../services/coach-replies';
import type { CoachMessage, Env } from '../../types';

const USER = 'user-1';
const SENTENCE = '我昨天去了商店买东西了';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES (?, 'u@x.test', 'Jerome', 'student')", [USER]);
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('other', 'o@x.test', 'Minghui', 'tutor')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('deck-1', ?, 'HSK 2')", [USER]);
}

function makeWorld(db: SqliteD1) {
  const sent: Array<{ messageId: string }> = [];
  // The queue only records: the test plays the consumer (runCoachReply) itself.
  const env = { DB: db, ANTHROPIC_API_KEY: 'test-key', COACH_REPLY_QUEUE: { send: async (m: { messageId: string }) => { sent.push(m); } } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => { c.set('user', { id: USER } as never); await next(); });
  app.route('/api', coachRoutes);
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { env, sent, call };
}

const json = async <T,>(res: Response) => (await res.json()) as T;
type ConvBody = { conversation: { id: string }; messages: CoachMessage[]; reused?: boolean };

const ANALYSIS = { kind: 'chinese', coach: { originalInput: SENTENCE, inputLanguage: 'chinese', isCorrect: false, corrected: { hanzi: '我昨天去商店买东西了', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', english: 'I went shopping yesterday.' }, critique: 'One 了 is enough.', issues: [], alternatives: [], vocabSuggestions: [] } } as const;

describe('Sentence Coach replies in the background', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  async function startConversation() {
    const res = await w.call('POST', '/api/coach/conversations', { text: SENTENCE, action: 'check', background: true });
    expect(res.status).toBe(202);
    const body = await json<ConvBody>(res);
    // The analysis is written by the job.
    const analyse = vi.fn(async () => ANALYSIS as never);
    expect(await runCoachReply(w.env, w.sent.at(-1)!.messageId, { analyse })).toBe('done');
    return body.conversation.id;
  }

  it('start: 202 with a pending analysis at once; the job writes it even though nobody is waiting', async () => {
    const res = await w.call('POST', '/api/coach/conversations', { text: SENTENCE, action: 'check', background: true });
    expect(res.status).toBe(202);
    const body = await json<ConvBody>(res);
    expect(body.messages.map((m) => [m.role, m.content_type, m.status])).toEqual([['user', 'text', null], ['assistant', 'analysis', 'pending']]);
    expect((body.messages[1] as unknown as Record<string, unknown>).checkpoint).toBeUndefined();
    // The list shows it as thinking.
    const list = await json<Array<{ id: string; pending_reply: boolean }>>(await w.call('GET', '/api/coach/conversations'));
    expect(list[0]).toMatchObject({ id: body.conversation.id, pending_reply: true });

    // The client has gone (the response was the last it saw); the consumer runs later.
    const analyse = vi.fn(async () => ANALYSIS as never);
    expect(await runCoachReply(w.env, w.sent[0].messageId, { analyse })).toBe('done');
    expect(analyse).toHaveBeenCalledWith('check', SENTENCE);

    const again = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${body.conversation.id}`));
    expect(again.messages[1].status).toBeNull();
    expect(JSON.parse(again.messages[1].content)).toMatchObject({ kind: 'chinese', coach: { corrected: { hanzi: '我昨天去商店买东西了' } } });
    // A second delivery of the same message does nothing.
    expect(await runCoachReply(w.env, w.sent[0].messageId, { analyse })).toBe('skipped');
    expect(analyse).toHaveBeenCalledTimes(1);
  });

  it('follow-up: 202 with a pending reply; a second send while it is pending is refused', async () => {
    const id = await startConversation();
    const res = await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'Make a card for 商店', background: true });
    expect(res.status).toBe(202);
    const body = await json<{ messages: CoachMessage[] }>(res);
    expect(body.messages.map((m) => [m.role, m.status])).toEqual([['user', null], ['assistant', 'pending']]);
    expect((await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'and another', background: true })).status).toBe(409);

    const chat: CoachChatFn = vi.fn(async (history) => {
      expect(history.at(-1)).toEqual({ role: 'user', content: 'Make a card for 商店' });
      expect(history[0].content).toContain('HSK 2 (id: deck-1)');
      return { answer: 'Done — 商店 is in HSK 2.', toolActions: [], readOnlyToolCalls: [] };
    });
    expect(await runCoachReply(w.env, w.sent.at(-1)!.messageId, { chat })).toBe('done');
    const conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Done — 商店 is in HSK 2.', status: null });
  });

  it('resumes from the checkpoint: Claude is not asked again and a finished card is not made twice', async () => {
    const id = await startConversation();
    await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'Two cards please', background: true });
    const messageId = w.sent.at(-1)!.messageId;
    const chat: CoachChatFn = vi.fn(async () => ({
      answer: 'Made two cards.',
      toolActions: [
        { tool: 'create_flashcards' as const, input: { deck_id: 'deck-1', flashcards: [{ hanzi: '商店', pinyin: 'shāngdiàn', english: 'shop' }] } },
        { tool: 'create_flashcards' as const, input: { deck_id: 'deck-1', flashcards: [{ hanzi: '东西', pinyin: 'dōngxi', english: 'thing' }] } },
      ],
      readOnlyToolCalls: [{ tool: 'bump_cards', input: {}, result: { added: 1 } }],
    }));
    let crash = true;
    const apply: CoachApplyFn = vi.fn(async (_u, action) => {
      const hanzi = (action.input as { flashcards: Array<{ hanzi: string }> }).flashcards[0].hanzi;
      if (hanzi === '东西' && crash) throw Object.assign(new Error('isolate went away'), { status: 503 });
      return { tool: 'create_flashcards', success: true, data: { deck_name: 'HSK 2', notes: [{ hanzi }] } };
    });
    expect(await runCoachReply(w.env, messageId, { chat, apply })).toBe('retry');
    crash = false;
    expect(await runCoachReply(w.env, messageId, { chat, apply })).toBe('done');
    expect(chat).toHaveBeenCalledTimes(1);
    expect((apply as ReturnType<typeof vi.fn>).mock.calls.map(([, a]) => (a.input as { flashcards: Array<{ hanzi: string }> }).flashcards[0].hanzi)).toEqual(['商店', '东西', '东西']);
    const conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    const reply = conv.messages.at(-1)!;
    expect(reply.content).toBe('Made two cards.');
    expect(JSON.parse(reply.tool_results!).map((r: { tool: string }) => r.tool)).toEqual(['bump_cards', 'create_flashcards', 'create_flashcards']);
  });

  it('a busy model is retried; the last attempt fails with a readable reason; Retry re-queues and succeeds', async () => {
    const id = await startConversation();
    await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'Explain 了', background: true });
    const messageId = w.sent.at(-1)!.messageId;
    const busy: CoachChatFn = vi.fn(async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); });
    for (let i = 1; i < COACH_REPLY_MAX_ATTEMPTS; i++) expect(await runCoachReply(w.env, messageId, { chat: busy })).toBe('retry');
    expect(await runCoachReply(w.env, messageId, { chat: busy })).toBe('failed');
    let conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.at(-1)).toMatchObject({ status: 'failed', error: 'Claude is busy right now — try again in a moment.' });
    const list = await json<Array<{ failed_reply: boolean; pending_reply: boolean }>>(await w.call('GET', '/api/coach/conversations'));
    expect(list[0]).toMatchObject({ failed_reply: true, pending_reply: false });

    const sentBefore = w.sent.length;
    const retry = await w.call('POST', `/api/coach/conversations/${id}/messages/${messageId}/retry`);
    expect(retry.status).toBe(202);
    expect(w.sent.length).toBe(sentBefore + 1);
    expect((await w.call('POST', `/api/coach/conversations/${id}/messages/${messageId}/retry`)).status).toBe(409);
    const ok: CoachChatFn = vi.fn(async () => ({ answer: '了 marks completion.', toolActions: [], readOnlyToolCalls: [] }));
    expect(await runCoachReply(w.env, messageId, { chat: ok })).toBe('done');
    conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.at(-1)).toMatchObject({ status: null, error: null, content: '了 marks completion.' });
  });

  it('a refusal fails at once; a lost delivery is swept to failed after 10 minutes', async () => {
    const id = await startConversation();
    await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'hi', background: true });
    const refused: CoachChatFn = async () => { throw Object.assign(new Error('bad request'), { status: 400 }); };
    expect(await runCoachReply(w.env, w.sent.at(-1)!.messageId, { chat: refused })).toBe('failed');
    let conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.at(-1)!.error).toContain('rephrasing');

    // A failed reply in between: the next follow-up is answered with both user turns merged.
    await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'hello?', background: true });
    db.raw.run("UPDATE coach_messages SET started_at = datetime('now', '-11 minutes') WHERE status = 'pending'");
    conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.at(-1)).toMatchObject({ status: 'failed', error: 'This reply took too long — try again.' });
    const history = buildCoachHistory(conv.messages, 'none');
    expect(history.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect(history.at(-1)!.content).toBe('hi\n\nhello?');
  });

  it('Open in Coach: the chat message\'s auto-check becomes the analysis (no Claude call), and the same message reopens it', async () => {
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', 'other', ?, 'tutor', 'active')", [USER]);
    db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Chat')");
    const autoCheck = {
      text: SENTENCE, status: 'improvable', corrected: '我昨天去商店买东西了', corrected_pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', corrected_english: 'I went shopping yesterday.',
      mistakes: [{ quote: '去了', fix: '去', why: 'One 了 at the end is enough.', card: null }], alternative: null, severity: 'moderate', card: null, checked_at: '2026-10-07T10:00:00.000Z',
    };
    const attachment = JSON.stringify({ kind: 'image', bytes: 10, mime: 'image/png', width: 10, height: 10, key: 'chat-media/conv-1/m1.png' });
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, attachment, auto_check) VALUES ('m1', 'conv-1', ?, ?, ?, ?)", [USER, SENTENCE, attachment, JSON.stringify(autoCheck)]);

    const res = await w.call('POST', '/api/coach/conversations', { text: SENTENCE, action: 'check', background: true, chat_message_id: 'm1' });
    expect(res.status).toBe(201);
    expect(w.sent).toHaveLength(0);
    const body = await json<ConvBody>(res);
    const analysis = JSON.parse(body.messages[1].content);
    expect(analysis).toMatchObject({ kind: 'chinese', coach: { isCorrect: false, corrected: { hanzi: '我昨天去商店买东西了' }, issues: [{ original: '去了', suggestion: '去' }] } });
    expect(body.messages[1].status).toBeNull();

    const again = await w.call('POST', '/api/coach/conversations', { text: SENTENCE, action: 'check', background: true, chat_message_id: 'm1' });
    expect(again.status).toBe(200);
    expect((await json<ConvBody>(again))).toMatchObject({ reused: true, conversation: { id: body.conversation.id } });

    // Someone else's message is never read for its check: it is asked of Claude as usual.
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, auto_check) VALUES ('m2', 'conv-1', 'other', ?, ?)", [SENTENCE, JSON.stringify(autoCheck)]);
    expect((await w.call('POST', '/api/coach/conversations', { text: SENTENCE, action: 'check', background: true, chat_message_id: 'm2' })).status).toBe(202);
  });

  it('older clients without background: the answer inline, as before', async () => {
    const { defaultAnalyse } = await import('../../services/coach-replies');
    expect(defaultAnalyse({ ANTHROPIC_API_KEY: '', E2E_TEST_MODE: undefined } as never)).toBeNull();
    const res = await w.call('POST', '/api/coach/conversations', { text: 'x', action: 'check' });
    expect(res.status).toBe(400);
  });
});
