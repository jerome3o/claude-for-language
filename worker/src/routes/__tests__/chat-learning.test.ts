/**
 * Learning tools in the chat (docs/CHAT.md PR 3) against real SQLite with every
 * migration: word chips made in the background (text, edit, voice transcript)
 * and lazily, stale words hidden, "make flashcards from this chat" (context,
 * corrections, already_have, repairs, errors), the tutor's corrections
 * (permissions, validation, live update, push to the student).
 *
 * Claude is faked below `structuredCall` (the real retry / validate logic
 * runs); the translation is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { fakeGoogle, makeServiceAccount } from '../../services/__tests__/fcm-fixture';
import { resetFcmTokenCache } from '../../services/push/fcm';
import chatLive from '../chat-live';
import chatMessages from '../chat-messages';
import chatLearning from '../chat-learning';
import { enrichMessageInBackground } from '../../services/chat/messages';
import { chatCorrectionFcmData, chatCorrectionWebPush, notifyChatCorrection } from '../../services/chat/notify';
import { buildChatContext, normalizeProposedCards, parseProposeRequest, MAX_CONTEXT_CHARS } from '../../services/chat/flashcards';
import { parseStoredWords, wordsTextOf } from '../../services/chat/words';
import type { Env, MessageWithSender } from '../../types';
import { CARD_STANDARD } from '@shared/cards/standard';

const ai = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('../../services/structured-call', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/structured-call')>();
  return {
    ...mod,
    structuredCall: (opts: Parameters<typeof mod.structuredCall>[0]) =>
      mod.structuredCall({ ...opts, client: { messages: { create: ai.create } } as never, sleep: async () => {} }),
  };
});

vi.mock('../../services/translation', () => ({
  translateAndSegment: vi.fn(async (_key: string, text: string) => ({ translation: `EN: ${text}`, segmentation: { chunks: [] } })),
}));

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

type CreateParams = { model: string; system: string; tool_choice: { name: string }; messages: Array<{ content: string }> };

function toolReply(input: unknown) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'x', input }], usage: { output_tokens: 10 } };
}

/** The fake splitter: every Han character its own word. */
function splitWords(text: string) {
  return [...text].filter((ch) => /[㐀-鿿]/.test(ch)).map((ch) => ({ text: ch, pinyin: `py(${ch})`, gloss: `g(${ch})` }));
}

let proposeReply: unknown = { cards: [] };
let proposeError: unknown = null;

function installClaude() {
  ai.create.mockReset();
  ai.create.mockImplementation(async (params: CreateParams) => {
    if (params.tool_choice.name === 'split_words') {
      const text = params.messages[0].content.replace(/^Text:\n/, '');
      return toolReply({ words: splitWords(text) });
    }
    if (params.tool_choice.name === 'propose_flashcards') {
      if (proposeError) throw proposeError;
      return toolReply(proposeReply);
    }
    throw new Error(`unexpected tool ${params.tool_choice.name}`);
  });
}

const callsTo = (tool: string) => ai.create.mock.calls.filter(([p]) => (p as CreateParams).tool_choice.name === tool).map(([p]) => p as CreateParams);

function seed(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['stranger', 'Nobody']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Homework')");
}

function insertMessage(db: SqliteD1, id: string, sender: string, at: string, content: string, extra: { attachment?: unknown; correction?: unknown; words?: string } = {}) {
  db.raw.run('INSERT INTO messages (id, conversation_id, sender_id, content, created_at, attachment, correction, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    id,
    'conv-1',
    sender,
    content,
    at,
    extra.attachment ? JSON.stringify(extra.attachment) : null,
    extra.correction ? JSON.stringify(extra.correction) : null,
    extra.words ?? null,
  ]);
}

function fakeHubs() {
  const events: Array<{ user: string; event: { type: string; message?: MessageWithSender } }> = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      broadcast: async (event: { type: string; message?: MessageWithSender }) => {
        events.push({ user: id, event });
        return 1;
      },
    }),
  };
  return { ns, events };
}

