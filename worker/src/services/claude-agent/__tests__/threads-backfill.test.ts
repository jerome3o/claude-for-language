/**
 * Claude threads — the lazy, idempotent backfill (claude-agent/backfill.ts) and the dual-writes, against
 * REAL SQLite with every migration and foreign keys on: note_questions → card threads grouped like the
 * apps showed them (one note, ≤ 30 min apart), Claude practice chats → read-only practice threads,
 * Discuss with Claude → chat_message threads; a re-run never duplicates, a deleted thread never comes
 * back, a half-copied group joins its thread; Ask's dual-write follows the same 30-minute rule.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import { appendCardQuestion, backfillClaudeThreads, ensureClaudeThreadsBackfilled, syncDiscussionThread } from '../backfill';
import { deleteThread, getThreadMessages, listThreads } from '../store';
import { getCoachConversations } from '../../../db/queries';

const U = 'u1';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'j@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('t1', 'm@x.test', 'Minghui', 'tutor')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n2', 'd1', '休息', 'xiūxi', 'rest')");
  // 银行: two questions 10 min apart (one thread), then one a day later (another); 休息: one.
  const q = (id: string, note: string, question: string, at: string, lang: string | null = 'zh') =>
    db.raw.run('INSERT INTO note_questions (id, note_id, question, answer, asked_at, answer_lang, question_check) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id, note, question, `答：${question}`, at, lang, id === 'q1' ? '{"status":"ok"}' : null,
    ]);
  q('q1', 'n1', '银行的行怎么读？', '2026-10-01 10:00:00');
  q('q2', 'n1', '为什么不读 xíng？', '2026-10-01 10:10:00');
  q('q3', 'n1', 'Another day', '2026-10-02 09:00:00', 'en');
  q('q4', 'n2', '休息和睡觉一样吗？', '2026-10-01 10:05:00');
  // A Claude practice chat (and a human chat that must stay out).
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r-ai', 'u1', 'claude-ai', 'student', 'active')");
  db.raw.run("INSERT INTO conversations (id, relationship_id, title, scenario, ai_role, user_role, is_ai_conversation) VALUES ('pc1', 'r-ai', '在饭馆', '点菜', '服务员', '客人', 1)");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('pm1', 'pc1', 'claude-ai', '您好，想吃点什么？', '2026-10-03 08:00:00')");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('pm2', 'pc1', 'u1', '我要一碗面。', '2026-10-03 08:01:00')");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at, deleted_at) VALUES ('pm3', 'pc1', 'u1', '', '2026-10-03 08:02:00', '2026-10-03 08:03:00')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r1', 't1', 'u1', 'tutor', 'active')");
  db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('cv1', 'r1')");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('m1', 'cv1', 't1', '你去过银行吗？', '2026-10-04 08:00:00')");
  // Discuss with Claude on m1.
  db.raw.run(
    "INSERT INTO message_discussions (id, message_id, user_id, messages_json, created_at) VALUES ('md1', 'm1', 'u1', ?, '2026-10-04 09:00:00')",
    [JSON.stringify([{ role: 'user', content: '去过是什么意思？' }, { role: 'assistant', content: '过 = have done before.' }])],
  );
  // A Coach chat from before.
  db.raw.run("INSERT INTO coach_conversations (id, user_id, title, action, context_kind, source) VALUES ('co1', 'u1', '我昨天去了商店', 'check', 'general', 'coach')");
}

const threadIds = (db: SqliteD1) => db.rows<{ id: string }>('SELECT id FROM coach_conversations WHERE user_id = ? ORDER BY id', [U]).map((r) => r.id);
const count = (db: SqliteD1, sql: string) => Number(Object.values(db.rows(sql)[0])[0]);

describe('Claude threads backfill', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('copies Ask Claude, practice and Discuss chats into threads, grouped like the apps showed them', async () => {
    const counts = await backfillClaudeThreads(db, U);
    expect(counts).toEqual({ card_threads: 3, card_messages: 8, practice_threads: 1, practice_messages: 2, discussion_threads: 1, discussion_messages: 2 });
    expect(threadIds(db)).toEqual(['co1', 'md-md1', 'nq-q1', 'nq-q3', 'nq-q4', 'pc-pc1']);

    const q1 = await getThreadMessages(db, 'nq-q1');
    expect(q1.map((m) => [m.role, m.content, m.legacy_id, m.intent])).toEqual([
      ['user', '银行的行怎么读？', 'q1', 'ask'],
      ['assistant', '答：银行的行怎么读？', 'q1', null],
      ['user', '为什么不读 xíng？', 'q2', 'ask'],
      ['assistant', '答：为什么不读 xíng？', 'q2', null],
    ]);
    expect(q1[0].auto_check).toBe('{"status":"ok"}');
    expect(q1[1].answer_lang).toBe('zh');
    expect((await getThreadMessages(db, 'pc-pc1')).map((m) => [m.role, m.content])).toEqual([
      ['assistant', '您好，想吃点什么？'],
      ['user', '我要一碗面。'],
    ]);

    const { threads } = await listThreads(db, U);
    const byId = Object.fromEntries(threads.map((t) => [t.id, t]));
    expect(byId['nq-q1']).toMatchObject({
      context_kind: 'card',
      context: { kind: 'card', note_id: 'n1', label: '银行', sublabel: 'HSK 2' },
      badge: { icon: '📇', text: 'Asked on card · 银行' },
      title: '银行的行怎么读？',
      preview: '答：为什么不读 xíng？',
      last_message_at: '2026-10-01T10:10:00.000Z',
      source: 'note_questions',
      read_only: false,
    });
    expect(byId['pc-pc1']).toMatchObject({ context_kind: 'practice', read_only: true, title: '在饭馆', badge: { text: 'Practice · 点菜' } });
    expect(byId['md-md1']).toMatchObject({ context_kind: 'chat_message', context: { message_id: 'm1', conversation_id: 'cv1', label: '你去过银行吗？' } });
    expect(byId.co1).toMatchObject({ context_kind: 'general', first_intent: 'check', badge: { text: 'Check' } });
    // Newest activity first.
    expect(threads[0].id).toBe('md-md1');
    // No other person's id is stored on the learner's threads (account deletion leaves nothing behind).
    expect(JSON.stringify(db.rows('SELECT context_json FROM coach_conversations'))).not.toContain('t1');
    // The Coach page still lists only its own chats.
    expect((await getCoachConversations(db, U)).map((c) => c.id)).toEqual(['co1']);
  });

  it('runs once per user, and a re-run never duplicates or brings back a deleted thread', async () => {
    expect(await ensureClaudeThreadsBackfilled(db, U)).toBe(true);
    expect(await ensureClaudeThreadsBackfilled(db, U)).toBe(false);
    const messages = count(db, 'SELECT COUNT(*) FROM coach_messages');
    expect(await deleteThread(db, U, 'nq-q3')).toBe(true);
    await backfillClaudeThreads(db, U);
    expect(count(db, 'SELECT COUNT(*) FROM coach_messages')).toBe(messages - 2);
    expect(db.rows("SELECT deleted_at IS NOT NULL AS dead, title FROM coach_conversations WHERE id = 'nq-q3'")).toEqual([{ dead: 1, title: '' }]);
    const since = (await listThreads(db, U, { since: '2000-01-01T00:00:00.000Z', archived: null })).deleted_ids;
    expect(since).toEqual(['nq-q3']);
  });

  it('a half-copied group: the missing questions join the thread that already holds one', async () => {
    await appendCardQuestion(db, U, { id: 'n1', hanzi: '银行' }, { id: 'q1', question: 'x', answer: 'y', asked_at: '2026-10-01 10:00:00' });
    // The first call ran the whole backfill (and q1 with it); simulate a lost copy of q2.
    db.raw.run("DELETE FROM coach_messages WHERE legacy_id = 'q2'");
    await backfillClaudeThreads(db, U);
    expect((await getThreadMessages(db, 'nq-q1')).map((m) => m.legacy_id)).toEqual(['q1', 'q1', 'q2', 'q2']);
    expect(threadIds(db).filter((id) => id.startsWith('nq-'))).toEqual(['nq-q1', 'nq-q3', 'nq-q4']);
  });

  it("Ask's dual-write: within 30 min of the card thread's last message it joins it, later it starts a new one", async () => {
    await backfillClaudeThreads(db, U);
    db.raw.run("INSERT INTO note_questions (id, note_id, question, answer, asked_at) VALUES ('q5', 'n1', 'q5?', 'a5', '2026-10-02 09:20:00')");
    expect(await appendCardQuestion(db, U, { id: 'n1', hanzi: '银行' }, { id: 'q5', question: 'q5?', answer: 'a5', asked_at: '2026-10-02 09:20:00' })).toBe('nq-q3');
    // Again: already there.
    expect(await appendCardQuestion(db, U, { id: 'n1', hanzi: '银行' }, { id: 'q5', question: 'q5?', answer: 'a5', asked_at: '2026-10-02 09:20:00' })).toBe('nq-q3');
    db.raw.run("INSERT INTO note_questions (id, note_id, question, answer, asked_at) VALUES ('q6', 'n1', 'q6?', 'a6', '2026-10-02 11:00:00')");
    expect(await appendCardQuestion(db, U, { id: 'n1', hanzi: '银行' }, { id: 'q6', question: 'q6?', answer: 'a6', asked_at: '2026-10-02 11:00:00' })).toBe('nq-q6');
    expect((await getThreadMessages(db, 'nq-q3')).map((m) => m.legacy_id)).toEqual(['q3', 'q3', 'q5', 'q5']);
    // A forced re-run agrees with the dual-write (same grouping rule): nothing new.
    const before = count(db, 'SELECT COUNT(*) FROM coach_messages');
    await backfillClaudeThreads(db, U);
    expect(count(db, 'SELECT COUNT(*) FROM coach_messages')).toBe(before);
  });

  it('Discuss with Claude: a later save adds the new messages to its thread', async () => {
    await backfillClaudeThreads(db, U);
    db.raw.run('UPDATE message_discussions SET messages_json = ? WHERE id = ?', [
      JSON.stringify([
        { role: 'user', content: '去过是什么意思？' },
        { role: 'assistant', content: '过 = have done before.' },
        { role: 'user', content: '再给我一个例子' },
        { role: 'assistant', content: '我去过北京。' },
      ]),
      'md1',
    ]);
    expect(await syncDiscussionThread(db, U, 'm1')).toBe('md-md1');
    expect((await getThreadMessages(db, 'md-md1')).map((m) => m.content)).toEqual(['去过是什么意思？', '过 = have done before.', '再给我一个例子', '我去过北京。']);
  });

  it('a user nobody has backfilled: the dual-write leaves the copy to the backfill', async () => {
    expect(await appendCardQuestion(db, U, { id: 'n1', hanzi: '银行' }, { id: 'q1', question: 'x', answer: 'y' })).toBeNull();
    expect(db.rows('SELECT claude_threads_backfilled_at IS NOT NULL AS done FROM users WHERE id = ?', [U])).toEqual([{ done: 1 }]);
  });
});
