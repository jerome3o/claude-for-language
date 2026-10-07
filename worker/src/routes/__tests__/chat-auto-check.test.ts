/**
 * "Check my Chinese automatically" (docs/CHAT.md "Auto-check") against real
 * SQLite with every migration: who gets checked (student side, Claude practice
 * chat, the setting either way), the skip rules, idempotency per message + text,
 * an edit re-checks, the result stored + broadcast and shown only to the sender.
 * Claude is faked below `structuredCall` (the real retry / validate logic runs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive from '../chat-live';
import chatMessages from '../chat-messages';
import { emailPrefs } from '../email-prefs';
import { autoCheckMessageInBackground, normalizeAutoCheck, AUTO_CHECK_MODEL } from '../../services/chat/auto-check';
import { autoCheckSkipReason } from '@shared/chats/autoCheck';
import type { Env, MessageWithSender } from '../../types';
import { CLAUDE_AI_USER_ID } from '../../types';

const ai = vi.hoisted(() => ({ create: vi.fn() }));

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
const SENTENCE = '我昨天去了商店买东西了';

type CreateParams = { model: string; system: string; tool_choice: { name: string }; messages: Array<{ content: string }> };
const toolReply = (input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'x', input }], usage: { output_tokens: 10 } });

const IMPROVABLE = {
  status: 'improvable',
  severity: 'moderate',
  corrected: { hanzi: '我昨天去商店买东西了', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', english: 'I went to the shop to buy things yesterday.' },
  mistakes: [
    {
      quote: '去了',
      fix: '去',
      why: 'One 了 at the end is enough when the verbs are a series.',
      card: { hanzi: '去商店买东西', pinyin: 'qù shāngdiàn mǎi dōngxi', english: 'go to the shop to buy things', fun_facts: '去 (qù) go\n商店 (shāngdiàn) shop' },
    },
  ],
  alternative: { hanzi: '我昨天去商店买了点东西', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi le diǎn dōngxi', english: 'I bought a few things at the shop yesterday.', note: 'More natural' },
  card: { hanzi: '我昨天去商店买东西了。', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', english: 'I went to the shop to buy things yesterday.', fun_facts: '我 (wǒ) I\n昨天 (zuótiān) yesterday' },
};

let reply: unknown = IMPROVABLE;
function installClaude() {
  ai.create.mockReset();
  ai.create.mockImplementation(async (params: CreateParams) => {
    if (params.tool_choice.name === 'split_words') return toolReply({ words: [] });
    if (params.tool_choice.name === 'check_message') return toolReply(reply);
    throw new Error(`unexpected tool ${params.tool_choice.name}`);
  });
}
const checkCalls = () => ai.create.mock.calls.map(([p]) => p as CreateParams).filter((p) => p.tool_choice.name === 'check_message');

function seed(db: SqliteD1) {
  for (const [id, name, role] of [[TUTOR, 'Minghui', 'tutor'], [STUDENT, 'Jerome', 'student'], [CLAUDE_AI_USER_ID, 'Claude', 'tutor']]) {
    db.raw.run('INSERT OR IGNORE INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, role]);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Homework')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, ?, 'student', 'active')", [TUTOR, CLAUDE_AI_USER_ID]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, is_ai_conversation) VALUES ('conv-ai', 'rel-ai', 'Practice', 1)");
}

function makeWorld(db: SqliteD1) {
  const events: Array<{ user: string; event: { type: string; message?: MessageWithSender } }> = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => ({ broadcast: async (event: { type: string; message?: MessageWithSender }) => { events.push({ user: id, event }); return 1; } }),
  };
  const bucket = { put: async () => undefined, delete: async () => undefined, get: async () => null };
  const env = { DB: db, SESSION_SECRET: 's', CHAT_HUB: ns, ANTHROPIC_API_KEY: 'test-key', AUDIO_BUCKET: bucket } as unknown as Env;
  const as = (userId: string) => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => { c.set('user', { id: userId } as never); await next(); });
    app.route('/api', chatLive);
    app.route('/api', chatMessages);
    app.route('/api', emailPrefs);
    return (method: string, path: string, body?: unknown) =>
      app.request(
        path,
        body === undefined
          ? { method }
          : body instanceof Uint8Array
            ? { method, headers: { 'Content-Type': 'image/png' }, body }
            : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        env,
      );
  };
  return { env, events, as };
}

const json = async <T = MessageWithSender>(res: Response) => (await res.json()) as T;
const messagesOf = async (w: ReturnType<typeof makeWorld>, user: string, conv = 'conv-1') =>
  (await json<{ messages: MessageWithSender[] }>(await w.as(user)('GET', `/api/conversations/${conv}/messages`))).messages;

describe('auto-check on chat messages', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    installClaude();
    reply = IMPROVABLE;
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  it("the student's message is checked in the background; stored, broadcast, and only the sender sees it", async () => {
    const res = await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE });
    expect(res.status).toBe(201);
    const sent = await json(res);
    expect(sent.auto_check ?? null).toBeNull();

    const calls = checkCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(AUTO_CHECK_MODEL);
    expect(calls[0].messages[0].content).toContain(SENTENCE);

    const [mine] = await messagesOf(w, STUDENT);
    expect(mine.auto_check).toMatchObject({
      text: SENTENCE,
      status: 'improvable',
      corrected: '我昨天去商店买东西了',
      severity: 'moderate',
      mistakes: [{ quote: '去了', fix: '去', why: expect.stringContaining('了') }],
      alternative: { hanzi: '我昨天去商店买了点东西' },
    });
    expect(mine.auto_check!.card!.hanzi).toBe('我昨天去商店买东西了。');
    expect(mine.auto_check!.mistakes[0].card!.hanzi).toBe('去商店买东西');
    // The tutor never sees the check.
    const [theirs] = await messagesOf(w, TUTOR);
    expect(theirs.auto_check ?? null).toBeNull();

    const withCheck = w.events.filter((e) => e.event.type === 'message_updated' && e.event.message?.auto_check);
    expect(withCheck.map((e) => e.user)).toEqual([STUDENT]);
    const tutorUpdates = w.events.filter((e) => e.event.type === 'message_updated' && e.user === TUTOR);
    expect(tutorUpdates.every((e) => !e.event.message?.auto_check)).toBe(true);

    // Through ?since= too (the offline path).
    const since = mine.created_at;
    const later = await json<{ messages: MessageWithSender[] }>(await w.as(STUDENT)('GET', `/api/conversations/conv-1/messages?since=${encodeURIComponent(since)}`));
    expect(later.messages.find((m) => m.id === sent.id)?.auto_check?.status).toBe('improvable');
  });

  it('a photo with a Chinese caption is checked on the caption (it used to be skipped), shown with the photo', async () => {
    // A minimal PNG header (sniffImage reads the magic bytes + IHDR size).
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]);
    const res = await w.as(STUDENT)('POST', `/api/conversations/conv-1/media?kind=image&caption=${encodeURIComponent(SENTENCE)}`, png);
    expect(res.status).toBe(201);
    expect(checkCalls()).toHaveLength(1);
    expect(checkCalls()[0].messages[0].content).toContain(SENTENCE);
    const [mine] = await messagesOf(w, STUDENT);
    expect(mine.attachment?.kind).toBe('image');
    expect(mine.auto_check).toMatchObject({ text: SENTENCE, status: 'improvable' });
    const [theirs] = await messagesOf(w, TUTOR);
    expect(theirs.auto_check ?? null).toBeNull();
  });

  it('a photo without a caption is not checked; a voice message is checked on its transcript once it exists', async () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]);
    expect((await w.as(STUDENT)('POST', '/api/conversations/conv-1/media?kind=image', png)).status).toBe(201);
    expect(checkCalls()).toHaveLength(0);

    const voice = (status: string, transcript: string | null) =>
      JSON.stringify({ kind: 'voice', duration_ms: 1500, bytes: 10, mime: 'audio/webm', transcript_status: status, transcript, translation: null, key: 'chat-media/conv-1/v1.webm' });
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, attachment, created_at) VALUES ('v1', 'conv-1', ?, '', ?, '2026-10-07 10:00:00')", [STUDENT, voice('pending', null)]);
    expect(await autoCheckMessageInBackground(w.env, 'v1')).toBe('skipped');
    db.raw.run('UPDATE messages SET attachment = ? WHERE id = ?', [voice('done', SENTENCE), 'v1']);
    expect(await autoCheckMessageInBackground(w.env, 'v1')).toBe('checked');
    expect(await autoCheckMessageInBackground(w.env, 'v1')).toBe('cached');
    const v = (await messagesOf(w, STUDENT)).find((m) => m.id === 'v1')!;
    expect(v.auto_check).toMatchObject({ text: SENTENCE, status: 'improvable' });
  });

  it("the tutor's messages are not checked; the outbox's repeat send is not checked twice", async () => {
    await w.as(TUTOR)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE });
    expect(checkCalls()).toHaveLength(0);

    await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE, client_id: 'c-1' });
    const again = await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE, client_id: 'c-1' });
    expect(again.status).toBe(200);
    expect(checkCalls()).toHaveLength(1);
  });

  it('the Claude practice chat checks the user; the setting turns it on for a tutor and off for a student', async () => {
    await w.as(TUTOR)('POST', '/api/conversations/conv-ai/messages', { content: SENTENCE });
    expect(checkCalls()).toHaveLength(1);

    expect((await w.as(STUDENT)('PUT', '/api/profile/chat-prefs', { chat_auto_check: false })).status).toBe(200);
    await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE });
    expect(checkCalls()).toHaveLength(1);

    await w.as(TUTOR)('PUT', '/api/profile/chat-prefs', { chat_auto_check: true });
    await w.as(TUTOR)('POST', '/api/conversations/conv-1/messages', { content: '你今天学了什么' });
    expect(checkCalls()).toHaveLength(2);

    expect((await w.as(TUTOR)('PUT', '/api/profile/chat-prefs', { chat_auto_check: 'yes' })).status).toBe(400);
    expect((await w.as(STUDENT)('PUT', '/api/profile/chat-prefs', { chat_auto_check: null })).status).toBe(200);
    expect(db.rows<{ chat_auto_check: number | null }>('SELECT chat_auto_check FROM users WHERE id = ?', [STUDENT])[0].chat_auto_check).toBeNull();
  });

  it('skips English, very short and emoji-only messages', async () => {
    for (const content of ['See you tomorrow', '好的', '👍🎉', 'I went to the 商店', '嗯！']) {
      await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content });
    }
    expect(checkCalls()).toHaveLength(0);
    expect(autoCheckSkipReason('好的')).toBe('too_short');
    expect(autoCheckSkipReason('👍')).toBe('no_chinese');
    expect(autoCheckSkipReason('I went to the 商店')).toBe('mostly_english');
    expect(autoCheckSkipReason('谢谢你')).toBeNull();
    expect(autoCheckSkipReason('我'.repeat(401))).toBe('too_long');
  });

  it('idempotent per message + text; an edit clears it and checks the new text', async () => {
    const sent = await json(await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE }));
    expect(await autoCheckMessageInBackground(w.env, sent.id)).toBe('cached');
    expect(checkCalls()).toHaveLength(1);

    reply = { status: 'ok', corrected: { hanzi: '我昨天去商店买东西了', pinyin: 'x', english: 'y' }, mistakes: [] };
    const edited = await json(await w.as(STUDENT)('PATCH', `/api/messages/${sent.id}`, { content: '我昨天去商店买东西了' }));
    expect(edited.auto_check ?? null).toBeNull();
    expect(checkCalls()).toHaveLength(2);
    const [msg] = await messagesOf(w, STUDENT);
    expect(msg.auto_check).toMatchObject({ status: 'ok', text: '我昨天去商店买东西了', mistakes: [] });

    // A result for an old text is never served; delete clears it.
    db.raw.run("UPDATE messages SET content = '别的' WHERE id = ?", [sent.id]);
    expect((await messagesOf(w, STUDENT))[0].auto_check ?? null).toBeNull();
    await w.as(STUDENT)('DELETE', `/api/messages/${sent.id}`);
    expect(db.rows<{ auto_check: string | null }>('SELECT auto_check FROM messages WHERE id = ?', [sent.id])[0].auto_check).toBeNull();
  });

  it('a failing model leaves the message alone (never throws), and a result for a changed text is not written', async () => {
    ai.create.mockImplementation(async () => { throw new Error('overloaded'); });
    const sent = await json(await w.as(STUDENT)('POST', '/api/conversations/conv-1/messages', { content: SENTENCE }));
    expect(sent.id).toBeTruthy();
    expect((await messagesOf(w, STUDENT))[0].auto_check ?? null).toBeNull();

    const out = await autoCheckMessageInBackground(w.env, sent.id, {
      check: async () => {
        db.raw.run("UPDATE messages SET content = '我改了' WHERE id = ?", [sent.id]);
        return IMPROVABLE;
      },
    });
    expect(out).toBe('skipped');
    expect(db.rows<{ auto_check: string | null }>('SELECT auto_check FROM messages WHERE id = ?', [sent.id])[0].auto_check).toBeNull();
  });
});

describe('normalizeAutoCheck', () => {
  it('an "improvable" that only changes punctuation and names nothing is ok', () => {
    const r = normalizeAutoCheck({ status: 'improvable', corrected: { hanzi: '我很好。', pinyin: 'wǒ hěn hǎo', english: "I'm fine." }, mistakes: [] }, '我很好');
    expect(r).toMatchObject({ status: 'ok', corrected: '我很好', mistakes: [], card: null, severity: null });
  });

  it('drops cards that break the card standard and mistakes that change nothing; defaults the severity', () => {
    const r = normalizeAutoCheck({
      status: 'improvable',
      corrected: { hanzi: '我去商店', pinyin: 'wǒ qù shāngdiàn', english: 'I go to the shop' },
      mistakes: [
        { quote: '去了', fix: '去', why: 'x', card: { hanzi: '去/走', pinyin: 'qù', english: 'go', fun_facts: '' } },
        { quote: '我', fix: '我', why: 'same' },
      ],
      alternative: { hanzi: '我去商店', pinyin: '', english: '' },
    }, '我去了商店');
    expect(r.status).toBe('improvable');
    expect(r.severity).toBe('moderate');
    expect(r.mistakes).toHaveLength(1);
    expect(r.mistakes[0].card).toBeNull();
    expect(r.alternative).toBeNull(); // same as the correction
    expect(r.card).toMatchObject({ hanzi: '我去商店', fun_facts: expect.stringContaining('去了 → 去') });
  });

  it('throws on a missing correction (structuredCall retries)', () => {
    expect(() => normalizeAutoCheck({ status: 'improvable', mistakes: [] }, '我去了')).toThrow();
    expect(() => normalizeAutoCheck({ status: 'maybe' }, '我去了')).toThrow();
  });
});