function makeWorld(db: SqliteD1, extraEnv: Partial<Env> = {}) {
  const hubs = fakeHubs();
  const store = new Map<string, Uint8Array>();
  const bucket = {
    put: async (key: string, value: Uint8Array) => { store.set(key, value); return {}; },
    get: async () => null,
    delete: async (key: string) => { store.delete(key); },
  };
  const env = { DB: db, SESSION_SECRET: 's', AUDIO_BUCKET: bucket, CHAT_HUB: hubs.ns, ANTHROPIC_API_KEY: 'test-key', ...extraEnv } as unknown as Env;
  const as = (userId: string) => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    app.route('/api', chatLive);
    app.route('/api', chatMessages);
    app.route('/api', chatLearning);
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const upload = (query: string, bytes: Uint8Array, contentType: string) =>
      app.request(`/api/conversations/conv-1/media?${query}`, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }, env);
    return { call, upload };
  };
  return { env, hubs, as };
}

const json = async <T = MessageWithSender>(res: Response) => (await res.json()) as T;

async function messagesOf(w: ReturnType<typeof makeWorld>, user = STUDENT) {
  return (await json<{ messages: MessageWithSender[] }>(await w.as(user).call('GET', '/api/conversations/conv-1/messages'))).messages;
}

describe('word chips on chat messages', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    installClaude();
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  it('a Chinese message gets its translation and words in ONE background step (one message_updated each)', async () => {
    const res = await w.as(STUDENT).call('POST', '/api/conversations/conv-1/messages', { content: '我们明天见！' });
    expect(res.status).toBe(201);
    const sent = await json(res);
    // The response is written before the background work.
    expect(sent).toMatchObject({ words: null, words_source: null, correction: null });

    const [msg] = await messagesOf(w);
    expect(msg.translation).toBe('EN: 我们明天见！');
    expect(msg.words_source).toBe('content');
    expect(msg.words!.map((x) => x.text).join('')).toBe('我们明天见！');
    expect(msg.words![0]).toEqual({ text: '我', pinyin: 'py(我)', gloss: 'g(我)' });
    expect(msg.updated_at! > msg.created_at).toBe(true);
    const updates = w.hubs.events.filter((e) => e.event.type === 'message_updated');
    expect(updates.map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect(updates[0].event.message!.words).toHaveLength(6); // 5 hanzi + the punctuation segment

    // English only: no Claude call, no words.
    ai.create.mockClear();
    await w.as(STUDENT).call('POST', '/api/conversations/conv-1/messages', { content: 'See you tomorrow' });
    expect(ai.create).not.toHaveBeenCalled();
    expect((await messagesOf(w))[1]).toMatchObject({ words: null, translation: null });
  });

  it('an edit clears the old words and makes new ones; words for an old text are never served', async () => {
    const sent = await json(await w.as(STUDENT).call('POST', '/api/conversations/conv-1/messages', { content: '你好' }));
    const edited = await json(await w.as(STUDENT).call('PATCH', `/api/messages/${sent.id}`, { content: '您好吗' }));
    // The PATCH response is shaped before the background step.
    expect(edited.words).toBeNull();
    const [msg] = await messagesOf(w);
    expect(msg.words!.map((x) => x.text)).toEqual(['您', '好', '吗']);

    // Text changed behind the words' back (e.g. the background step lost a race): hidden.
    db.raw.run("UPDATE messages SET content = '您好' WHERE id = ?", [sent.id]);
    expect((await messagesOf(w))[0].words).toBeNull();
    // A write for an old text never lands.
    await enrichMessageInBackground(w.env, sent.id, '旧的', { translate: null, segment: async () => splitWords('旧的') });
    expect(db.rows<{ words: string | null }>('SELECT words FROM messages WHERE id = ?', [sent.id])[0].words).toContain('您');
  });

  it('a failing splitter leaves the translation (and vice versa)', async () => {
    insertMessage(db, 'm-1', STUDENT, '2026-10-01T09:00:00.000Z', '谢谢');
    await enrichMessageInBackground(w.env, 'm-1', '谢谢', { segment: async () => { throw new Error('overloaded'); } });
    expect((await messagesOf(w))[0]).toMatchObject({ translation: 'EN: 谢谢', words: null });
    await enrichMessageInBackground(w.env, 'm-1', '谢谢', { translate: async () => { throw new Error('down'); } });
    expect((await messagesOf(w))[0].words!.map((x) => x.text)).toEqual(['谢', '谢']);
  });

  it('a voice message: words of the transcript once transcribed (source transcript)', async () => {
    w = makeWorld(db, { AI: { run: async () => ({ text: '明天见' }) } as never });
    const webm = new Uint8Array(64);
    webm.set([0x1a, 0x45, 0xdf, 0xa3]);
    const res = await w.as(STUDENT).upload('kind=voice&duration_ms=1200', webm, 'audio/webm');
    expect(res.status).toBe(201);
    const [msg] = await messagesOf(w);
    expect(msg.attachment).toMatchObject({ transcript_status: 'done', transcript: '明天见', translation: 'EN: 明天见' });
    expect(msg.words_source).toBe('transcript');
    expect(msg.words!.map((x) => x.text).join('')).toBe('明天见');
  });

  it('a photo with a Chinese caption gets words of the caption', async () => {
    const png = new Uint8Array(49);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 10);
    new DataView(png.buffer).setUint32(20, 10);
    const res = await w.as(STUDENT).upload(`kind=image&caption=${encodeURIComponent('我的猫')}`, png, 'image/png');
    expect(res.status).toBe(201);
    const [msg] = await messagesOf(w);
    expect(msg).toMatchObject({ words_source: 'content', translation: 'EN: 我的猫' });
    expect(msg.words!.map((x) => x.text)).toEqual(['我', '的', '猫']);
  });

  it('POST /messages/:id/words: lazily, cached, participants only', async () => {
    insertMessage(db, 'm-old', TUTOR, '2026-10-01T09:00:00.000Z', '你吃饭了吗？');
    insertMessage(db, 'm-en', TUTOR, '2026-10-01T09:01:00.000Z', 'ok');

    let res = await w.as(STUDENT).call('POST', '/api/messages/m-old/words');
    expect(res.status).toBe(200);
    const first = await json<{ words: Array<{ text: string }>; source: string; cached: boolean }>(res);
    expect(first.cached).toBe(false);
    expect(first.source).toBe('content');
    expect(first.words.map((x) => x.text).join('')).toBe('你吃饭了吗？');
    expect(w.hubs.events.filter((e) => e.event.type === 'message_updated').map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect((await messagesOf(w))[0].words).toHaveLength(6);

    ai.create.mockClear();
    res = await w.as(TUTOR).call('POST', '/api/messages/m-old/words');
    expect(await json(res)).toMatchObject({ cached: true, source: 'content' });
    expect(ai.create).not.toHaveBeenCalled();

    expect(await json(await w.as(STUDENT).call('POST', '/api/messages/m-en/words'))).toEqual({ words: null, source: null, cached: false });
    expect((await w.as('stranger').call('POST', '/api/messages/m-old/words')).status).toBe(403);
    expect((await w.as(STUDENT).call('POST', '/api/messages/nope/words')).status).toBe(404);

    insertMessage(db, 'm-new', TUTOR, '2026-10-01T09:02:00.000Z', '再见');
    const noKey = makeWorld(db, { ANTHROPIC_API_KEY: undefined });
    expect((await noKey.as(STUDENT).call('POST', '/api/messages/m-new/words')).status).toBe(503);
    // Cached words are served without a key.
    expect((await noKey.as(STUDENT).call('POST', '/api/messages/m-old/words')).status).toBe(200);

    await w.as(TUTOR).call('DELETE', '/api/messages/m-new');
    expect((await w.as(STUDENT).call('POST', '/api/messages/m-new/words')).status).toBe(409);
  });

  it('stored words: shape helpers', () => {
    const words = JSON.stringify({ source: 'content', words: splitWords('你好') });
    expect(parseStoredWords(words, { content: '你好' })!.words).toHaveLength(2);
    expect(parseStoredWords(words, { content: '你好吗' })).toBeNull();
    // A bare array = words of the content.
    expect(parseStoredWords(JSON.stringify(splitWords('好')), { content: '好' })!.source).toBe('content');
    const voice = { kind: 'voice', transcript: '你好' };
    expect(parseStoredWords(JSON.stringify({ source: 'transcript', words: splitWords('你好') }), { content: '', attachment: voice })!.source).toBe('transcript');
    expect(parseStoredWords(JSON.stringify({ source: 'transcript', words: splitWords('你好') }), { content: '你好' })).toBeNull();
    expect(wordsTextOf({ content: 'hello' })).toBeNull();
    expect(wordsTextOf({ content: '', attachment: { kind: 'voice', transcript: null } })).toBeNull();
  });
});

