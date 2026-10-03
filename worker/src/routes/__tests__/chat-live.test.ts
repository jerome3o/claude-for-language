/**
 * Chat delivery routes (docs/CHAT.md §2) against real SQLite with every
 * migration: idempotent sends, read markers, the inbox, read_state, device
 * tokens and the live ticket — plus the 0089 backfill of read markers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { applyMigrationsFrom, createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive, { mountLiveSocket } from '../chat-live';
import { createPurposeTicket, verifyPurposeTicket } from '../../services/chat/ticket';
import { createJoinTicket, verifyJoinTicket } from '../../services/calls/ticket';
import type { Env } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

function seed(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['stranger', 'Nobody'], ['tutor-2', 'Li']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Homework')");
  // One chat per pair: the student's second chat is with a second tutor.
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', 'tutor-2', ?, 'tutor', 'active')", [STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-2', 'rel-2', NULL)");
  // A role-play chat with Claude: never in the inbox.
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, is_ai_conversation) VALUES ('conv-ai', 'rel-ai', 'Café', 1)");
}

function makeApp(db: SqliteD1, userId: string | null, extraEnv: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  mountLiveSocket(app);
  app.use('/api/*', async (c, next) => {
    if (!userId) return c.json({ error: 'Not authenticated' }, 401);
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', chatLive);
  const env = { DB: db, SESSION_SECRET: 'test-secret', ...extraEnv } as unknown as Env;
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return {
    send: (conv: string, body: Record<string, unknown>) => call('POST', `/api/conversations/${conv}/messages`, body),
    messages: (conv: string) => call('GET', `/api/conversations/${conv}/messages`),
    read: (conv: string, body: Record<string, unknown> = {}) => call('POST', `/api/conversations/${conv}/read`, body),
    inbox: (q = '') => call('GET', `/api/me/chat-inbox${q}`),
    call,
    app,
    env,
  };
}

/** Inserts a message with an explicit timestamp (ordering in tests). */
function insertMessage(db: SqliteD1, id: string, conv: string, sender: string, at: string, content = '你好') {
  db.raw.run('INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [id, conv, sender, content, at]);
}

type Inbox = {
  server_time: string;
  messages: Array<{ id: string; conversation_id: string; relationship_id: string; content: string; created_at: string; sender: { id: string; name: string } }>;
  conversations: Array<{ conversation_id: string; relationship_id: string; title: string | null; other_user: { id: string; name: string }; unread: number; last_read_at: string | null; last_message_at: string }>;
};

describe('chat delivery routes', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('sends idempotently by client_id: 201 then 200 with the same message, one row, notified once', async () => {
    const tutor = makeApp(db, TUTOR);
    const first = await tutor.send('conv-1', { content: '明天见', client_id: 'outbox-abc-1' });
    expect(first.status).toBe(201);
    const msg = await first.json() as { id: string; client_id: string; sender: { name: string } };
    expect(msg.client_id).toBe('outbox-abc-1');
    expect(msg.sender.name).toBe('Minghui');

    const again = await tutor.send('conv-1', { content: '明天见', client_id: 'outbox-abc-1' });
    expect(again.status).toBe(200);
    const repeat = await again.json() as { id: string; duplicate?: boolean; client_id: string };
    expect(repeat.id).toBe(msg.id);
    expect(repeat.duplicate).toBeUndefined();
    expect(repeat.client_id).toBe('outbox-abc-1');

    expect(db.rows('SELECT id FROM messages WHERE conversation_id = ?', ['conv-1'])).toHaveLength(1);
    // The in-app notification (the bell) was written once, not twice.
    expect(db.rows("SELECT title FROM notifications WHERE user_id = ? AND type = 'new_chat_message'", [STUDENT])).toEqual([{ title: 'New message from Minghui' }]);

    // Another sender may use the same key; it is per sender.
    const student = makeApp(db, STUDENT);
    expect((await student.send('conv-1', { content: '好的', client_id: 'outbox-abc-1' })).status).toBe(201);
    // Without a key every send is new; a malformed key is refused.
    expect((await tutor.send('conv-1', { content: 'a' })).status).toBe(201);
    expect((await tutor.send('conv-1', { content: 'a' })).status).toBe(201);
    expect((await tutor.send('conv-1', { content: 'a', client_id: 'has spaces' })).status).toBe(400);
  });

  it('moves the sender’s own marker to their message and clears their bell', async () => {
    insertMessage(db, 'm-1', 'conv-1', STUDENT, '2026-10-01T09:00:00.000Z');
    db.raw.run("INSERT INTO notifications (id, user_id, type, title, conversation_id) VALUES ('n-1', ?, 'new_chat_message', 'New message from Jerome', 'conv-1')", [TUTOR]);
    const tutor = makeApp(db, TUTOR);
    const res = await tutor.send('conv-1', { content: '收到' });
    const msg = await res.json() as { created_at: string };
    expect(db.rows('SELECT last_read_at FROM conversation_reads WHERE conversation_id = ? AND user_id = ?', ['conv-1', TUTOR])).toEqual([{ last_read_at: msg.created_at }]);
    expect(db.rows("SELECT is_read FROM notifications WHERE id = 'n-1'")).toEqual([{ is_read: 1 }]);
    const state = await (await tutor.messages('conv-1')).json() as { read_state: { me: string | null; other: string | null } };
    expect(state.read_state).toEqual({ me: msg.created_at, other: null });
  });

  it('reads forward only, counts unread from the other person, and reports read_state', async () => {
    insertMessage(db, 'm-1', 'conv-1', TUTOR, '2026-10-01T09:00:00.000Z');
    insertMessage(db, 'm-2', 'conv-1', TUTOR, '2026-10-01T09:01:00.000Z');
    insertMessage(db, 'm-3', 'conv-1', STUDENT, '2026-10-01T09:02:00.000Z');
    insertMessage(db, 'm-4', 'conv-1', TUTOR, '2026-10-01T09:03:00.000Z');
    db.raw.run("INSERT INTO notifications (id, user_id, type, title, conversation_id) VALUES ('n-1', ?, 'new_chat_message', 't', 'conv-1')", [STUDENT]);
    const student = makeApp(db, STUDENT);

    let r = await (await student.read('conv-1', { up_to: '2026-10-01T09:01:00.000Z' })).json();
    // m-3 is mine; only m-4 is still unread.
    expect(r).toEqual({ conversation_id: 'conv-1', last_read_at: '2026-10-01T09:01:00.000Z', unread: 1 });
    // Partly read: the bell stays.
    expect(db.rows("SELECT is_read FROM notifications WHERE id = 'n-1'")).toEqual([{ is_read: 0 }]);

    // An older up_to never moves the marker back.
    r = await (await student.read('conv-1', { up_to: '2026-10-01T09:00:00.000Z' })).json();
    expect(r).toMatchObject({ last_read_at: '2026-10-01T09:01:00.000Z', unread: 1 });

    // Default = the newest message; never past it.
    r = await (await student.read('conv-1', { up_to: '2099-01-01T00:00:00.000Z' })).json();
    expect(r).toEqual({ conversation_id: 'conv-1', last_read_at: '2026-10-01T09:03:00.000Z', unread: 0 });
    expect(db.rows("SELECT is_read FROM notifications WHERE id = 'n-1'")).toEqual([{ is_read: 1 }]);

    const tutorView = await (await makeApp(db, TUTOR).messages('conv-1')).json() as { messages: unknown[]; read_state: unknown };
    expect(tutorView.messages).toHaveLength(4);
    expect(tutorView.read_state).toEqual({ me: null, other: '2026-10-01T09:03:00.000Z' });

    expect((await student.read('conv-1', { up_to: 'yesterday' })).status).toBe(400);
    expect((await makeApp(db, 'stranger').read('conv-1')).status).toBe(404);
  });

  it('a conversation with no messages reads as nothing to read', async () => {
    const r = await (await makeApp(db, STUDENT).read('conv-2')).json();
    expect(r).toEqual({ conversation_id: 'conv-2', last_read_at: null, unread: 0 });
  });

  it('the inbox lists unread messages to me, oldest first, and conversations with unread', async () => {
    const recent = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    insertMessage(db, 'old', 'conv-1', TUTOR, new Date(Date.now() - 9 * 86_400_000).toISOString(), 'old one');
    insertMessage(db, 'm-1', 'conv-1', TUTOR, recent(30), '第一');
    insertMessage(db, 'mine', 'conv-1', STUDENT, recent(20), 'my own');
    insertMessage(db, 'm-2', 'conv-2', 'tutor-2', recent(10), '第二');
    insertMessage(db, 'ai-1', 'conv-ai', 'claude-ai', recent(5), 'Bonjour');

    const student = makeApp(db, STUDENT);
    let inbox = await (await student.inbox()).json() as Inbox;
    // 7 days by default; never my own; never the Claude role-play chat.
    expect(inbox.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(inbox.messages[0]).toMatchObject({ conversation_id: 'conv-1', relationship_id: 'rel-1', content: '第一', sender: { id: TUTOR, name: 'Minghui' } });
    expect(inbox.conversations.map((c) => [c.conversation_id, c.unread])).toEqual([['conv-2', 1], ['conv-1', 2]]);
    expect(inbox.conversations[1]).toMatchObject({ title: 'Homework', other_user: { id: TUTOR, name: 'Minghui' }, last_read_at: null });
    expect(typeof inbox.server_time).toBe('string');

    // since narrows the messages, not the unread counts.
    inbox = await (await student.inbox(`?since=${encodeURIComponent(recent(15))}`)).json() as Inbox;
    expect(inbox.messages.map((m) => m.id)).toEqual(['m-2']);
    expect(inbox.conversations).toHaveLength(2);

    // Reading conv-1 drops it (and its messages) from the inbox.
    await student.read('conv-1');
    inbox = await (await student.inbox()).json() as Inbox;
    expect(inbox.messages.map((m) => m.id)).toEqual(['m-2']);
    expect(inbox.conversations.map((c) => c.conversation_id)).toEqual(['conv-2']);

    // The tutor has nothing unread except my message.
    const tutorInbox = await (await makeApp(db, TUTOR).inbox()).json() as Inbox;
    expect(tutorInbox.messages.map((m) => m.id)).toEqual(['mine']);
    expect((await student.inbox('?since=garbage')).status).toBe(400);
  });

  it('caps the inbox at 50 messages, oldest first', async () => {
    const base = Date.now() - 3600_000;
    for (let i = 0; i < 60; i++) insertMessage(db, `m-${String(i).padStart(2, '0')}`, 'conv-1', TUTOR, new Date(base + i * 1000).toISOString());
    const inbox = await (await makeApp(db, STUDENT).inbox()).json() as Inbox;
    expect(inbox.messages).toHaveLength(50);
    expect(inbox.messages[0].id).toBe('m-00');
    expect(inbox.conversations[0].unread).toBe(60);
  });

  it('stores device tokens by token (moving between accounts) and deletes only my own', async () => {
    const student = makeApp(db, STUDENT);
    const token = 'fcm:APA91b-token-0123456789abcdef';
    let res = await student.call('POST', '/api/push/devices', { token, device_label: 'Pixel 10 Pro Fold' });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect(db.rows('SELECT id, user_id, platform, app, device_label FROM device_push_tokens')).toEqual([
      { id, user_id: STUDENT, platform: 'android', app: 'lab', device_label: 'Pixel 10 Pro Fold' },
    ]);
    // The same phone signs in as the tutor: the token moves, same row.
    res = await makeApp(db, TUTOR).call('POST', '/api/push/devices', { token, platform: 'android', app: 'lab' });
    expect((await res.json() as { id: string }).id).toBe(id);
    expect(db.rows('SELECT user_id FROM device_push_tokens')).toEqual([{ user_id: TUTOR }]);

    expect((await student.call('POST', '/api/push/devices', { token: 'short' })).status).toBe(400);
    expect((await student.call('POST', '/api/push/devices', { token, platform: 'ios' })).status).toBe(400);
    expect(await (await student.call('DELETE', '/api/push/devices', { token })).json()).toEqual({ ok: true, removed: false });
    expect(await (await makeApp(db, TUTOR).call('DELETE', '/api/push/devices', { token })).json()).toEqual({ ok: true, removed: true });
  });

  it('hands out a live ticket bound to the purpose and the user', async () => {
    const hub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('hub', { status: 200 }) }) };
    const app = makeApp(db, STUDENT, { CHAT_HUB: hub as never });
    const res = await app.call('POST', '/api/live/ticket');
    const body = await res.json() as { ticket: string; ws_path: string };
    expect(body.ws_path).toBe('/api/live/ws');
    const env = { SESSION_SECRET: 'test-secret' };
    expect(await verifyPurposeTicket(env, body.ticket, 'live')).toMatchObject({ purpose: 'live', userId: STUDENT });
    // A live ticket is not a call ticket, and a call ticket is not a live ticket.
    expect(await verifyJoinTicket(env, body.ticket, 'live')).toBeNull();
    expect(await verifyPurposeTicket(env, await createJoinTicket(env, 'call-1', STUDENT), 'live')).toBeNull();
    // Expired / tampered / another secret.
    const old = await createPurposeTicket(env, 'live', STUDENT, Date.now() - 120_000);
    expect(await verifyPurposeTicket(env, old, 'live')).toBeNull();
    expect(await verifyPurposeTicket({ SESSION_SECRET: 'other' }, body.ticket, 'live')).toBeNull();
    expect(await verifyPurposeTicket(env, body.ticket.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')), 'live')).toBeNull();

    // The socket route sits before auth and checks the ticket itself.
    const anon = makeApp(db, null, { CHAT_HUB: hub as never });
    expect((await anon.call('GET', '/api/live/ws')).status).toBe(426);
    const upgrade = (t: string) =>
      anon.app.request(`/api/live/ws?ticket=${encodeURIComponent(t)}`, { headers: { Upgrade: 'websocket' } }, anon.env);
    expect((await upgrade('nope')).status).toBe(401);
    expect((await upgrade(body.ticket)).status).toBe(200);
    // Without the hub bound, no tickets.
    expect((await makeApp(db, STUDENT).call('POST', '/api/live/ticket')).status).toBe(503);
  });
});

describe('0089 read-marker backfill', () => {
  it('marks old chats read, except up to my own last message where a chat notification is unread', async () => {
    const db = await createSqliteD1({ stopBefore: '0089' });
    seed(db);
    insertMessage(db, 'a', 'conv-1', TUTOR, '2026-09-01T10:00:00.000Z');
    insertMessage(db, 'b', 'conv-1', STUDENT, '2026-09-01T11:00:00.000Z');
    insertMessage(db, 'c', 'conv-1', TUTOR, '2026-09-01T12:00:00.000Z');
    db.raw.run("INSERT INTO notifications (id, user_id, type, title, conversation_id, is_read) VALUES ('n', ?, 'new_chat_message', 't', 'conv-1', 0)", [STUDENT]);
    applyMigrationsFrom(db, '0089');
    const rows = db.rows('SELECT conversation_id, user_id, last_read_at FROM conversation_reads ORDER BY user_id');
    expect(rows).toEqual([
      { conversation_id: 'conv-1', user_id: STUDENT, last_read_at: '2026-09-01T11:00:00.000Z' },
      { conversation_id: 'conv-1', user_id: TUTOR, last_read_at: '2026-09-01T12:00:00.000Z' },
    ]);
  });
});
