/**
 * One chat per pair (docs/CHAT.md "One chat per pair"): migration 0098 merges a
 * relationship's extra human conversations into one, without losing anything;
 * the API then gets-or-creates that one chat and answers merged-away ids as it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, applyMigrationsFrom, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive from '../chat-live';
import chatMessages from '../chat-messages';
import tutorDashboard from '../tutor-dashboard';
import oneChat, { mountMergedConversations } from '../one-chat';
import { openRelationshipConversation } from '../../services/conversations';
import type { Env, MessageWithSender } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function users(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['tutor-2', 'Li'], ['stranger', 'Nobody']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
}

const msg = (db: SqliteD1, id: string, conv: string, sender: string, at: string, content = '你好', extra: Record<string, string | null> = {}) => {
  const cols = ['id', 'conversation_id', 'sender_id', 'content', 'created_at', ...Object.keys(extra)];
  db.raw.run(`INSERT INTO messages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, [id, conv, sender, content, at, ...Object.values(extra)]);
};

describe('migration 0098: merge a pair\'s conversations into one', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1({ stopBefore: '0098' });
    users(db);
    // Minghui ↔ Jerome: three human conversations (the invite's "Welcome", a titled one, an untitled one).
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at, last_message_at) VALUES ('c-welcome', 'rel-1', 'Welcome', '2026-08-01 09:00:00', '2026-08-01 09:00:00')");
    db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at, last_message_at) VALUES ('c-homework', 'rel-1', 'Homework', '2026-09-01T09:00:00.000Z', '2026-10-01T08:00:00.000Z')");
    db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at, last_message_at) VALUES ('c-chat', 'rel-1', NULL, '2026-09-15T09:00:00.000Z', '2026-09-20T10:00:00.000Z')");
    // Old-format timestamp (datetime('now')) that is the NEWEST activity — c-welcome must not win by string order.
    msg(db, 'w1', 'c-welcome', TUTOR, '2026-08-01 09:00:00', '欢迎！');
    msg(db, 'h1', 'c-homework', TUTOR, '2026-09-30T08:00:00.000Z', '作业：第三课', { pinned_at: '2026-09-30T08:05:00.000Z', pinned_by: TUTOR });
    msg(db, 'h2', 'c-homework', STUDENT, '2026-10-01T08:00:00.000Z', '我昨天去公园了', {
      correction: JSON.stringify({ text: '我昨天去了公园', note: '了 after the verb', by: TUTOR, at: '2026-10-01T08:10:00.000Z' }),
    });
    msg(db, 'c1', 'c-chat', STUDENT, '2026-09-20T09:00:00.000Z', '', {
      attachment: JSON.stringify({ kind: 'image', key: 'chat-media/c-chat/c1.jpg', width: 800, height: 600, bytes: 1234, mime: 'image/jpeg' }),
    });
    msg(db, 'c2', 'c-chat', TUTOR, '2026-09-20T10:00:00.000Z', '好看！', { reply_to_message_id: 'c1' });
    db.raw.run("INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES ('r1', 'c2', ?, '❤️')", [STUDENT]);
    db.raw.run("INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES ('r2', 'w1', ?, '👍')", [STUDENT]);
    // Read markers in every chat; the student had read Homework to h1 only, the welcome fully.
    db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('c-welcome', ?, '2026-08-01 09:00:00')", [STUDENT]);
    db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('c-chat', ?, '2026-09-20T10:00:00.000Z')", [STUDENT]);
    db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('c-homework', ?, '2026-09-30T08:00:00.000Z')", [STUDENT]);
    db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('c-chat', ?, '2026-09-20T10:00:00.000Z')", [TUTOR]);
    db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('c-homework', ?, '2026-10-01T08:00:00.000Z')", [TUTOR]);
    db.raw.run("INSERT INTO notifications (id, user_id, type, title, conversation_id, is_read) VALUES ('n1', ?, 'new_chat_message', 'New message', 'c-chat', 0)", [STUDENT]);
    // Claude practice chats: never merged, may be several.
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id, title, is_ai_conversation) VALUES ('ai-1', 'rel-ai', 'Café', 1)");
    db.raw.run("INSERT INTO conversations (id, relationship_id, title, is_ai_conversation) VALUES ('ai-2', 'rel-ai', 'Taxi', 1)");
    msg(db, 'a1', 'ai-1', 'claude-ai', '2026-09-01T09:00:00.000Z', '欢迎光临');
    msg(db, 'a2', 'ai-2', 'claude-ai', '2026-09-02T09:00:00.000Z', '去哪儿？');
    // Another pair with one chat: untouched.
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', 'tutor-2', ?, 'tutor', 'active')", [STUDENT]);
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('c-li', 'rel-2')");
    msg(db, 'l1', 'c-li', 'tutor-2', '2026-09-03T09:00:00.000Z', '你好');
    applyMigrationsFrom(db, '0098');
  });

  it('picks the most recently active conversation and moves every message into it', () => {
    const convs = db.rows<{ id: string; merged_into: string | null }>("SELECT id, merged_into FROM conversations WHERE relationship_id = 'rel-1' ORDER BY id");
    expect(convs).toEqual([
      { id: 'c-chat', merged_into: 'c-homework' },
      { id: 'c-homework', merged_into: null },
      { id: 'c-welcome', merged_into: 'c-homework' },
    ]);
    const msgs = db.rows<{ id: string; conversation_id: string }>("SELECT id, conversation_id FROM messages WHERE id IN ('w1','h1','h2','c1','c2') ORDER BY julianday(created_at)");
    expect(msgs.map((m) => m.id)).toEqual(['w1', 'c1', 'c2', 'h1', 'h2']);
    expect(new Set(msgs.map((m) => m.conversation_id))).toEqual(new Set(['c-homework']));
    expect(db.rows("SELECT id FROM messages WHERE conversation_id IN ('c-chat', 'c-welcome')")).toEqual([]);
    const primary = db.rows<{ last_message_at: string }>("SELECT last_message_at FROM conversations WHERE id = 'c-homework'")[0];
    expect(primary.last_message_at).toBe('2026-10-01T08:00:00.000Z');
  });

  it('keeps pins, reactions, corrections, replies and the photo', () => {
    const h1 = db.rows<{ pinned_at: string | null; pinned_by: string | null }>("SELECT pinned_at, pinned_by FROM messages WHERE id = 'h1'")[0];
    expect(h1).toEqual({ pinned_at: '2026-09-30T08:05:00.000Z', pinned_by: TUTOR });
    expect(db.rows("SELECT id, message_id FROM message_reactions ORDER BY id")).toEqual([
      { id: 'r1', message_id: 'c2' },
      { id: 'r2', message_id: 'w1' },
    ]);
    expect(JSON.parse(db.rows<{ correction: string }>("SELECT correction FROM messages WHERE id = 'h2'")[0].correction)).toMatchObject({ text: '我昨天去了公园' });
    expect(db.rows("SELECT reply_to_message_id FROM messages WHERE id = 'c2'")).toEqual([{ reply_to_message_id: 'c1' }]);
    // The photo's R2 key lives in the attachment and is served by message id: unchanged.
    expect(JSON.parse(db.rows<{ attachment: string }>("SELECT attachment FROM messages WHERE id = 'c1'")[0].attachment).key).toBe('chat-media/c-chat/c1.jpg');
  });

  it('keeps the furthest read marker per person and points notifications at the one chat', () => {
    expect(db.rows("SELECT conversation_id, user_id, last_read_at FROM conversation_reads ORDER BY user_id")).toEqual([
      { conversation_id: 'c-homework', user_id: STUDENT, last_read_at: '2026-09-30T08:00:00.000Z' },
      { conversation_id: 'c-homework', user_id: TUTOR, last_read_at: '2026-10-01T08:00:00.000Z' },
    ]);
    expect(db.rows("SELECT conversation_id FROM notifications WHERE id = 'n1'")).toEqual([{ conversation_id: 'c-homework' }]);
  });

  it('leaves Claude practice chats and single chats alone, and cleans up', () => {
    expect(db.rows("SELECT id, merged_into, is_ai_conversation FROM conversations WHERE relationship_id IN ('rel-ai', 'rel-2') ORDER BY id")).toEqual([
      { id: 'ai-1', merged_into: null, is_ai_conversation: 1 },
      { id: 'ai-2', merged_into: null, is_ai_conversation: 1 },
      { id: 'c-li', merged_into: null, is_ai_conversation: 0 },
    ]);
    expect(db.rows("SELECT id, conversation_id FROM messages WHERE id IN ('a1','a2','l1') ORDER BY id")).toEqual([
      { id: 'a1', conversation_id: 'ai-1' },
      { id: 'a2', conversation_id: 'ai-2' },
      { id: 'l1', conversation_id: 'c-li' },
    ]);
    expect(db.rows("SELECT name FROM sqlite_master WHERE name = '_chat_merge'")).toEqual([]);
    expect(db.rows('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('a second live human conversation can no longer exist; practice chats still can', () => {
    expect(() => db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('c-dup', 'rel-1')")).toThrow(/UNIQUE/);
    expect(() => db.raw.run("INSERT INTO conversations (id, relationship_id, is_ai_conversation) VALUES ('ai-3', 'rel-ai', 1)")).not.toThrow();
  });
});

describe('the one chat over the API', () => {
  let db: SqliteD1;

  function app(userId: string) {
    const a = new Hono<{ Bindings: Env }>();
    a.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    mountMergedConversations(a);
    a.route('/api', oneChat);
    a.route('/api', tutorDashboard);
    a.route('/api', chatLive);
    a.route('/api', chatMessages);
    const env = { DB: db, SESSION_SECRET: 's' } as unknown as Env;
    return (method: string, path: string, body?: unknown) =>
      a.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  }

  beforeEach(async () => {
    db = await createSqliteD1();
    users(db);
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [STUDENT]);
  });

  it('open is get-or-create: the first call makes the chat, every later one returns it', async () => {
    const tutor = app(TUTOR);
    const first = await tutor('POST', '/api/relationships/rel-1/conversations/open');
    expect(first.status).toBe(201);
    const { conversation_id, created } = (await first.json()) as { conversation_id: string; created: boolean };
    expect(created).toBe(true);
    const again = await app(STUDENT)('POST', '/api/relationships/rel-1/conversations/open');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ conversation_id, created: false });
    expect((await app('stranger')('POST', '/api/relationships/rel-1/conversations/open')).status).toBe(404);
  });

  it('creating a second conversation with a person returns the existing one (title ignored)', async () => {
    const tutor = app(TUTOR);
    const a = await tutor('POST', '/api/relationships/rel-1/conversations', {});
    expect(a.status).toBe(201);
    const b = await tutor('POST', '/api/relationships/rel-1/conversations', { title: 'Homework' });
    expect(b.status).toBe(200);
    const [ca, cb] = (await Promise.all([a.json(), b.json()])) as Array<{ id: string; title: string | null }>;
    expect(cb.id).toBe(ca.id);
    expect(cb.title).toBeNull();
    expect(db.rows("SELECT id FROM conversations WHERE relationship_id = 'rel-1'")).toHaveLength(1);
    // Two devices racing still end with one chat.
    const raced = await Promise.all([openRelationshipConversation(db, 'rel-1', TUTOR), openRelationshipConversation(db, 'rel-1', STUDENT)]);
    expect(raced.map((r) => r.conversation.id)).toEqual([ca.id, ca.id]);
  });

  it('Claude practice chats may be several', async () => {
    const student = app(STUDENT);
    const a = (await (await student('POST', '/api/relationships/rel-ai/conversations', { scenario: 'café' })).json()) as { id: string };
    const b = (await (await student('POST', '/api/relationships/rel-ai/conversations', { scenario: 'taxi' })).json()) as { id: string };
    expect(a.id).not.toBe(b.id);
    // …and keep their titles.
    const renamed = await student('PATCH', `/api/conversations/${a.id}`, { title: 'At the café' });
    expect(renamed.status).toBe(200);
  });

  it('a person\'s chat has no title any more', async () => {
    const tutor = app(TUTOR);
    const { conversation_id } = (await (await tutor('POST', '/api/relationships/rel-1/conversations/open')).json()) as { conversation_id: string };
    expect((await tutor('PATCH', `/api/conversations/${conversation_id}`, { title: 'Homework' })).status).toBe(410);
  });

  it('a merged-away id answers as the chat it became: get, messages, send, read', async () => {
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('c-main', 'rel-1')");
    db.raw.run("INSERT INTO conversations (id, relationship_id, title, merged_into) VALUES ('c-old', 'rel-1', 'Homework', 'c-main')");
    msg(db, 'm1', 'c-main', TUTOR, '2026-10-01T09:00:00.000Z', '作业');
    const student = app(STUDENT);

    const got = await student('GET', '/api/conversations/c-old');
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ id: 'c-main', relationship_id: 'rel-1', merged_from: 'c-old', merged_into: null });
    expect(await (await student('GET', '/api/conversations/c-main')).json()).toMatchObject({ id: 'c-main', merged_from: null });

    const listed = await student('GET', '/api/conversations/c-old/messages');
    expect(listed.headers.get('X-Conversation-Id')).toBe('c-main');
    expect(((await listed.json()) as { messages: MessageWithSender[] }).messages.map((m) => m.id)).toEqual(['m1']);

    // An old outbox / notification reply posting to the old id lands in the one chat.
    const sent = await student('POST', '/api/conversations/c-old/messages', { content: '好的', client_id: 'cl-1' });
    expect(sent.status).toBe(201);
    expect(((await sent.json()) as MessageWithSender).conversation_id).toBe('c-main');
    const read = (await (await student('POST', '/api/conversations/c-old/read')).json()) as { conversation_id: string };
    expect(read.conversation_id).toBe('c-main');

    // Lists never show the merged-away row.
    const rows = (await (await student('GET', '/api/me/chats')).json()) as { conversations: Array<{ conversation_id: string }> };
    expect(rows.conversations.map((c) => c.conversation_id)).toEqual(['c-main']);
    expect((await (await student('POST', '/api/relationships/rel-1/conversations/open')).json())).toEqual({ conversation_id: 'c-main', created: false });
    // A stranger gets nothing through an old id either.
    expect((await app('stranger')('GET', '/api/conversations/c-old')).status).toBe(404);
  });
});
