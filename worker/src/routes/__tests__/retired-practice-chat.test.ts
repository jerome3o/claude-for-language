/**
 * The old Claude practice chat retired (routes/retired-practice-chat.ts, docs/CHAT.md "Practice with
 * Claude" → "Old practice chats"): its endpoints answer 410 Gone with `{ error, moved_to_thread }` for
 * older app builds, and the chat's Claude thread `pc-<id>` is copied on demand when its link is opened
 * before the lazy backfill reached it (GET /api/claude/threads/:id). Real SQLite with every migration.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { ClaudeThreadMessage, ClaudeThreadSummary } from '@shared/claude/api';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import retired, { DEFINE_GONE, PRACTICE_CHAT_GONE } from '../retired-practice-chat';
import claudeThreads from '../claude-threads';
import { backfillClaudeThreads, ensureLegacyPracticeThread } from '../../services/claude-agent/backfill';
import type { Env } from '../../types';

const ME = 'me';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('me', 'me@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('tutor', 't@x.test', 'Minghui', 'tutor')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('other', 'o@x.test', 'Li', 'student')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', 'me', 'claude-ai', 'student', 'active')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-t', 'tutor', 'me', 'tutor', 'active')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-o', 'other', 'claude-ai', 'student', 'active')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, scenario, ai_role, is_ai_conversation, created_at) VALUES ('c-ai', 'rel-ai', 'Café', '在咖啡馆点咖啡', '服务员', 1, '2026-09-01T00:00:00.000Z')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, created_at) VALUES ('c-home', 'rel-t', '2026-09-01T00:00:00.000Z')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, is_ai_conversation, created_at) VALUES ('c-theirs', 'rel-o', 1, '2026-09-01T00:00:00.000Z')");
  msg('a1', 'c-ai', 'claude-ai', '2026-09-30T08:00:00.000Z', '欢迎光临！您想喝点什么？');
  msg('a2', 'c-ai', ME, '2026-09-30T08:01:00.000Z', '我要一杯拿铁。');
  msg('h1', 'c-home', 'tutor', '2026-10-01T09:00:00.000Z', '作业');
  function msg(id: string, conv: string, sender: string, at: string, content: string) {
    db.raw.run('INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [id, conv, sender, content, at]);
  }
}

type ThreadBody = { thread: ClaudeThreadSummary; messages: ClaudeThreadMessage[] };

function world(db: SqliteD1, userId = ME) {
  const env = { DB: db, E2E_TEST_MODE: 'true' } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', retired);
  app.route('/api', claudeThreads);
  return async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as T };
  };
}

describe('the old Claude practice chat, retired', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('ai-respond / ai-initiate answer 410 with the thread the chat moved to (copied first)', async () => {
    const call = world(db);
    for (const path of ['/api/conversations/c-ai/ai-respond', '/api/conversations/c-ai/ai-initiate']) {
      const res = await call<{ error: string; moved_to_thread: string | null }>('POST', path, {});
      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: PRACTICE_CHAT_GONE, moved_to_thread: 'pc-c-ai' });
    }
    const thread = await db.prepare("SELECT context_kind, read_only FROM coach_conversations WHERE id = 'pc-c-ai' AND user_id = 'me'").first<{ context_kind: string; read_only: number }>();
    expect(thread).toEqual({ context_kind: 'practice', read_only: 1 });
  });

  it('an old build that still wrote into the chat after the copy: its message joins the thread on the 410', async () => {
    await backfillClaudeThreads(db, ME);
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('a3', 'c-ai', 'me', '多少钱？', '2026-11-17T08:00:00.000Z')");
    const call = world(db);
    expect((await call('POST', '/api/conversations/c-ai/ai-respond', {})).status).toBe(410);
    const rows = await db.prepare("SELECT content FROM coach_messages WHERE conversation_id = 'pc-c-ai' ORDER BY created_at").all<{ content: string }>();
    expect(rows.results.map((r) => r.content)).toEqual(['欢迎光临！您想喝点什么？', '我要一杯拿铁。', '多少钱？']);
  });

  it('a chat that is not my practice chat: 410 with no thread', async () => {
    const call = world(db);
    for (const id of ['c-home', 'c-theirs', 'nope']) {
      const res = await call<{ moved_to_thread: string | null }>('POST', `/api/conversations/${id}/ai-respond`, {});
      expect(res.status).toBe(410);
      expect(res.body.moved_to_thread).toBeNull();
    }
    expect((await db.prepare("SELECT COUNT(*) AS n FROM coach_conversations WHERE id IN ('pc-c-home', 'pc-c-theirs')").first<{ n: number }>())!.n).toBe(0);
  });

  it('the old word look-up answers 410', async () => {
    const call = world(db);
    for (const path of ['/api/vocabulary/define', '/api/vocabulary/populate']) {
      const res = await call<{ error: string; moved_to_thread: null }>('POST', path, { hanzi: '咖啡' });
      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: DEFINE_GONE, moved_to_thread: null });
    }
  });

  it('GET /api/claude/threads/pc-<id> copies the chat on demand (link opened before the backfill)', async () => {
    const call = world(db);
    const res = await call<ThreadBody>('GET', '/api/claude/threads/pc-c-ai');
    expect(res.status).toBe(200);
    expect(res.body.thread).toMatchObject({ id: 'pc-c-ai', context_kind: 'practice', read_only: true, title: 'Café' });
    expect(res.body.messages.map((m) => [m.role, m.content])).toEqual([
      ['assistant', '欢迎光临！您想喝点什么？'],
      ['user', '我要一杯拿铁。'],
    ]);
    // Not mine / not a practice chat / unknown: 404, nothing copied.
    for (const id of ['pc-c-theirs', 'pc-c-home', 'pc-nope']) expect((await call('GET', `/api/claude/threads/${id}`)).status).toBe(404);
    expect((await world(db, 'other')('GET', '/api/claude/threads/pc-c-ai')).status).toBe(404);
  });

  it('a practice chat whose thread the learner deleted stays deleted', async () => {
    expect(await ensureLegacyPracticeThread(db, ME, 'c-ai')).toBe('pc-c-ai');
    db.raw.run("UPDATE coach_conversations SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = 'pc-c-ai'");
    expect(await ensureLegacyPracticeThread(db, ME, 'c-ai')).toBeNull();
    expect((await world(db)('GET', '/api/claude/threads/pc-c-ai')).status).toBe(404);
  });
});
