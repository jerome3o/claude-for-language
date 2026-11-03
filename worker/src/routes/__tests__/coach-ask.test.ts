/**
 * "💬 Ask Claude" chats on the Sentence Coach (docs/CHAT.md "Ask Claude chat") against real SQLite
 * with every migration: POST /coach/ask returns at once with a pending reply in the turn's language,
 * the coach-reply-queue job writes a plain-text Chinese answer (or English on request), follow-ups
 * are answered in the background with the whole conversation, Translate is kept on the row, and
 * "Make flashcards from this chat" puts the tapped words first. The model is a mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import coachRoutes from '../coach';
import { runCoachReply } from '../../services/coach-replies';
import { buildClaudeChatSystemBlocks, buildClaudeChatSystemPrompt, coachAskTurns, defaultCoachAskReply, proposeCoachAskFlashcards, type CoachAskReplyFn } from '../../services/claude-chat';
import type { CoachMessage, Env } from '../../types';

const USER = 'user-1';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES (?, 'u@x.test', 'Jerome', 'student')", [USER]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('deck-1', ?, 'HSK 2')", [USER]);
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'deck-1', '火锅', 'huǒguō', 'hot pot')");
}

function makeWorld(db: SqliteD1, extra: Partial<Env> = {}) {
  const sent: Array<{ messageId: string }> = [];
  const env = { DB: db, ANTHROPIC_API_KEY: 'test-key', COACH_REPLY_QUEUE: { send: async (m: { messageId: string }) => { sent.push(m); } }, ...extra } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => { c.set('user', { id: USER } as never); await next(); });
  app.route('/api', coachRoutes);
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { env, sent, call };
}

const json = async <T,>(res: Response) => (await res.json()) as T;
type ConvBody = { conversation: { id: string; kind: string | null; action: string | null; title: string }; messages: CoachMessage[] };

describe('💬 Ask Claude chats', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  it('start: 202 with a pending reply in Chinese; the job writes plain text; the list says it is an ask chat', async () => {
    const res = await w.call('POST', '/api/coach/ask', { message: '成都有什么好吃的？' });
    expect(res.status).toBe(202);
    const body = await json<ConvBody>(res);
    expect(body.conversation).toMatchObject({ kind: 'ask', action: 'ask', title: '成都有什么好吃的？' });
    expect(body.messages.map((m) => [m.role, m.status, m.answer_lang ?? null])).toEqual([['user', null, null], ['assistant', 'pending', 'zh']]);

    const ask: CoachAskReplyFn = vi.fn(async (turns, ctx) => {
      expect(turns).toEqual([{ role: 'user', content: '成都有什么好吃的？' }]);
      expect(ctx).toMatchObject({ kind: 'ask', language: 'zh', userId: USER });
      return '**成都**的火锅很有名。\n# 很辣';
    });
    expect(await runCoachReply(w.env, w.sent[0].messageId, { ask, askClip: null })).toBe('done');
    const conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${body.conversation.id}`));
    // Markdown taken out of a Chinese answer (it is cut into word chips).
    expect(conv.messages[1]).toMatchObject({ content: '成都的火锅很有名。\n很辣', status: null, answer_lang: 'zh' });
    const list = await json<Array<{ id: string; kind: string }>>(await w.call('GET', '/api/coach/conversations'));
    expect(list[0]).toMatchObject({ id: body.conversation.id, kind: 'ask' });
  });

  it('English: the EN choice, or "in English please" for one turn; the follow-up carries the whole chat', async () => {
    const res = await json<ConvBody>(await w.call('POST', '/api/coach/ask', { message: '火锅是什么？', language: 'zh' }));
    const ask: CoachAskReplyFn = vi.fn(async (turns, ctx) => (ctx.language === 'en' ? 'Hot pot is a **pot** of broth.' : '火锅是一种菜。'));
    await runCoachReply(w.env, w.sent[0].messageId, { ask, askClip: null });

    // A follow-up without background is still answered in the background; English asked for once.
    const f = await w.call('POST', `/api/coach/conversations/${res.conversation.id}/messages`, { message: 'Explain that in English please', language: 'zh' });
    expect(f.status).toBe(202);
    const fb = await json<{ messages: CoachMessage[] }>(f);
    expect(fb.messages[1]).toMatchObject({ status: 'pending', answer_lang: 'en' });
    expect(await runCoachReply(w.env, w.sent[1].messageId, { ask, askClip: null })).toBe('done');
    expect(vi.mocked(ask).mock.calls[1][0]).toEqual([
      { role: 'user', content: '火锅是什么？' },
      { role: 'assistant', content: '火锅是一种菜。' },
      { role: 'user', content: 'Explain that in English please' },
    ]);
    const conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${res.conversation.id}`));
    expect(conv.messages.at(-1)).toMatchObject({ content: 'Hot pot is a **pot** of broth.', answer_lang: 'en' });

    // The account's language when none is sent.
    db.raw.run("UPDATE users SET ask_claude_language = 'en' WHERE id = ?", [USER]);
    const en = await json<ConvBody>(await w.call('POST', '/api/coach/ask', { message: '火锅' }));
    expect(en.messages[1].answer_lang).toBe('en');
  });

  it('refuses an empty or too long question', async () => {
    expect((await w.call('POST', '/api/coach/ask', { message: '  ' })).status).toBe(400);
    expect((await w.call('POST', '/api/coach/ask', { message: '好'.repeat(2001) })).status).toBe(400);
  });

  it('Translate: made once (E2E stand-in), kept on the row', async () => {
    w = makeWorld(db, { E2E_TEST_MODE: 'true' } as Partial<Env>);
    const res = await json<ConvBody>(await w.call('POST', '/api/coach/ask', { message: '成都有什么好吃的？' }));
    await runCoachReply(w.env, w.sent[0].messageId, { ask: async () => '成都的火锅很有名。', askClip: null });
    const replyId = (await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${res.conversation.id}`))).messages[1].id;
    const t = await json<{ translation: string; cached: boolean }>(await w.call('POST', `/api/coach/conversations/${res.conversation.id}/messages/${replyId}/translate`));
    expect(t.cached).toBe(false);
    const again = await json<{ translation: string; cached: boolean }>(await w.call('POST', `/api/coach/conversations/${res.conversation.id}/messages/${replyId}/translate`));
    expect(again).toEqual({ translation: t.translation, cached: true });
    expect((await w.call('POST', `/api/coach/conversations/${res.conversation.id}/messages/nope/translate`)).status).toBe(404);
  });

  it('Make flashcards: the focus words first, already_have marked (E2E stand-in)', async () => {
    w = makeWorld(db, { E2E_TEST_MODE: 'true' } as Partial<Env>);
    const res = await json<ConvBody>(await w.call('POST', '/api/coach/ask', { message: '成都有什么好吃的？' }));
    await runCoachReply(w.env, w.sent[0].messageId, { ask: async () => '成都的火锅很有名，串串也很好吃。', askClip: null });
    const out = await json<{ cards: Array<{ hanzi: string; already_have: boolean }> }>(
      await w.call('POST', `/api/coach/conversations/${res.conversation.id}/flashcards/propose`, { words: ['串串', '火锅'] }),
    );
    expect(out.cards.map((c) => [c.hanzi, c.already_have])).toEqual([['串串', false], ['火锅', true]]);
    expect((await w.call('POST', `/api/coach/conversations/${res.conversation.id}/flashcards/propose`, { words: 'x' })).status).toBe(400);
  });

  it('proposals are ordered by the focus words whatever the model returns', async () => {
    const stored = [
      { id: 'a', role: 'user', content_type: 'text', content: '问', status: null },
      { id: 'b', role: 'assistant', content_type: 'text', content: '成都的火锅很辣。', status: null },
    ] as unknown as CoachMessage[];
    const propose = vi.fn(async (_system: string, _user: string, _ids: string[]) => [
      { hanzi: '成都', pinyin: 'Chéngdū', english: 'Chengdu', fun_facts: '', source_message_id: 'b' },
      { hanzi: '辣', pinyin: 'là', english: 'spicy', fun_facts: '', source_message_id: 'b' },
    ]);
    const out = await proposeCoachAskFlashcards(w.env, USER, stored, ['辣'], { propose });
    expect(out.cards.map((c) => c.hanzi)).toEqual(['辣', '成都']);
    expect(vi.mocked(propose).mock.calls[0][1]).toContain('Words to focus on (tapped or said wrong), in order: 辣');
  });
});

describe('Claude chat prompt + turns', () => {
  it('Chinese: the general immersion rules and known words, no card line; English: Markdown', () => {
    const zh = buildClaudeChatSystemPrompt({ kind: 'ask', language: 'zh', knownWords: ['火锅'] });
    expect(zh).toContain('answer ENTIRELY in simple Chinese');
    expect(zh).toContain('火锅');
    expect(zh).not.toContain("About the card's word");
    const en = buildClaudeChatSystemPrompt({ kind: 'ask', language: 'en' });
    expect(en).toContain('friendly English');
    expect(en).not.toContain('ENTIRELY in simple Chinese');
  });

  it('a fast chat reply: SONNET_MODEL, thinking off, only the memory look-ups as tools, both system blocks and the tail cached', async () => {
    const { SONNET_MODEL } = await import('../../services/models');
    const create = vi.fn(async () => ({ model: SONNET_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: '**火锅**很好吃。' }], usage: { input_tokens: 10, output_tokens: 5 } }));
    const reply = defaultCoachAskReply({ DB: {} as D1Database, ANTHROPIC_API_KEY: 'k' }, { client: { messages: { create } } as never })!;
    const text = await reply([{ role: 'user', content: '成都有什么好吃的？' }], { kind: 'ask', language: 'zh', userId: USER, knownWords: ['火锅'] });
    expect(text).toBe('**火锅**很好吃。');
    const p = (create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(p.model).toBe(SONNET_MODEL);
    expect(p.thinking).toEqual({ type: 'disabled' });
    expect(p.output_config).toBeUndefined();
    // Claude memory's look-ups are the general chat's only tools (the last one carries the cache breakpoint).
    expect(p.tools.map((t: { name: string }) => t.name)).toEqual(['search_my_chats', 'read_chat']);
    expect(p.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(p.system).toHaveLength(2);
    expect(p.system.every((b: { cache_control?: unknown }) => !!b.cache_control)).toBe(true);
    expect(p.system[1].text).toContain('火锅');
    expect(p.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    // The static block is the same whoever asks (only the learner block differs).
    expect(buildClaudeChatSystemBlocks({ kind: 'ask', language: 'zh', knownWords: ['银行'] })[0]).toBe(p.system[0].text);
  });

  it('turns: finished text only, alternating, starting with the learner', () => {
    const m = (id: string, role: string, content: string, status: string | null = null) => ({ id, role, content, content_type: 'text', status }) as unknown as CoachMessage;
    expect(coachAskTurns([m('0', 'assistant', 'hi'), m('1', 'user', 'a'), m('2', 'assistant', '', 'failed'), m('3', 'user', 'b'), m('4', 'assistant', 'c')])).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
    ]);
  });
});
