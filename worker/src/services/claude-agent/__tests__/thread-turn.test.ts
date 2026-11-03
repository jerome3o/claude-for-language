/**
 * Claude threads — a reply (claude-agent/thread-turn.ts + live.ts + store.ts) against REAL SQLite with
 * every migration and a fake streaming model: the text streams to the owner's socket (`claude_turn`,
 * seq growing, the whole text each time) and into the pending row (the poll fallback), the row is
 * finished with meta and the thread's inbox fields; the lease keeps a second runner out until it
 * expires (the watchdog then resumes); a busy model is retried then failed with a readable reason; a
 * checkpoint is never re-asked; a card turn also lands in note_questions; practice threads are
 * read-only; E2E_TEST_MODE takes the stand-in first; startThreadTurn schedules the watchdog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeTurnEvent } from '@shared/claude/api';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import type { Env } from '../../../types';
import { FAKE_STREAM_CHUNKS, fakeStreamingClient } from '../fake';
import { runThreadTurn, startThreadTurn, WATCHDOG_DELAY_SECONDS } from '../thread-turn';
import * as store from '../store';
import { backfillClaudeThreads } from '../backfill';

const U = 'u1';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'j@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c1', 'n1', 'hanzi_to_meaning', 2)");
}

async function newTurn(db: SqliteD1, context: Parameters<typeof store.createThread>[1]['context'], text: string, answerLang: 'zh' | 'en' | null = 'zh') {
  const { thread } = await store.createThread(db, { userId: U, context, title: text, source: 'app', ...(context.kind === 'card' ? { snapshot: { label: '银行' } } : {}) });
  const turn = await store.appendTurn(db, { threadId: thread.id, role: 'user', content: text, intent: 'ask' }, { contentType: 'text', answerLang });
  return { threadId: thread.id, userMessageId: turn.user.id, replyId: turn.reply!.id };
}

function envOf(db: SqliteD1, extra: Partial<Env> = {}): Env {
  return { DB: db, ANTHROPIC_API_KEY: 'test-key', ...extra } as unknown as Env;
}

/** Live options that record every event and write / push at once (no throttle). */
function recorder() {
  const events: ClaudeTurnEvent[] = [];
  return { events, live: { push: async (e: ClaudeTurnEvent) => void events.push(e), pushIntervalMs: 0, writeIntervalMs: 0 } };
}

const reply = (db: SqliteD1, id: string) => db.rows<store.MessageRow>('SELECT * FROM coach_messages WHERE id = ?', [id])[0];

