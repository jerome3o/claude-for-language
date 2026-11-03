/**
 * What a tutor can read of her student's Claude chats (routes/claude-tutor-view.ts,
 * services/claude-agent/tutor-view.ts, shared/claude/visibility.ts) against REAL SQLite with every
 * migration: tutor-only access (403 / 404), the default (card questions only), the account's choice,
 * one chat's own choice, read-only + trimmed messages, a private chat answered 404, the older
 * `/claude-chats` + card hub following the same rule, "Asked Claude today", and the tutor's private
 * student profile never in any of it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { TutorClaudeThreadResponse, TutorClaudeThreadsResponse } from '@shared/claude/api';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import claudeTutorView from '../claude-tutor-view';
import claudeThreads from '../claude-threads';
import claudeChats from '../claude-chats';
import { insertMessageStatement, insertThreadStatement } from '../../services/claude-agent/store';
import { tutorThreadsActiveSince } from '../../services/claude-agent/tutor-view';
import { migratedPracticeChatIds } from '../../services/conversations';
import type { Env } from '../../types';

const STUDENT = 'u1';
const TUTOR = 't1';
const PROFILE = 'PRIVATE-PROFILE: shy, hates handwriting';

async function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'j@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('t1', 'm@x.test', 'Minghui', 'tutor')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('x1', 'x@x.test', 'Someone', 'tutor')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', 'u1', 't1', 'student', 'active')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', 'u1', 'x1', 'student', 'pending')");
  db.raw.run(`INSERT INTO student_profiles (relationship_id, tutor_id, student_id, body) VALUES ('rel-1', 't1', 'u1', '${PROFILE}')`);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  // An old Ask Claude Q&A: copied into a card thread (nq-q1) by the backfill.
  db.raw.run("INSERT INTO note_questions (id, note_id, question, answer, asked_at) VALUES ('q1', 'n1', '行怎么读？', '这里读 háng。', '2026-10-01 10:00:00')");
  const threads: Array<[string, Parameters<typeof insertThreadStatement>[1]['context'], string]> = [
    ['th-practice', { kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员', voice_id: 'Chinese (Mandarin)_Radio_Host' }, '我要一碗米饭。'],
    ['th-general', { kind: 'general' }, '成都有什么好吃的？'],
    ['th-reader', { kind: 'reader', reader_id: 'r1', page_id: 'p1', page: 3, looked_up: ['巴黎'] }, '这句话是什么意思？'],
  ];
  const statements = [];
  for (const [id, context, text] of threads) {
    statements.push(insertThreadStatement(db, { id, userId: STUDENT, context, title: text, source: 'app', snapshot: { label: id === 'th-reader' ? '小明在巴黎' : undefined } }));
    statements.push(insertMessageStatement(db, { id: `${id}-u`, threadId: id, role: 'user', content: text, intent: 'ask', autoCheck: '{"text":"x","status":"improvable"}', clientId: `c-${id}` }));
    statements.push(insertMessageStatement(db, { id: `${id}-a`, threadId: id, role: 'assistant', content: '好问题！', answerLang: 'zh' }));
  }
  // A reply still being written is never shown.
  statements.push(insertMessageStatement(db, { id: 'th-general-p', threadId: 'th-general', role: 'assistant', content: '写到一半', status: 'pending' }));
  await db.batch(statements);
}

function world(db: SqliteD1) {
  let as = TUTOR;
  const env = { DB: db, E2E_TEST_MODE: 'true', COACH_REPLY_QUEUE: { send: async () => {} } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: as } as never);
    await next();
  });
  app.route('/api', claudeThreads);
  app.route('/api', claudeTutorView);
  app.route('/api', claudeChats);
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) as T, text };
  };
  return { call, setUser: (id: string) => (as = id) };
}

describe('the tutor’s view of her student’s Claude chats', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof world>;
  beforeEach(async () => {
    db = await createSqliteD1();
    await seed(db);
    w = world(db);
  });

  it('only the tutor of an active relationship: 403 for the student, 404 for a pending one / a stranger', async () => {
    w.setUser(STUDENT);
    expect((await w.call('GET', '/api/relationships/rel-1/claude-threads')).status).toBe(403);
    expect((await w.call('GET', '/api/relationships/rel-1/claude-threads/nq-q1')).status).toBe(403);
    expect((await w.call('GET', '/api/relationships/rel-1/claude-chats')).status).toBe(403);
    w.setUser('x1');
    expect((await w.call('GET', '/api/relationships/rel-2/claude-threads')).status).toBe(404);
    expect((await w.call('GET', '/api/relationships/rel-1/claude-threads')).status).toBe(404);
    expect((await w.call('GET', '/api/relationships/nope/claude-threads')).status).toBe(404);
  });

  it('by default: card questions only (copied in for a student still on an older app), read-only and trimmed', async () => {
    const list = await w.call<TutorClaudeThreadsResponse>('GET', '/api/relationships/rel-1/claude-threads');
    expect(list.status).toBe(200);
    expect(list.body.visibility).toBe('card_only');
    expect(list.body.total).toBe(1);
    expect(list.body.threads.map((t) => [t.id, t.context_kind, t.badge?.text, t.message_count, t.shared])).toEqual([['nq-q1', 'card', 'Asked on card · 银行', 2, false]]);
    expect(list.body.threads[0].context).toEqual({ kind: 'card', note_id: 'n1', label: '银行', sublabel: 'HSK 2' });

    const one = await w.call<TutorClaudeThreadResponse>('GET', '/api/relationships/rel-1/claude-threads/nq-q1');
    expect(one.status).toBe(200);
    expect(one.body.messages.map((m) => [m.role, m.content])).toEqual([['user', '行怎么读？'], ['assistant', '这里读 háng。']]);
    // Nothing of the learner's own: no client ids, check of his Chinese, status, leases, meta.
    expect(Object.keys(one.body.messages[0]).sort()).toEqual(['answer_lang', 'content', 'content_type', 'created_at', 'id', 'role', 'tool_results', 'translation']);

    // Private chats: answered exactly like a chat that doesn't exist.
    for (const id of ['th-practice', 'th-general', 'th-reader', 'nope']) {
      expect((await w.call('GET', `/api/relationships/rel-1/claude-threads/${id}`)).status).toBe(404);
    }
  });

  it('the student shares one chat and hides another; the account’s choice moves the default', async () => {
    w.setUser(STUDENT);
    await w.call('GET', '/api/claude/threads'); // his app copies the older chats in
    expect((await w.call('PATCH', '/api/claude/threads/th-practice', { tutor_visible: true })).status).toBe(200);
    expect((await w.call('PATCH', '/api/claude/threads/nq-q1', { tutor_visible: false })).status).toBe(200);
    w.setUser(TUTOR);
    let list = await w.call<TutorClaudeThreadsResponse>('GET', '/api/relationships/rel-1/claude-threads');
    expect(list.body.threads.map((t) => [t.id, t.shared])).toEqual([['th-practice', true]]);
    // The practice chip without the persona's voice.
    expect(list.body.threads[0].context).toEqual({ kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员' });
    const practice = await w.call<TutorClaudeThreadResponse>('GET', '/api/relationships/rel-1/claude-threads/th-practice');
    expect(practice.body.messages.map((m) => m.content)).toEqual(['我要一碗米饭。', '好问题！']);
    // The hidden card chat is gone from the older endpoint and the card hub too.
    expect((await w.call<{ questions: unknown[] }>('GET', '/api/relationships/rel-1/claude-chats')).body.questions).toEqual([]);
    expect((await w.call<{ questions: unknown[] }>('GET', '/api/relationships/rel-1/notes/n1/hub')).body.questions).toEqual([]);

    // "All": every chat but the hidden one; the reply being written is never counted.
    w.setUser(STUDENT);
    expect((await w.call('PUT', '/api/profile/claude-tutor-visibility', { claude_tutor_visibility: 'everything' })).status).toBe(400);
    expect((await w.call<{ claude_tutor_visibility: string }>('PUT', '/api/profile/claude-tutor-visibility', { claude_tutor_visibility: 'all' })).body).toEqual({ claude_tutor_visibility: 'all' });
    w.setUser(TUTOR);
    list = await w.call<TutorClaudeThreadsResponse>('GET', '/api/relationships/rel-1/claude-threads');
    expect(list.body.visibility).toBe('all');
    expect(list.body.threads.map((t) => t.id).sort()).toEqual(['th-general', 'th-practice', 'th-reader']);
    const general = await w.call<TutorClaudeThreadResponse>('GET', '/api/relationships/rel-1/claude-threads/th-general');
    expect(general.body.messages.map((m) => m.content)).toEqual(['成都有什么好吃的？', '好问题！']);
    expect(list.body.threads.find((t) => t.id === 'th-reader')?.context).toEqual({ kind: 'reader', reader_id: 'r1', page: 3, label: '小明在巴黎' });

    // "None": only what he shared himself.
    w.setUser(STUDENT);
    await w.call('PUT', '/api/profile/claude-tutor-visibility', { claude_tutor_visibility: 'none' });
    w.setUser(TUTOR);
    list = await w.call<TutorClaudeThreadsResponse>('GET', '/api/relationships/rel-1/claude-threads');
    expect(list.body.threads.map((t) => t.id)).toEqual(['th-practice']);
    // Back to the default (null): card questions — the hidden one stays hidden.
    w.setUser(STUDENT);
    await w.call('PATCH', '/api/claude/threads/nq-q1', { tutor_visible: null });
    expect((await w.call<{ claude_tutor_visibility: string }>('PUT', '/api/profile/claude-tutor-visibility', { claude_tutor_visibility: null })).body.claude_tutor_visibility).toBe('card_only');
    w.setUser(TUTOR);
    list = await w.call<TutorClaudeThreadsResponse>('GET', '/api/relationships/rel-1/claude-threads');
    expect(list.body.threads.map((t) => t.id).sort()).toEqual(['nq-q1', 'th-practice']);
  });

  it('the older /claude-chats and the card hub read the visible card threads in the old row shape', async () => {
    const chats = await w.call<{ questions: Array<Record<string, unknown>>; total: number; next_cursor: string | null }>('GET', '/api/relationships/rel-1/claude-chats');
    expect(chats.status).toBe(200);
    expect(chats.body.questions).toEqual([
      { id: 'q1', note_id: 'n1', question: '行怎么读？', answer: '这里读 háng。', asked_at: '2026-10-01T10:00:00Z', hanzi: '银行', pinyin: 'yínháng', english: 'bank', deck_id: 'd1', deck_name: 'HSK 2' },
    ]);
    expect(chats.body.total).toBe(1);
    const hub = await w.call<{ questions: Array<{ id: string }> }>('GET', '/api/relationships/rel-1/notes/n1/hub');
    expect(hub.body.questions.map((q) => q.id)).toEqual(['q1']);
  });

  it('"Asked Claude today": visible chats he wrote in since the start of his day', async () => {
    await w.call('GET', '/api/relationships/rel-1/claude-threads'); // copies the older chats in
    expect(await tutorThreadsActiveSince(db, STUDENT, '2000-01-01T00:00:00.000Z')).toBe(1);
    db.raw.run("UPDATE users SET claude_tutor_visibility = 'all' WHERE id = 'u1'");
    expect(await tutorThreadsActiveSince(db, STUDENT, '2000-01-01T00:00:00.000Z')).toBe(4);
    expect(await tutorThreadsActiveSince(db, STUDENT, '2999-01-01T00:00:00.000Z')).toBe(0);
  });

  it('never shows the tutor’s private student profile', async () => {
    db.raw.run("UPDATE users SET claude_tutor_visibility = 'all' WHERE id = 'u1'");
    const bodies = [
      (await w.call('GET', '/api/relationships/rel-1/claude-threads')).text,
      (await w.call('GET', '/api/relationships/rel-1/claude-threads/nq-q1')).text,
      (await w.call('GET', '/api/relationships/rel-1/claude-threads/th-general')).text,
      (await w.call('GET', '/api/relationships/rel-1/claude-chats')).text,
    ];
    w.setUser(STUDENT);
    bodies.push((await w.call('GET', '/api/claude/threads')).text, (await w.call('GET', '/api/claude/threads/th-general')).text);
    for (const b of bodies) expect(b).not.toContain('PRIVATE-PROFILE');
  });

  it('practice chats copied into the threads are found for ?exclude_ai=1 (the MCP chat tools)', async () => {
    await db.batch([insertThreadStatement(db, { id: 'pc-conv-ai', userId: STUDENT, context: { kind: 'practice', conversation_id: 'conv-ai' }, title: '点菜', source: 'practice', readOnly: true })]);
    expect([...(await migratedPracticeChatIds(db, STUDENT, ['conv-ai', 'conv-human', 'conv-ai']))]).toEqual(['conv-ai']);
    expect([...(await migratedPracticeChatIds(db, TUTOR, ['conv-ai']))]).toEqual([]);
    expect([...(await migratedPracticeChatIds(db, STUDENT, []))]).toEqual([]);
  });
});
