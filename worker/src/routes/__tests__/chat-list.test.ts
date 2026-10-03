/**
 * GET /api/me/chats — the Chats tab (docs/CHAT.md "Chats tab"): every
 * conversation of my active relationships with its last message, my unread
 * count and the other person, newest first; Claude chats flagged is_ai.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chatLive from '../chat-live';
import type { Env } from '../../types';
import type { ChatListResponse } from '@shared/chats/inbox';

const ME = 'me';

function seed(db: SqliteD1) {
  for (const [id, name, pic] of [[ME, 'Jerome', null], ['tutor', 'Minghui', '/api/audio/avatars/t.jpg'], ['student', 'Li', null], ['gone', 'Gone', null]]) {
    db.raw.run('INSERT INTO users (id, email, name, role, picture_url) VALUES (?, ?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student', pic]);
  }
  // Minghui teaches me (she asked), I teach Li (I asked), a removed one, and Claude.
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-t', 'tutor', ?, 'tutor', 'active')", [ME]);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-s', ?, 'student', 'tutor', 'active')", [ME]);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-x', ?, 'gone', 'student', 'removed')", [ME]);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", [ME]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at) VALUES ('c-home', 'rel-t', 'Homework', '2026-09-01T00:00:00.000Z')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at) VALUES ('c-empty', 'rel-t', NULL, '2026-09-20T00:00:00.000Z')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at) VALUES ('c-li', 'rel-s', NULL, '2026-09-01T00:00:00.000Z')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, created_at) VALUES ('c-gone', 'rel-x', NULL, '2026-09-01T00:00:00.000Z')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, is_ai_conversation, created_at) VALUES ('c-ai', 'rel-ai', 'Café', 1, '2026-09-01T00:00:00.000Z')");
  const msg = (id: string, conv: string, sender: string, at: string, content: string, extra: { deleted?: boolean; attachment?: string } = {}) =>
    db.raw.run('INSERT INTO messages (id, conversation_id, sender_id, content, created_at, deleted_at, attachment) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, conv, sender, content, at, extra.deleted ? at : null, extra.attachment ?? null]);
  msg('h1', 'c-home', 'tutor', '2026-10-01T09:00:00.000Z', '作业');
  msg('h2', 'c-home', 'tutor', '2026-10-01T09:01:00.000Z', '', { attachment: JSON.stringify({ kind: 'voice', key: 'k', duration_ms: 3000 }) });
  msg('l1', 'c-li', 'student', '2026-10-02T08:00:00.000Z', '老师好');
  msg('l2', 'c-li', ME, '2026-10-02T08:05:00.000Z', '你好！');
  msg('a1', 'c-ai', 'claude-ai', '2026-09-30T08:00:00.000Z', '欢迎光临');
  msg('g1', 'c-gone', 'gone', '2026-10-03T08:00:00.000Z', 'bye');
  db.raw.run("INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES ('c-home', ?, '2026-10-01T09:00:00.000Z')", [ME]);
}

describe('GET /api/me/chats', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  async function list(userId: string): Promise<ChatListResponse> {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => {
      c.set('user', { id: userId } as never);
      await next();
    });
    app.route('/api', chatLive);
    const res = await app.request('/api/me/chats', { method: 'GET' }, { DB: db } as unknown as Env);
    expect(res.status).toBe(200);
    return res.json() as Promise<ChatListResponse>;
  }

  it('lists every conversation of active relationships, newest first, with previews and unread', async () => {
    const { conversations } = await list(ME);
    expect(conversations.map((c) => c.conversation_id)).toEqual(['c-li', 'c-home', 'c-ai', 'c-empty']);

    const li = conversations[0];
    expect(li).toMatchObject({
      relationship_id: 'rel-s', is_ai: false, other_role: 'student', unread: 1,
      other_user: { id: 'student', name: 'Li', picture_url: null },
      last_message: { id: 'l2', sender_id: ME, preview: '你好！', created_at: '2026-10-02T08:05:00.000Z' },
      last_activity_at: '2026-10-02T08:05:00.000Z',
    });

    const home = conversations[1];
    expect(home).toMatchObject({
      title: 'Homework', other_role: 'tutor', unread: 1,
      other_user: { id: 'tutor', name: 'Minghui', picture_url: '/api/audio/avatars/t.jpg' },
      last_message: { id: 'h2', preview: '🎤 Voice message' },
    });

    expect(conversations[3]).toMatchObject({ conversation_id: 'c-empty', last_message: null, unread: 0, last_activity_at: '2026-09-20T00:00:00.000Z' });
    expect(conversations[2]).toMatchObject({ conversation_id: 'c-ai', is_ai: true, title: 'Café', unread: 1 });
  });

  it('shows a deleted last message as such and is per user', async () => {
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at, deleted_at) VALUES ('h3', 'c-home', 'tutor', '', '2026-10-03T10:00:00.000Z', '2026-10-03T10:01:00.000Z')");
    const mine = await list(ME);
    expect(mine.conversations[0]).toMatchObject({ conversation_id: 'c-home', last_message: { preview: 'Message deleted' }, unread: 1 });

    const tutor = await list('tutor');
    expect(tutor.conversations.map((c) => c.conversation_id)).toEqual(['c-home', 'c-empty']);
    expect(tutor.conversations[0]).toMatchObject({ other_role: 'student', other_user: { id: ME }, unread: 0 });
  });
});