describe('a Claude thread reply', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('streams to the owner (whole text, seq growing) and the row, then finishes the row and the inbox', async () => {
    const { threadId, replyId } = await newTurn(db, { kind: 'general' }, '成都有什么好吃的？');
    const rec = recorder();
    const partials: string[] = [];
    const spy = vi.spyOn(store, 'writePartial').mockImplementation(async (d, id, text, lease) => {
      partials.push(text);
      await d.prepare('UPDATE coach_messages SET content = ? WHERE id = ?').bind(text, id).run();
      void lease;
    });
    const out = await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: rec.live, inline: true, clip: null });
    spy.mockRestore();
    expect(out).toBe('done');

    const full = FAKE_STREAM_CHUNKS.zh.join('');
    const row = reply(db, replyId);
    expect(row).toMatchObject({ status: null, content: full, lease_until: null, checkpoint: null, answer_lang: 'zh' });
    expect(JSON.parse(row.meta!)).toMatchObject({ inline: true, attempt: 1, rounds: 1 });
    expect(JSON.parse(row.meta!).first_token_ms).toBeGreaterThanOrEqual(0);
    // The poll fallback saw the text grow.
    expect(partials.length).toBeGreaterThanOrEqual(1);
    expect(full.startsWith(partials[0])).toBe(true);

    expect(rec.events[0]).toMatchObject({ type: 'claude_turn', thread_id: threadId, message_id: replyId, status: 'thinking' });
    expect(rec.events.at(-1)).toMatchObject({ status: 'done', text: full });
    const seqs = rec.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(rec.events.filter((e) => e.status === 'streaming').every((e) => full.startsWith(e.text ?? '∅'))).toBe(true);

    const summary = (await store.getThreadSummary(db, U, threadId))!;
    expect(summary).toMatchObject({ unread: 1, pending: false, preview: full.replace(/\n/g, ' ').slice(0, 120) });
  });

  it('the lease keeps a second runner out; once it lapses the watchdog resumes the reply', async () => {
    const { replyId } = await newTurn(db, { kind: 'general' }, '你好');
    expect(await store.claimTurn(db, replyId)).toBe(true);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip: null })).toBe('busy');
    // The first runner died (isolate gone): its lease lapses.
    db.raw.run("UPDATE coach_messages SET lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?", [replyId]);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip: null })).toBe('done');
    expect(reply(db, replyId).attempts).toBe(2);
    // A late watchdog delivery finds nothing to do.
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live })).toBe('skipped');
  });

  it('a busy model is retried (row pending, lease released), the last attempt fails with a readable reason', async () => {
    const { replyId } = await newTurn(db, { kind: 'general' }, '你好');
    const busy = { messages: { stream: () => { throw Object.assign(new Error('overloaded'), { status: 529 }); }, create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    const rec = recorder();
    expect(await runThreadTurn(envOf(db), replyId, { client: busy, live: rec.live })).toBe('retry');
    expect(reply(db, replyId)).toMatchObject({ status: 'pending', lease_until: null, content: '' });
    expect(rec.events.at(-1)).toMatchObject({ status: 'thinking', text: '' });
    expect(await runThreadTurn(envOf(db), replyId, { client: busy, live: rec.live })).toBe('retry');
    expect(await runThreadTurn(envOf(db), replyId, { client: busy, live: rec.live })).toBe('failed');
    expect(reply(db, replyId)).toMatchObject({ status: 'failed', error: 'Claude is busy right now — try again in a moment.' });
    expect(rec.events.at(-1)).toMatchObject({ status: 'failed', error: 'Claude is busy right now — try again in a moment.' });
    // Retry: back to pending, and it runs.
    expect(await store.reopenTurn(db, replyId)).toBe(true);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip: null })).toBe('done');
  });

  it('a checkpointed answer is never asked again: only the remaining actions run', async () => {
    const { replyId } = await newTurn(db, { kind: 'card', note_id: 'n1' }, 'Make a card for 银行卡', 'en');
    db.raw.run('UPDATE coach_messages SET checkpoint = ? WHERE id = ?', [
      JSON.stringify({ answer: 'Done — I made two cards.', actions: [{ tool: 'create_flashcards', input: { flashcards: [] } }, { tool: 'create_flashcards', input: { flashcards: [] } }], applied: 1, results: [{ tool: 'create_flashcards', success: true }] }),
      replyId,
    ]);
    const model = { messages: { stream: vi.fn(), create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    const applyCard = vi.fn(async () => ({ tool: 'create_flashcards', success: true, data: { count: 1 } }));
    expect(await runThreadTurn(envOf(db), replyId, { client: model, applyCard, live: recorder().live, clip: null })).toBe('done');
    expect(model.messages.stream).not.toHaveBeenCalled();
    expect(applyCard).toHaveBeenCalledTimes(1);
    const row = reply(db, replyId);
    expect(row.content).toBe('Done — I made two cards.');
    expect(JSON.parse(row.tool_results!)).toHaveLength(2);
  });

  it('a card turn answers with the card in the first message, and lands in note_questions (no double copy later)', async () => {
    const { replyId, userMessageId } = await newTurn(db, { kind: 'card', note_id: 'n1' }, '行 has two readings?', 'en');
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const base = fakeStreamingClient('en', 0);
    const client = { messages: { create: base.messages.create, stream: (p: Anthropic.MessageCreateParamsNonStreaming) => (seen.push(p), base.messages.stream(p)) } } as unknown as Pick<Anthropic, 'messages'>;
    expect(await runThreadTurn(envOf(db), replyId, { client, live: recorder().live, clip: null })).toBe('done');
    const first = seen[0].messages[0].content;
    expect(typeof first === 'string' ? first : JSON.stringify(first)).toContain('银行');
    const qs = db.rows<{ id: string; question: string; answer: string; answer_lang: string }>('SELECT id, question, answer, answer_lang FROM note_questions');
    expect(qs).toEqual([{ id: expect.any(String), question: '行 has two readings?', answer: FAKE_STREAM_CHUNKS.en.join(''), answer_lang: 'en' }]);
    expect(db.rows('SELECT legacy_id FROM coach_messages WHERE id IN (?, ?)', [userMessageId, replyId]).map((r) => (r as { legacy_id: string }).legacy_id)).toEqual([qs[0].id, qs[0].id]);
    // The backfill sees it is there already.
    const before = db.rows('SELECT COUNT(*) AS n FROM coach_messages')[0];
    await backfillClaudeThreads(db, U);
    expect(db.rows('SELECT COUNT(*) AS n FROM coach_messages')[0]).toEqual(before);
  });

  it('practice threads are read-only: the reply fails with why', async () => {
    const { replyId } = await newTurn(db, { kind: 'practice', conversation_id: 'pc1' }, '我要一碗面');
    db.raw.run("UPDATE coach_conversations SET read_only = 1 WHERE context_kind = 'practice'");
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live })).toBe('failed');
    expect(reply(db, replyId).error).toBe('This chat can’t continue here yet');
  });

  it('E2E_TEST_MODE takes the stand-in first, whatever key is set; startThreadTurn schedules the watchdog', async () => {
    const { replyId } = await newTurn(db, { kind: 'general' }, '你好');
    const sent: Array<{ body: unknown; opts: unknown }> = [];
    const env = envOf(db, { E2E_TEST_MODE: 'true', COACH_REPLY_QUEUE: { send: async (body: unknown, opts: unknown) => void sent.push({ body, opts }) } } as never);
    const real = { messages: { stream: vi.fn(), create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    await startThreadTurn(env, replyId, { client: real, live: recorder().live });
    expect(real.messages.stream).not.toHaveBeenCalled();
    expect(sent).toEqual([{ body: { kind: 'claude_turn', messageId: replyId }, opts: { delaySeconds: WATCHDOG_DELAY_SECONDS } }]);
    expect(reply(db, replyId)).toMatchObject({ status: null, content: FAKE_STREAM_CHUNKS.zh.join('') });
  });
});