describe('flashcards from the chat', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    installClaude();
    proposeError = null;
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
    insertMessage(db, 'm-1', TUTOR, '2026-10-01T09:00:00.000Z', '你昨天做什么了？');
    insertMessage(db, 'm-2', STUDENT, '2026-10-01T09:01:00.000Z', '我去了商店昨天', {
      correction: { text: '我昨天去了商店。', note: 'Time comes before the verb', by: TUTOR, at: '2026-10-01T09:02:00.000Z' },
    });
    insertMessage(db, 'm-3', TUTOR, '2026-10-01T09:03:00.000Z', '', {
      attachment: { kind: 'voice', duration_ms: 900, bytes: 10, mime: 'audio/webm', transcript_status: 'done', transcript: '买了什么水果？', key: 'k' },
    });
    insertMessage(db, 'm-4', STUDENT, '2026-10-01T09:04:00.000Z', '苹果和香蕉');
    insertMessage(db, 'm-gone', STUDENT, '2026-10-01T09:05:00.000Z', '秘密');
    db.raw.run("UPDATE messages SET deleted_at = '2026-10-01T09:06:00.000Z' WHERE id = 'm-gone'");
    // The student already has 苹果 (with punctuation / spacing differences ignored).
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('deck-s', ?, 'Mine')", [STUDENT]);
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-1', 'deck-s', ' 苹果。', 'píngguǒ', 'apple')");
    proposeReply = {
      cards: [
        { hanzi: '香蕉', pinyin: 'xiāngjiāo', english: 'banana', fun_facts: '香 fragrant + 蕉 banana plant', sentence_clue: '我喜欢吃香蕉。', sentence_clue_pinyin: 'wǒ xǐhuan chī xiāngjiāo', sentence_clue_translation: 'I like bananas.', source: 4 },
        { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', fun_facts: '…', sentence_clue: '我买了（一个）苹果', source: 4 },
        { hanzi: '我昨天去了商店。', pinyin: 'wǒ zuótiān qù le shāngdiàn.', english: 'I went to the shop yesterday.', fun_facts: 'Time before the verb: 昨天 goes before 去.', source: 2 },
        { hanzi: '你好/您好', pinyin: 'nǐ hǎo', english: 'hello', fun_facts: 'x', source: 1 },
        { hanzi: '香蕉', pinyin: 'xiāngjiāo', english: 'banana again', fun_facts: 'dup', source: 4 },
        { hanzi: '水果', pinyin: 'shui3guo3', english: 'fruit', fun_facts: 'x', source: 3 },
      ],
    };
  });

  it('proposes cards: corrections first, rule-breakers repaired or dropped, already_have for the caller', async () => {
    const res = await w.as(STUDENT).call('POST', '/api/conversations/conv-1/flashcards/propose', {});
    expect(res.status).toBe(200);
    const { cards } = await json<{ cards: Array<Record<string, unknown>> }>(res);
    expect(cards.map((c) => c.hanzi)).toEqual(['我昨天去了商店。', '香蕉', '苹果']);
    expect(cards[0]).toMatchObject({ source_message_id: 'm-2', already_have: false });
    expect(cards[1]).toMatchObject({ source_message_id: 'm-4', already_have: false, sentence_clue: '我喜欢吃香蕉。', sentence_clue_pinyin: 'wǒ xǐhuan chī xiāngjiāo' });
    // A clue with brackets is dropped from its card; the card stays.
    expect(cards[2]).toMatchObject({ already_have: true });
    expect(cards[2].sentence_clue).toBeUndefined();

    const [call] = callsTo('propose_flashcards');
    expect(call.model).toBe('claude-sonnet-5');
    expect(call.system).toContain(CARD_STANDARD);
    expect(call.system).toMatch(/corrections/);
    const user = call.messages[0].content;
    expect(user).toContain('The learner is Jerome.');
    expect(user).toContain('#1 Minghui (tutor): 你昨天做什么了？');
    expect(user).toContain('#2 Jerome (student): 我去了商店昨天\n   ✏️ correction: 我去了商店昨天 → 我昨天去了商店。 (Time comes before the verb)');
    expect(user).toContain('#3 Minghui (tutor): 🎤 买了什么水果？');
    expect(user).not.toContain('秘密');

    // The tutor asking: already_have is about the TUTOR's notes.
    const tutorCards = (await json<{ cards: Array<Record<string, unknown>> }>(await w.as(TUTOR).call('POST', '/api/conversations/conv-1/flashcards/propose', {}))).cards;
    expect(tutorCards.find((c) => c.hanzi === '苹果')!.already_have).toBe(false);
  });

  it('message_ids / since narrow the context; focus correction uses the corrected messages only', async () => {
    await w.as(STUDENT).call('POST', '/api/conversations/conv-1/flashcards/propose', { message_ids: ['m-4', 'm-1'] });
    let user = callsTo('propose_flashcards').at(-1)!.messages[0].content;
    expect(user).toContain('#1 Minghui (tutor): 你昨天做什么了？');
    expect(user).toContain('#2 Jerome (student): 苹果和香蕉');
    expect(user).not.toContain('商店');

    await w.as(STUDENT).call('POST', '/api/conversations/conv-1/flashcards/propose', { since: '2026-10-01T09:02:30.000Z' });
    user = callsTo('propose_flashcards').at(-1)!.messages[0].content;
    expect(user).not.toContain('你昨天');
    expect(user).toContain('#1 Minghui (tutor): 🎤');

    proposeReply = { cards: [{ hanzi: '我昨天去了商店。', pinyin: 'wǒ zuótiān qù le shāngdiàn.', english: 'I went to the shop yesterday.', fun_facts: 'Was: 我去了商店昨天 — time goes before the verb.', source: 1 }] };
    const res = await w.as(STUDENT).call('POST', '/api/conversations/conv-1/flashcards/propose', { message_ids: ['m-2'], focus: 'correction' });
    expect(res.status).toBe(200);
    expect((await json<{ cards: unknown[] }>(res)).cards).toEqual([
      expect.objectContaining({ hanzi: '我昨天去了商店。', source_message_id: 'm-2', already_have: false }),
    ]);
    const call = callsTo('propose_flashcards').at(-1)!;
    expect(call.system).toContain('CORRECTED sentence');
    expect(call.messages[0].content).toContain('#1 Jerome (student): 我去了商店昨天\n   ✏️ correction:');
    expect(call.messages[0].content).not.toContain('苹果');

    // No correction among them → 400, no Claude call.
    const before = callsTo('propose_flashcards').length;
    expect((await w.as(STUDENT).call('POST', '/api/conversations/conv-1/flashcards/propose', { message_ids: ['m-4'], focus: 'correction' })).status).toBe(400);
    expect(callsTo('propose_flashcards').length).toBe(before);
  });

  it('errors: bad body 400, stranger 403, unknown 404, nothing to use 400, no key 503, busy 503, declined 502', async () => {
    const propose = (body: unknown, user = STUDENT, world = w, conv = 'conv-1') => world.as(user).call('POST', `/api/conversations/${conv}/flashcards/propose`, body);
    expect((await propose({ message_ids: 'm-1' })).status).toBe(400);
    expect((await propose({ focus: 'grammar' })).status).toBe(400);
    expect((await propose({ since: 'yesterday' })).status).toBe(400);
    expect((await propose({ message_ids: Array.from({ length: 81 }, (_, i) => `m${i}`) })).status).toBe(400);
    expect((await propose({}, 'stranger')).status).toBe(403);
    expect((await propose({}, STUDENT, w, 'nope')).status).toBe(404);
    expect((await propose({ message_ids: ['m-gone'] })).status).toBe(400);
    expect((await propose({}, STUDENT, makeWorld(db, { ANTHROPIC_API_KEY: undefined }))).status).toBe(503);

    proposeError = Object.assign(new Error('overloaded'), {});
    let res = await propose({});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: true });

    proposeError = null;
    ai.create.mockImplementation(async () => ({ stop_reason: 'refusal', content: [], usage: {} }));
    res = await propose({});
    expect(res.status).toBe(502);
  });

  it('context limits: the newest 50 by default, ≤ 80 with a selection, ≤ 12k characters', async () => {
    for (let i = 0; i < 100; i++) {
      insertMessage(db, `x-${String(i).padStart(3, '0')}`, i % 2 ? TUTOR : STUDENT, `2026-10-02T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`, `第${i}句话`);
    }
    const roles = { tutorId: TUTOR, studentId: STUDENT };
    let ctx = await buildChatContext(db, 'conv-1', roles, {});
    expect(ctx.ids).toHaveLength(50);
    expect(ctx.ids.at(-1)).toBe('x-099');
    expect(ctx.ids[0]).toBe('x-050');
    ctx = await buildChatContext(db, 'conv-1', roles, { since: '2026-10-02T00:00:00.000Z' });
    expect(ctx.ids).toHaveLength(80);

    for (let i = 0; i < 20; i++) insertMessage(db, `long-${i}`, TUTOR, `2026-10-03T10:00:${String(i).padStart(2, '0')}.000Z`, '长'.repeat(1400));
    ctx = await buildChatContext(db, 'conv-1', roles, { since: '2026-10-03T00:00:00.000Z' });
    expect(ctx.text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(ctx.ids.at(-1)).toBe('long-19');
    expect(ctx.ids.length).toBeLessThan(20);
  });

  it('parses requests and normalises cards', () => {
    expect(parseProposeRequest({ message_ids: ['a', 'a', 'b'], focus: 'correction' })).toEqual({ message_ids: ['a', 'b'], focus: 'correction' });
    expect(parseProposeRequest(null)).toEqual({});
    // Every card broke the rules → thrown (retried by structuredCall).
    expect(() => normalizeProposedCards({ cards: [{ hanzi: '我…了', pinyin: 'wǒ le', english: 'x', fun_facts: '' }] }, [])).toThrow();
    expect(normalizeProposedCards({ cards: [] }, [])).toEqual([]);
    // A clue without the word is dropped; a source out of range → null.
    expect(normalizeProposedCards({ cards: [{ hanzi: '猫', pinyin: 'māo', english: 'cat', fun_facts: 'f', sentence_clue: '我有狗。', source: 9 }] }, ['m-1'])).toEqual([
      { hanzi: '猫', pinyin: 'māo', english: 'cat', fun_facts: 'f', source_message_id: null },
    ]);
  });
});

