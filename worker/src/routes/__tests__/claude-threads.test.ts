/**
 * `/api/claude/threads*` (routes/claude-threads.ts) against REAL SQLite with every migration, the model
 * being the E2E stand-in (E2E_TEST_MODE, streaming three chunks): create (idempotent by client id,
 * context checked against the caller, intents per context), the reply written inline, the list (the
 * first call copies the older chats in; badges; `since` with tombstones), a thread with `?since=`
 * (unread cleared), follow-ups (409 while a reply is pending, idempotent by client id), read-only
 * practice threads, the Coach's check intent on its own queue, PATCH and DELETE.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { ClaudeThreadMessage, ClaudeThreadSummary } from '@shared/claude/api';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import claudeThreads from '../claude-threads';
import { FAKE_FUN_FACT, FAKE_PRACTICE_CHUNKS, FAKE_STREAM_CHUNKS } from '../../services/claude-agent/fake';
import { LESSON_VOICE_IDS } from '@shared/lesson/voices';
import type { Env } from '../../types';
import { seedReaderAndLesson } from '../../services/claude-agent/__tests__/context-seed';

const U = 'u1';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role, is_admin) VALUES ('u1', 'j@x.test', 'Jerome', 'student', 0)");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('x1', 'x@x.test', 'Someone', 'student')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('dx', 'x1', 'Theirs')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('nx', 'dx', '学生', 'xuésheng', 'student')");
  db.raw.run("INSERT INTO note_questions (id, note_id, question, answer, asked_at) VALUES ('q1', 'n1', '行怎么读？', 'háng', '2026-10-01 10:00:00')");
}

type ThreadBody = { thread: ClaudeThreadSummary; messages: ClaudeThreadMessage[]; existing?: boolean; server_time?: string };

function world(db: SqliteD1) {
  const sent: unknown[] = [];
  const env = { DB: db, E2E_TEST_MODE: 'true', COACH_REPLY_QUEUE: { send: async (m: unknown) => void sent.push(m) } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: U } as never);
    await next();
  });
  app.route('/api', claudeThreads);
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as T };
  };
  return { env, sent, call };
}

describe('/api/claude/threads', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof world>;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    w = world(db);
  });

  it('creates a chat (idempotent by client id) and writes the reply; the list carries it with the copied card chats', async () => {
    const created = await w.call<ThreadBody>('POST', '/api/claude/threads', { client_id: 'c-1', message_client_id: 'm-1', context: { kind: 'general' }, text: '成都有什么好吃的？', language: 'zh' });
    expect(created.status).toBe(202);
    expect(created.body.messages.map((m) => [m.role, m.status, m.intent, m.client_id])).toEqual([['user', null, 'ask', 'm-1'], ['assistant', 'pending', null, null]]);
    expect(created.body.thread).toMatchObject({ client_id: 'c-1', context_kind: 'general', title: '成都有什么好吃的？', first_intent: 'ask', badge: null, language: 'zh' });
    // The watchdog went on the queue; the reply ran inline (no waitUntil in tests: awaited).
    expect(w.sent).toEqual([{ kind: 'claude_turn', messageId: created.body.messages[1].id }]);

    const again = await w.call<ThreadBody>('POST', '/api/claude/threads', { client_id: 'c-1', context: { kind: 'general' }, text: '成都有什么好吃的？' });
    expect(again.status).toBe(200);
    expect(again.body.existing).toBe(true);
    expect(again.body.messages[1]).toMatchObject({ status: null, streaming: false, content: FAKE_STREAM_CHUNKS.zh.join(''), answer_lang: 'zh' });

    const list = await w.call<{ threads: ClaudeThreadSummary[]; server_time: string }>('GET', '/api/claude/threads');
    expect(list.status).toBe(200);
    expect(list.body.threads.map((t) => [t.id === created.body.thread.id ? 'new' : t.id, t.context_kind, t.unread])).toEqual([
      ['new', 'general', 1],
      ['nq-q1', 'card', 0],
    ]);
    expect(list.body.threads[1].badge).toEqual({ icon: '📇', text: 'Asked on card · 银行' });

    // Opening it clears unread; `since` = only what changed.
    const opened = await w.call<ThreadBody>('GET', `/api/claude/threads/${created.body.thread.id}`);
    expect(opened.body.messages).toHaveLength(2);
    expect((await w.call<ThreadBody>('GET', `/api/claude/threads/${created.body.thread.id}`)).body.thread.unread).toBe(0);
    const since = await w.call<ThreadBody>('GET', `/api/claude/threads/${created.body.thread.id}?since=${encodeURIComponent(opened.body.server_time!)}`);
    expect(since.body.messages).toEqual([]);
    const changed = await w.call<{ threads: ClaudeThreadSummary[] }>('GET', `/api/claude/threads?since=${encodeURIComponent(list.body.server_time)}`);
    // `since` is inclusive (changed_at >= cursor), so a chat the first list call copied in during the cursor's own
    // millisecond comes again — harmless for a client, and timing-dependent on a slow runner. Everything else stays out.
    const copied = (await db.prepare("SELECT changed_at FROM coach_conversations WHERE id = 'nq-q1'").first<{ changed_at: string }>())!;
    const expected = [created.body.thread.id, ...(copied.changed_at >= list.body.server_time ? ['nq-q1'] : [])];
    expect(changed.body.threads.map((t) => t.id)).toEqual(expected);
  });

  it("reads a context with no kind as the general one (Lab v0.867–0.868 sent `context: {}`)", async () => {
    const res = await w.call<ThreadBody>('POST', '/api/claude/threads', { client_id: 'c-nokind', message_client_id: 'm-nokind', context: {}, intent: 'ask', text: '说不定是什么意思？' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.thread).toMatchObject({ client_id: 'c-nokind', context_kind: 'general' });
  });

  it("checks the context against the caller and the intents a context takes", async () => {
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'card', note_id: 'nx' }, text: '?' })).status).toBe(404);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'card', note_id: 'n1' }, intent: 'check', text: '我去银行' })).status).toBe(400);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'reader' }, text: '?' })).status).toBe(400);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'reader', reader_id: 'r' }, text: '?' })).status).toBe(404);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'practice', conversation_id: 'p' }, text: '?' })).status).toBe(400);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'general' }, intent: 'check', text: 'no Chinese here' })).status).toBe(400);
    const card = await w.call<ThreadBody>('POST', '/api/claude/threads', { context: { kind: 'card', note_id: 'n1' }, text: 'Why háng?', language: 'en' });
    expect(card.status).toBe(202);
    expect(card.body.thread).toMatchObject({ context_kind: 'card', context: { note_id: 'n1', label: '银行', sublabel: 'HSK 2' }, badge: { text: 'Asked on card · 银行' } });
    // The card turn also landed in note_questions (older apps' history).
    expect(db.rows("SELECT question FROM note_questions WHERE note_id = 'n1' ORDER BY asked_at")).toEqual([{ question: '行怎么读？' }, { question: 'Why háng?' }]);
  });

  it('a card thread: my Chinese question is checked (not a chip), the typed answer follows the card, the fun-fact tool edits the card', async () => {
    const created = await w.call<ThreadBody>('POST', '/api/claude/threads', { client_id: 'c-card', context: { kind: 'card', note_id: 'n1', typed: { answer: '很行', correct: '银行' } }, text: '银行是什么意？', language: 'zh' });
    expect(created.status).toBe(202);
    const mine = created.body.messages[0];
    // The check ran beside the reply (awaited in tests): improvable, on my message.
    const opened = await w.call<ThreadBody>('GET', `/api/claude/threads/${created.body.thread.id}`);
    expect(opened.body.messages[0].auto_check).toMatchObject({ text: '银行是什么意？', status: 'improvable', corrected: '银行是什么意思？' });
    expect(opened.body.messages[1].auto_check).toBeNull();
    expect(mine.id).toBe(opened.body.messages[0].id);
    expect(JSON.parse(db.rows<{ context_json: string }>('SELECT context_json FROM coach_conversations WHERE id = ?', [created.body.thread.id])[0].context_json).typed).toEqual({ answer: '很行', correct: '银行' });

    // A suggestion chip (quick) isn't checked; a later showing of the card without a typed answer clears it.
    const chip = await w.call<ThreadBody>('POST', `/api/claude/threads/${created.body.thread.id}/messages`, { client_id: 'chip-1', text: '请给这张卡片加一个有意思的小知识。', quick: true, typed: null });
    expect(chip.status).toBe(202);
    const after = await w.call<ThreadBody>('GET', `/api/claude/threads/${created.body.thread.id}`);
    const reply = after.body.messages[3];
    expect(after.body.messages[2].auto_check).toBeNull();
    expect(JSON.parse(db.rows<{ context_json: string }>('SELECT context_json FROM coach_conversations WHERE id = ?', [created.body.thread.id])[0].context_json).typed).toBeUndefined();
    // The stand-in's fun-fact tool: the card edited through the content service, the result on the reply.
    expect(reply).toMatchObject({ role: 'assistant', status: null, content: FAKE_STREAM_CHUNKS.zh.join('') });
    const results = JSON.parse(reply.tool_results!) as Array<{ tool: string; success: boolean; data: { note: { id: string; fun_facts: string } } }>;
    expect(results.map((r) => [r.tool, r.success])).toEqual([['edit_current_card', true]]);
    expect(results[0].data.note).toMatchObject({ id: 'n1', fun_facts: FAKE_FUN_FACT });
    expect(db.rows("SELECT fun_facts FROM notes WHERE id = 'n1'")).toEqual([{ fun_facts: FAKE_FUN_FACT }]);
  });

  it('a reader page / an exercise: checked against the caller, badged, the context kept up to date by follow-ups, listed by context_ref', async () => {
    seedReaderAndLesson(db, U, 'x1');
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'reader', reader_id: 'rdx' }, text: '?' })).status).toBe(403);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'reader', reader_id: 'rd1', page_id: 'nope' }, text: '?' })).status).toBe(404);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'exercise', lesson_id: 'lsx', exercise_key: 's0e0' }, text: '?' })).status).toBe(403);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's3e0' }, text: '?' })).status).toBe(404);

    const reader = await w.call<ThreadBody>('POST', '/api/claude/threads', {
      client_id: 'rd-1',
      context: { kind: 'reader', reader_id: 'rd1', page_id: 'pg2', page: 2, looked_up: ['熊猫'] },
      text: '这一页讲的是什么？请一句一句地说一说。',
      language: 'zh',
      quick: true,
    });
    expect(reader.status).toBe(202);
    expect(reader.body.thread).toMatchObject({ context_kind: 'reader', context: { reader_id: 'rd1', page_id: 'pg2', page: 2, label: '成都', looked_up: ['熊猫'] }, badge: { icon: '📖', text: 'Reader · 成都 p.2' } });
    const opened = await w.call<ThreadBody>('GET', `/api/claude/threads/${reader.body.thread.id}`);
    expect(opened.body.messages[1]).toMatchObject({ status: null, content: FAKE_STREAM_CHUNKS.zh.join('') });
    // A follow-up brings the page's words up to date.
    await w.call('POST', `/api/claude/threads/${reader.body.thread.id}/messages`, { text: '可爱是什么意思？', looked_up: ['熊猫', '可爱'], said_wrong: ['火锅'] });
    const ctx = JSON.parse(db.rows<{ context_json: string }>('SELECT context_json FROM coach_conversations WHERE id = ?', [reader.body.thread.id])[0].context_json);
    expect(ctx).toMatchObject({ looked_up: ['熊猫', '可爱'], said_wrong: ['火锅'], label: '成都' });

    const ex = await w.call<ThreadBody>('POST', '/api/claude/threads', {
      context: { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1', exercise_type: 'choice', answer: { text: '我放书在桌子上。', verdict: 'almost' } },
      text: 'Why is my answer wrong?',
      language: 'en',
    });
    expect(ex.status).toBe(202);
    // The stored spec's type wins over what the app sent.
    expect(ex.body.thread).toMatchObject({ context_kind: 'exercise', context: { exercise_type: 'translate', label: 'Translate', sublabel: '把字句' }, badge: { icon: '🧩', text: 'Exercise · Translate' } });
    await w.call('POST', `/api/claude/threads/${ex.body.thread.id}/messages`, { text: 'And now?', answer: null });
    expect(JSON.parse(db.rows<{ context_json: string }>('SELECT context_json FROM coach_conversations WHERE id = ?', [ex.body.thread.id])[0].context_json).answer).toBeUndefined();

    const listed = await w.call<{ threads: ClaudeThreadSummary[] }>('GET', '/api/claude/threads?context_kind=reader&context_ref=rd1:pg2');
    expect(listed.body.threads.map((t) => t.id)).toEqual([reader.body.thread.id]);
    expect((await w.call<{ threads: ClaudeThreadSummary[] }>('GET', '/api/claude/threads?context_kind=reader&context_ref=rd1:pg3')).body.threads).toEqual([]);
    expect((await w.call<{ threads: ClaudeThreadSummary[] }>('GET', '/api/claude/threads?context_kind=exercise')).body.threads.map((t) => t.id)).toEqual([ex.body.thread.id]);
  });

  it("✏️ Check starts a Coach chat: its structured reply goes on the Coach's queue, not the stream", async () => {
    const res = await w.call<ThreadBody>('POST', '/api/claude/threads', { context: { kind: 'general' }, intent: 'check', text: '我昨天去了商店买东西了' });
    expect(res.status).toBe(202);
    expect(res.body.messages[1]).toMatchObject({ content_type: 'analysis', status: 'pending' });
    expect(res.body.thread).toMatchObject({ first_intent: 'check', badge: { icon: '✏️', text: 'Check' } });
    expect(w.sent).toEqual([{ messageId: res.body.messages[1].id }]);
    // Older apps see it on the Coach page as a check.
    expect(db.rows('SELECT action, kind FROM coach_conversations WHERE id = ?', [res.body.thread.id])).toEqual([{ action: 'check', kind: null }]);
  });

  it('follow-ups: 409 while a reply is pending, idempotent by client id, refused on read-only chats', async () => {
    const t = (await w.call<ThreadBody>('POST', '/api/claude/threads', { context: { kind: 'general' }, text: '你好', language: 'zh' })).body.thread;
    const next = await w.call<ThreadBody>('POST', `/api/claude/threads/${t.id}/messages`, { client_id: 'f-1', text: '再说一遍' });
    expect(next.status).toBe(202);
    const same = await w.call<ThreadBody>('POST', `/api/claude/threads/${t.id}/messages`, { client_id: 'f-1', text: '再说一遍' });
    expect(same.status).toBe(200);
    expect(same.body.messages.map((m) => m.id)).toEqual(next.body.messages.map((m) => m.id));
    expect((await w.call('POST', `/api/claude/threads/${t.id}/messages`, { text: 'x', intent: 'check' })).status).toBe(400);

    db.raw.run("INSERT INTO coach_messages (id, conversation_id, role, content_type, content, status) VALUES ('p1', ?, 'assistant', 'text', '', 'pending')", [t.id]);
    expect((await w.call('POST', `/api/claude/threads/${t.id}/messages`, { text: '还有吗？' })).status).toBe(409);

    db.raw.run("UPDATE coach_conversations SET read_only = 1 WHERE id = ?", [t.id]);
    expect((await w.call('POST', `/api/claude/threads/${t.id}/messages`, { text: '还有吗？' })).status).toBe(409);
    expect((await w.call('POST', '/api/claude/threads/nope/messages', { text: '还有吗？' })).status).toBe(404);
  });

  it('retry re-runs a failed reply; PATCH renames / archives; DELETE leaves a tombstone the next list reports', async () => {
    const t = (await w.call<ThreadBody>('POST', '/api/claude/threads', { context: { kind: 'general' }, text: '你好' })).body;
    const replyId = t.messages[1].id;
    db.raw.run("UPDATE coach_messages SET status = 'failed', error = 'x', content = '' WHERE id = ?", [replyId]);
    const retried = await w.call<ThreadBody>('POST', `/api/claude/threads/${t.thread.id}/messages/${replyId}/retry`);
    expect(retried.status).toBe(202);
    expect(retried.body.messages[1]).toMatchObject({ status: null, content: FAKE_STREAM_CHUNKS.zh.join('') });
    expect((await w.call('POST', `/api/claude/threads/${t.thread.id}/messages/${replyId}/retry`)).status).toBe(409);

    const patched = await w.call<{ thread: ClaudeThreadSummary }>('PATCH', `/api/claude/threads/${t.thread.id}`, { title: '打招呼', archived: true, tutor_visible: false });
    expect(patched.body.thread).toMatchObject({ title: '打招呼', archived: true, tutor_visible: false });
    expect((await w.call('PATCH', `/api/claude/threads/${t.thread.id}`, { archived: 'yes' })).status).toBe(400);
    const listed = await w.call<{ threads: ClaudeThreadSummary[]; server_time: string }>('GET', '/api/claude/threads');
    expect(listed.body.threads.map((x) => x.id)).not.toContain(t.thread.id);
    expect((await w.call<{ threads: ClaudeThreadSummary[] }>('GET', '/api/claude/threads?archived=1')).body.threads.map((x) => x.id)).toEqual([t.thread.id]);

    expect((await w.call('DELETE', `/api/claude/threads/${t.thread.id}`)).status).toBe(200);
    expect((await w.call('GET', `/api/claude/threads/${t.thread.id}`)).status).toBe(404);
    const after = await w.call<{ deleted_ids: string[] }>('GET', `/api/claude/threads?since=${encodeURIComponent(listed.body.server_time)}`);
    expect(after.body.deleted_ids).toEqual([t.thread.id]);
    expect(db.rows('SELECT COUNT(*) AS n FROM coach_messages WHERE conversation_id = ?', [t.thread.id])).toEqual([{ n: 0 }]);
  });

  it('a role-play: started with no message, Claude speaks first (streamed), the persona voice kept; help is answered in his language', async () => {
    const res = await w.call<ThreadBody>('POST', '/api/claude/threads', {
      client_id: 'p-1',
      context: { kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)', user_role: '客人', level: 'beginner' },
      text: '',
    });
    expect(res.status).toBe(202);
    expect(res.body.messages.map((m) => [m.role, m.status])).toEqual([['assistant', 'pending']]);
    expect(res.body.thread).toMatchObject({
      context_kind: 'practice',
      title: 'Practice: 在饭店点菜',
      badge: { icon: '🎭', text: 'Practice · 在饭店点菜' },
      read_only: false,
      source: 'practice',
      context: { kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)', level: 'beginner', label: '在饭店点菜', sublabel: '服务员 (a waiter)' },
    });
    expect(LESSON_VOICE_IDS.has((res.body.thread.context as { voice_id?: string }).voice_id ?? '')).toBe(true);
    const id = res.body.thread.id;
    const opened = await w.call<ThreadBody>('GET', `/api/claude/threads/${id}`);
    expect(opened.body.messages).toEqual([expect.objectContaining({ role: 'assistant', status: null, content: FAKE_PRACTICE_CHUNKS.join(''), answer_lang: 'zh' })]);

    // His line → a Chinese reply; a hint (his Ask language English) → an English one.
    const line = await w.call<ThreadBody>('POST', `/api/claude/threads/${id}/messages`, { text: '两位，谢谢。' });
    expect(line.status).toBe(202);
    expect(line.body.messages[1]).toMatchObject({ answer_lang: 'zh' });
    const hint = await w.call<ThreadBody>('POST', `/api/claude/threads/${id}/messages`, { text: '💡 Give me a hint: what could I say next?', language: 'en' });
    expect(hint.body.messages[1]).toMatchObject({ answer_lang: 'en' });
    const after = await w.call<ThreadBody>('GET', `/api/claude/threads/${id}`);
    expect(after.body.messages.at(-1)).toMatchObject({ status: null, content: FAKE_STREAM_CHUNKS.en.join('') });

    // Idempotent by client id; a card's role-play is checked against the caller; an old chat can't be restarted.
    expect((await w.call<ThreadBody>('POST', '/api/claude/threads', { client_id: 'p-1', context: { kind: 'practice', scenario: '在饭店点菜' } })).body.existing).toBe(true);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'practice', note_id: 'nx' } })).status).toBe(404);
    const card = await w.call<ThreadBody>('POST', '/api/claude/threads', { context: { kind: 'practice', note_id: 'n1', scenario: '用「银行」聊天' } });
    expect(card.body.thread.context).toMatchObject({ note_id: 'n1', label: '银行' });
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'practice' } })).status).toBe(400);
    expect((await w.call('POST', '/api/claude/threads', { context: { kind: 'general' }, text: '' })).status).toBe(400);
  });

  it('the admin backfill is admin only', async () => {
    expect((await w.call('POST', '/api/admin/claude-threads/backfill', {})).status).toBe(403);
  });
});