describe('corrections', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    installClaude();
    resetFcmTokenCache();
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
    insertMessage(db, 'm-s', STUDENT, '2026-10-01T09:00:00.000Z', '我去了商店昨天');
    insertMessage(db, 'm-t', TUTOR, '2026-10-01T09:01:00.000Z', '很好');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the tutor corrects the student’s text message: stored, live update to both, PUT again is a no-op', async () => {
    const res = await w.as(TUTOR).call('PUT', '/api/messages/m-s/correction', { text: ' 我昨天去了商店。 ', note: ' Time before the verb ' });
    expect(res.status).toBe(200);
    const msg = await json(res);
    expect(msg.correction).toMatchObject({ text: '我昨天去了商店。', note: 'Time before the verb', by: TUTOR });
    expect(msg.correction!.at).toBe(msg.updated_at);
    expect(w.hubs.events.filter((e) => e.event.type === 'message_updated').map((e) => e.user).sort()).toEqual([STUDENT, TUTOR]);
    expect((await messagesOf(w, STUDENT))[0].correction!.text).toBe('我昨天去了商店。');

    w.hubs.events.length = 0;
    await w.as(TUTOR).call('PUT', '/api/messages/m-s/correction', { text: '我昨天去了商店。', note: 'Time before the verb' });
    expect(w.hubs.events).toHaveLength(0);
    // Without a note.
    const noNote = await json(await w.as(TUTOR).call('PUT', '/api/messages/m-s/correction', { text: '我昨天去商店了。' }));
    expect(noNote.correction).toMatchObject({ text: '我昨天去商店了。', note: null });

    const cleared = await json(await w.as(TUTOR).call('DELETE', '/api/messages/m-s/correction'));
    expect(cleared.correction).toBeNull();
    expect((await w.as(TUTOR).call('DELETE', '/api/messages/m-s/correction')).status).toBe(200);
  });

  it('only the tutor, only on the other person’s live text message; validated', async () => {
    const put = (user: string, id: string, body: unknown) => w.as(user).call('PUT', `/api/messages/${id}/correction`, body);
    expect((await put(STUDENT, 'm-t', { text: '非常好' })).status).toBe(403);
    expect((await put(STUDENT, 'm-s', { text: '我昨天去了商店' })).status).toBe(403);
    expect((await put(TUTOR, 'm-t', { text: '非常好' })).status).toBe(403);
    expect((await put('stranger', 'm-s', { text: 'x' })).status).toBe(403);
    expect((await put(TUTOR, 'nope', { text: 'x' })).status).toBe(404);
    expect((await w.as(STUDENT).call('DELETE', '/api/messages/m-s/correction')).status).toBe(403);

    expect((await put(TUTOR, 'm-s', {})).status).toBe(400);
    expect((await put(TUTOR, 'm-s', { text: '   ' })).status).toBe(400);
    expect((await put(TUTOR, 'm-s', { text: '好'.repeat(2001) })).status).toBe(400);
    expect((await put(TUTOR, 'm-s', { text: '好', note: 'n'.repeat(1001) })).status).toBe(400);
    expect((await put(TUTOR, 'm-s', { text: '好', note: 5 })).status).toBe(400);

    insertMessage(db, 'm-photo', STUDENT, '2026-10-01T09:02:00.000Z', '我的猫', { attachment: { kind: 'image', width: 1, height: 1, bytes: 1, mime: 'image/png', key: 'k' } });
    expect((await put(TUTOR, 'm-photo', { text: '我的猫。' })).status).toBe(400);

    await w.as(STUDENT).call('DELETE', '/api/messages/m-s');
    expect((await put(TUTOR, 'm-s', { text: '我昨天去了商店。' })).status).toBe(409);
  });

  it('a deleted message loses its correction', async () => {
    await w.as(TUTOR).call('PUT', '/api/messages/m-s/correction', { text: '我昨天去了商店。' });
    await w.as(STUDENT).call('DELETE', '/api/messages/m-s');
    expect(db.rows('SELECT correction, words FROM messages WHERE id = ?', ['m-s'])).toEqual([{ correction: null, words: null }]);
  });

  it('the student is pushed (FCM + Web Push), never e-mailed; the tutor is not', async () => {
    const sa = await makeServiceAccount();
    db.raw.run("INSERT INTO device_push_tokens (id, user_id, token) VALUES ('d-s', ?, 'student-phone'), ('d-t', ?, 'tutor-phone')", [STUDENT, TUTOR]);
    const google = fakeGoogle();
    vi.stubGlobal('fetch', google.fetcher);
    w = makeWorld(db, { FCM_SERVICE_ACCOUNT_JSON: sa.json, SENDGRID_API_KEY: 'sg' });
    expect((await w.as(TUTOR).call('PUT', '/api/messages/m-s/correction', { text: '我昨天去了商店。' })).status).toBe(200);
    const sends = google.sends();
    expect(sends.map((s) => s.json.message.token)).toEqual(['student-phone']);
    expect(sends[0].json.message.data).toEqual({
      type: 'chat_correction',
      conversation_id: 'conv-1',
      relationship_id: 'rel-1',
      message_id: 'm-s',
      sender_name: 'Minghui',
      content: '✏️ Minghui corrected your message',
      url: '/connections/rel-1/chat/conv-1',
    });
    expect(sends[0].json.message.android).toMatchObject({ collapse_key: 'correction-m-s', ttl: '86400s' });
    expect(google.calls.some((c) => c.url.includes('sendgrid'))).toBe(false);

    // Web Push payload (service level, with a spy).
    const webPush = vi.fn(async () => ({ sent: 1, failed: 0, removed: 0 }));
    await notifyChatCorrection(w.env, { message: { id: 'm-s', conversation_id: 'conv-1' }, studentId: STUDENT, relationshipId: 'rel-1', tutorId: TUTOR }, { webPush, fetcher: google.fetcher });
    const [, users, payload] = webPush.mock.calls[0] as unknown as [Env, string[], Record<string, unknown>];
    expect(users).toEqual([STUDENT]);
    expect(payload).toEqual({
      type: 'chat_correction',
      title: 'Minghui',
      body: '✏️ Minghui corrected your message',
      url: '/connections/rel-1/chat/conv-1',
      tag: 'chat-conv-1',
      conversation_id: 'conv-1',
      relationship_id: 'rel-1',
      message_id: 'm-s',
    });
    expect(chatCorrectionFcmData({ id: 'm', conversation_id: 'c' }, 'r', null).content).toBe('✏️ Your tutor corrected your message');
    expect(chatCorrectionWebPush({ id: 'm', conversation_id: 'c' }, 'r', null).title).toBe('Your tutor');
  });
});
