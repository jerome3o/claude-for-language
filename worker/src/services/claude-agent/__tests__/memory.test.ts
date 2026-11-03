/**
 * Claude memory (claude-agent/memory.ts + tools/memory.ts + store.ts) against REAL SQLite with every
 * migration and a fake model: the thread summary is written after a reply (incrementally, only when ≥ 2
 * messages are new — never in the reply's way), the learner digest + recent-chats index are rebuilt (the
 * first after the first summary, then after 5 new ones, and by the daily cron), the memory block reaches
 * every context's prompt within its budget and ≤ 4 cache breakpoints, search_my_chats / read_chat return
 * only the caller's own chats within their token caps, a long thread is compacted to its first message +
 * summary + the last turns, and E2E_TEST_MODE takes the stand-in first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import type { Env } from '../../../types';
import { CONTEXT_KINDS, prepareClaudeTurn, runClaudeTurn, type ClaudeContext, type ContextKind, type TurnInput } from '..';
import {
  compactMessages,
  DIGEST_REBUILD_AFTER,
  estimateTokens,
  HISTORY_KEEP_TURNS,
  HISTORY_TOKEN_BUDGET,
  MEMORY_BLOCK_MAX_TOKENS,
  memoryBlock,
  parseLearnerMemory,
  rebuildLearnerDigest,
  rememberThread,
  runClaudeMemoryCron,
  summarizeThread,
  THREADS_INDEX_MAX,
} from '../memory';
import { executeReadChat, executeSearchMyChats, READ_MAX_TOKENS, SEARCH_MAX_TOKENS } from '../tools/memory';
import { FAKE_STREAM_CHUNKS } from '../fake';
import { startThreadTurn } from '../thread-turn';
import * as store from '../store';

const U = 'u1';
const OTHER = 'u2';
type Params = Anthropic.MessageCreateParamsNonStreaming;

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'j@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u2', 'o@x.test', 'Other', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('t1', 't@x.test', 'Minghui', 'tutor')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c1', 'n1', 'hanzi_to_meaning', 2)");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r1', 't1', 'u1', 'tutor', 'active')");
  db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('cv1', 'r1')");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ('m1', 'cv1', 't1', '你去过银行吗？')");
}

let clock = 0;
/** A thread with messages at increasing times (`[role, text]`), for user `userId`. */
function thread(db: SqliteD1, id: string, title: string, messages: Array<['user' | 'assistant', string]>, opts: { userId?: string; kind?: string; json?: string; at?: string } = {}) {
  const at = opts.at ?? '2026-11-01T10:00:00.000Z';
  db.raw.run(
    `INSERT INTO coach_conversations (id, user_id, title, context_kind, context_json, source, created_at, updated_at, last_message_at, changed_at)
     VALUES (?, ?, ?, ?, ?, 'app', datetime(?), datetime(?), ?, ?)`,
    [id, opts.userId ?? U, title, opts.kind ?? 'general', opts.json ?? '{"kind":"general"}', at, at, at, at],
  );
  for (const [role, content] of messages) addMessage(db, id, role, content);
}

function addMessage(db: SqliteD1, threadId: string, role: 'user' | 'assistant', content: string) {
  clock++;
  const id = `${threadId}-m${clock}`;
  db.raw.run(`INSERT INTO coach_messages (id, conversation_id, role, content_type, content, created_at) VALUES (?, ?, ?, 'text', ?, datetime('2026-11-01 10:00:00', '+${clock} seconds'))`, [id, threadId, role, content]);
  db.raw.run(`UPDATE coach_conversations SET preview = ?, last_message_at = strftime('%Y-%m-%dT%H:%M:%fZ', datetime('2026-11-01 10:00:00', '+${clock} seconds')) WHERE id = ?`, [content.slice(0, 120), threadId]);
  return id;
}

/** A fake model answering every forced tool: the summary / notes tools with fixed values, recording requests. */
function memoryModel(values: { summary?: string; topics?: string[]; notes?: string } = {}) {
  const seen: Params[] = [];
  const create = vi.fn(async (p: Params) => {
    seen.push(JSON.parse(JSON.stringify(p)));
    const name = (p.tool_choice as { name: string }).name;
    const input = name === 'write_chat_summary' ? { summary: values.summary ?? 'Asked how to use 银行.', topics: values.topics ?? ['银行'] } : { notes: values.notes ?? 'Working on: 银行\nKeeps confusing: 行 háng / xíng' };
    return { model: 'claude-haiku-4-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name, input }], usage: { input_tokens: 300, output_tokens: 40 } };
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, seen, create };
}

const envOf = (db: SqliteD1, extra: Partial<Env> = {}) => ({ DB: db, ANTHROPIC_API_KEY: 'k', ...extra }) as unknown as Env;
const userText = (p: Params) => String(p.messages[0].content);
const row = (db: SqliteD1, id: string) => db.rows<store.ThreadRow & { summary_at: string | null }>('SELECT * FROM coach_conversations WHERE id = ?', [id])[0];

describe('Claude memory', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    clock = 0;
  });

  describe('thread summaries', () => {
    it('written after ≥ 2 new messages, incrementally from summary_upto; skipped with fewer; never touches the inbox cursor', async () => {
      thread(db, 'th1', '银行怎么用？', [['user', '银行怎么用？'], ['assistant', '银行就是放钱的地方。']]);
      const before = row(db, 'th1').changed_at;
      const m = memoryModel();
      expect(await summarizeThread(envOf(db), 'th1', { client: m.client })).toBe('written');
      let t = row(db, 'th1');
      expect(t.summary).toBe('Asked how to use 银行.\nTopics: 银行');
      expect(t.summary_upto).toBe('th1-m2');
      expect(t.summary_at).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(t.changed_at).toBe(before);
      expect(userText(m.seen[0])).toContain('Summary so far: (none yet)');
      expect(userText(m.seen[0])).toContain('Learner: 银行怎么用？');
      expect(m.seen[0]).toMatchObject({ model: 'claude-haiku-4-5', thinking: { type: 'disabled' }, tool_choice: { type: 'tool', name: 'write_chat_summary' } });

      // One new message: not worth a call.
      addMessage(db, 'th1', 'user', '行 有几个读音？');
      expect(await summarizeThread(envOf(db), 'th1', { client: m.client })).toBe('skipped');
      expect(m.create).toHaveBeenCalledTimes(1);

      // Two: rewritten from the previous summary + only the new messages.
      addMessage(db, 'th1', 'assistant', '两个：háng 和 xíng。');
      expect(await summarizeThread(envOf(db), 'th1', { client: memoryModel({ summary: 'Asked about 银行 and the two readings of 行.' }).client })).toBe('written');
      t = row(db, 'th1');
      expect(t.summary_upto).toBe('th1-m4');
      expect(t.summary).toContain('two readings');

      // Tokens on the learner's row, and the analytics event.
      expect(db.rows('SELECT input_tokens, output_tokens FROM claude_learner_memory WHERE user_id = ?', [U])[0]).toEqual({ input_tokens: 600, output_tokens: 80 });
      const events = db.rows<{ props: string }>("SELECT props FROM usage_events WHERE event = 'server.claude_memory'");
      expect(events.length).toBe(2);
      expect(JSON.parse(events[0].props)).toMatchObject({ kind: 'summary', input_tokens: 300, output_tokens: 40 });
    });

    it('the newest messages are sent when there are many; the second of two racing writers loses', async () => {
      const long = '很长的回答。'.repeat(200);
      thread(db, 'th2', 'long', Array.from({ length: 30 }, (_, i) => [i % 2 ? 'assistant' : 'user', i % 2 ? long : `问题 ${i}`] as ['user' | 'assistant', string]));
      const m = memoryModel();
      expect(await summarizeThread(envOf(db), 'th2', { client: m.client })).toBe('written');
      const sent = userText(m.seen[0]);
      expect(sent).toContain('问题 28');
      expect(sent).toMatch(/earlier new messages left out/);
      expect(sent.length).toBeLessThan(9_500);
      // Stale read of summary_upto: the write is refused.
      expect(await store.writeThreadSummary(db, 'th2', null, 'x', 'th2-m1')).toBe(false);
    });

    it('rememberThread never throws: a failing model is logged, nothing is written', async () => {
      thread(db, 'th3', 'x', [['user', '你好'], ['assistant', '你好！']]);
      const broken = { messages: { create: vi.fn(async () => { throw Object.assign(new Error('boom'), { status: 500 }); }) } } as unknown as Pick<Anthropic, 'messages'>;
      expect(await rememberThread(envOf(db), 'th3', { client: broken, sleep: async () => {} })).toEqual({ summary: 'failed' });
      expect(row(db, 'th3').summary).toBeNull();
      // No key and no client: nothing to call.
      expect(await rememberThread(envOf(db, { ANTHROPIC_API_KEY: '' }), 'th3')).toEqual({ summary: 'unavailable' });
    });

    it('after a thread reply (startThreadTurn, E2E stand-in first): the summary and the first digest are written, the reply untouched', async () => {
      const { thread: t } = await store.createThread(db, { userId: U, context: { kind: 'general' }, title: '你好', source: 'app' });
      const turn = await store.appendTurn(db, { threadId: t.id, role: 'user', content: '成都有什么好吃的？', intent: 'ask' }, { contentType: 'text', answerLang: 'zh' });
      const real = { messages: { stream: vi.fn(), create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
      const env = envOf(db, { E2E_TEST_MODE: 'true' });
      await startThreadTurn(env, turn.reply!.id, { client: real, live: { push: async () => {}, pushIntervalMs: 0, writeIntervalMs: 0 }, memory: { client: real } });
      expect(real.messages.create).not.toHaveBeenCalled();
      const reply = db.rows<{ status: string | null; content: string }>('SELECT status, content FROM coach_messages WHERE id = ?', [turn.reply!.id])[0];
      expect(reply).toEqual({ status: null, content: FAKE_STREAM_CHUNKS.zh.join('') });
      expect(row(db, t.id).summary).toContain('(E2E)');
      expect(row(db, t.id).summary).toContain('成都有什么好吃的');
      const mem = db.rows<store.MemoryRow>('SELECT * FROM claude_learner_memory WHERE user_id = ?', [U])[0];
      expect(mem.digest).toContain('(E2E)');
      expect(JSON.parse(mem.threads_index).map((e: { id: string }) => e.id)).toEqual([t.id]);
    });
  });

  describe('the learner digest', () => {
    it('rebuilt from the summaries: digest + index (≤ 20, newest first), watermark; then again only after 5 new summaries', async () => {
      for (let i = 0; i < 25; i++) thread(db, `t${String(i).padStart(2, '0')}`, `问题 ${i}`, [['user', `问题 ${i}`], ['assistant', '回答']]);
      const m = memoryModel();
      expect(await rememberThread(envOf(db), 't00', { client: m.client })).toEqual({ summary: 'written', digest: 'written' });
      let mem = db.rows<store.MemoryRow>('SELECT * FROM claude_learner_memory WHERE user_id = ?', [U])[0];
      expect(mem.digest).toBe('Working on: 银行\nKeeps confusing: 行 háng / xíng');
      const index = JSON.parse(mem.threads_index);
      expect(index).toHaveLength(THREADS_INDEX_MAX);
      expect(index[0]).toMatchObject({ id: 't24', title: '问题 24', badge: 'Chat', line: '回答' });
      expect(index.find((e: { id: string }) => e.id === 't00')).toBeUndefined();
      expect(mem.watermark).toBe(row(db, 't00').summary_at);
      // The digest prompt carried the summaries.
      expect(userText(m.seen.find((p) => (p.tool_choice as { name: string }).name === 'write_learner_notes')!)).toContain('Asked how to use 银行.');

      // New summaries: no rebuild until DIGEST_REBUILD_AFTER of them.
      const digests = () => m.seen.filter((p) => (p.tool_choice as { name: string }).name === 'write_learner_notes').length;
      for (let i = 1; i < DIGEST_REBUILD_AFTER; i++) {
        await new Promise((r) => setTimeout(r, 2)); // summary_at has millisecond resolution
        expect(await rememberThread(envOf(db), `t1${i}`, { client: m.client })).toEqual({ summary: 'written' });
        expect((await store.pendingSummaries(db, U)).pending).toBe(i);
      }
      await new Promise((r) => setTimeout(r, 2));
      expect(digests()).toBe(1);
      expect((await rememberThread(envOf(db), 't20', { client: m.client })).digest).toBe('written');
      expect(digests()).toBe(2);
      expect((await store.pendingSummaries(db, U)).pending).toBe(0);
      mem = db.rows<store.MemoryRow>('SELECT * FROM claude_learner_memory WHERE user_id = ?', [U])[0];
      expect(mem.digest_at).not.toBeNull();
    });

    it('the daily cron: summaries of threads behind (recent only), then digests for learners with new summaries', async () => {
      thread(db, 'a1', 'a', [['user', '把字句'], ['assistant', '把 + 宾语 + 动词']]);
      thread(db, 'a2', 'b', [['user', '只有一条']]);
      thread(db, 'old', 'old', [['user', '旧'], ['assistant', '旧的']]);
      db.raw.run("UPDATE coach_conversations SET last_message_at = '2026-01-01T00:00:00.000Z' WHERE id = 'old'");
      thread(db, 'b1', 'other', [['user', '你好'], ['assistant', '你好']], { userId: OTHER });
      const m = memoryModel();
      const out = await runClaudeMemoryCron(envOf(db), { now: Date.parse('2026-11-02T03:17:00Z'), deps: { client: m.client } });
      expect(out).toEqual({ summaries: 2, skipped: 1, digests: 2, failed: 0 });
      expect(row(db, 'old').summary).toBeNull();
      expect(db.rows('SELECT user_id FROM claude_learner_memory ORDER BY user_id').map((r) => (r as { user_id: string }).user_id)).toEqual([U, OTHER]);
      // Nothing behind: a second run calls nothing.
      m.create.mockClear();
      expect(await runClaudeMemoryCron(envOf(db), { now: Date.parse('2026-11-02T03:17:00Z'), deps: { client: m.client } })).toEqual({ summaries: 0, skipped: 1, digests: 0, failed: 0 });
      expect(m.create).not.toHaveBeenCalled();
    });
  });

  describe('in the prompt', () => {
    const CONTEXTS: Record<ContextKind, { ctx: ClaudeContext; input: TurnInput }> = {
      general: { ctx: { kind: 'general' }, input: { userId: U, language: 'zh', turns: [{ role: 'user', content: '你好' }] } },
      card: { ctx: { kind: 'card', note_id: 'n1' }, input: { userId: U, language: 'zh', turns: [{ role: 'user', content: '这个词怎么用？' }] } },
      coach: { ctx: { kind: 'coach' }, input: { userId: U, turns: [{ role: 'user', content: 'The user submitted this sentence: "我去银行。"' }, { role: 'assistant', content: 'analysis' }, { role: 'user', content: 'Why 去?' }] } },
      chat_message: { ctx: { kind: 'chat_message', message_id: 'm1' }, input: { userId: U, turns: [{ role: 'user', content: 'What does it mean?' }] } },
    };

    function bigMemory() {
      const index = Array.from({ length: 20 }, (_, i) => ({ id: `0123456789abcdef-${i}`, title: `一个很长的标题，关于第${i}次聊天的内容`, badge: '📇 Asked on card · 银行', last_at: '2026-11-01T10:00:00.000Z', line: '问了很多关于银行和行的问题，还有把字句、了的用法。'.repeat(3) }));
      db.raw.run('INSERT INTO claude_learner_memory (user_id, digest, threads_index, digest_at) VALUES (?, ?, ?, ?)', [U, `Working on: 银行, 把字句\n${'Keeps confusing: 了 after verbs. '.repeat(400)}`, JSON.stringify(index), '2026-11-01T00:00:00.000Z']);
    }

    it('every context: "What you know from earlier chats" in the cached learner block, ≤ 800 tokens, ≤ 4 breakpoints, the same on every ask', async () => {
      bigMemory();
      const block = memoryBlock(parseLearnerMemory(db.rows<store.MemoryRow>('SELECT * FROM claude_learner_memory')[0]));
      expect(estimateTokens(block)).toBeLessThanOrEqual(MEMORY_BLOCK_MAX_TOKENS);
      expect(block).toContain('Working on: 银行, 把字句');
      expect(block).toContain('Recent chats (newest first):');
      expect(block).toContain('(chat 0123456789ab)');

      for (const kind of CONTEXT_KINDS) {
        const seen: Params[] = [];
        const create = vi.fn(async (p: Params) => (seen.push(JSON.parse(JSON.stringify(p))), { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '好' }], usage: {} }));
        const client = { messages: { create } } as unknown as Pick<Anthropic, 'messages'>;
        await runClaudeTurn(envOf(db), CONTEXTS[kind].ctx, CONTEXTS[kind].input, { client });
        const p = seen[0];
        const system = p.system as Anthropic.TextBlockParam[];
        expect(system.length, kind).toBe(2);
        expect(system[1].text, kind).toContain(block);
        expect(system[1].cache_control, kind).toEqual({ type: 'ephemeral' });
        let n = 0;
        JSON.stringify(p, (k, v) => (k === 'cache_control' && v ? (n++, v) : v));
        expect(n, kind).toBeLessThanOrEqual(4);
        expect((p.tools ?? []).map((t) => (t as { name: string }).name), kind).toEqual(expect.arrayContaining(['search_my_chats', 'read_chat']));
        // Stable: the same block on the next ask.
        const again = await prepareClaudeTurn(envOf(db), CONTEXTS[kind].ctx, CONTEXTS[kind].input, { client });
        expect(again.system[1].text).toBe(system[1].text);
      }
    });

    it('no memory yet: no block (the prompt is as before)', async () => {
      const p = await prepareClaudeTurn(envOf(db), CONTEXTS.coach.ctx, CONTEXTS.coach.input, { client: memoryModel().client });
      expect(p.system).toHaveLength(1);
      expect(p.system.map((b) => b.text).join('')).not.toContain('earlier chats');
    });
  });

  describe('the memory tools', () => {
    const ctx = (userId = U, threadId: string | null = null) => ({ db: db as unknown as D1Database, userId, deckId: '', bumpSource: 'x', context: 'general' as const, threadId });

    beforeEach(() => {
      thread(db, 'mine1', '银行 和 行', [['user', '银行的行怎么读？'], ['assistant', '读 háng。行 还可以读 xíng，比如 「行走」。']], { kind: 'card', json: '{"kind":"card","note_id":"n1","label":"银行"}' });
      db.raw.run("UPDATE coach_conversations SET summary = 'Asked about the readings of 行 in 银行.' WHERE id = 'mine1'");
      thread(db, 'mine2', '把字句', [['user', '把字句是什么？'], ['assistant', '把 + 东西 + 动词。']]);
      thread(db, 'theirs', '银行', [['user', '银行 secret of another learner'], ['assistant', '银行']], { userId: OTHER });
    });

    it('search_my_chats: only my chats, ranked by the terms they match, with excerpts; the chat asking left out', async () => {
      const r = await executeSearchMyChats({ query: '银行 háng' }, ctx());
      const ids = (r.results as Array<{ thread_id: string }>).map((x) => x.thread_id);
      expect(ids).toEqual(['mine1']);
      expect(JSON.stringify(r)).not.toContain('another learner');
      const hit = (r.results as Array<Record<string, unknown>>)[0];
      expect(hit).toMatchObject({ title: '银行 和 行', badge: '📇 Asked on card · 银行', summary: 'Asked about the readings of 行 in 银行.' });
      expect((hit.excerpts as unknown[]).length).toBeGreaterThan(0);
      expect((await executeSearchMyChats({ query: '银行' }, ctx(U, 'mine1'))).count).toBe(0);
      // Empty query = the most recent chats; % and _ are literal.
      expect(((await executeSearchMyChats({ query: '' }, ctx())).results as unknown[]).length).toBe(2);
      expect((await executeSearchMyChats({ query: '%%' }, ctx())).count).toBe(0);
    });

    it('search_my_chats stays within its token cap however much matches', async () => {
      for (let i = 0; i < 12; i++) thread(db, `big${i}`, `银行 ${'很长的标题'.repeat(30)}`, [['user', `银行 ${'很长的问题。'.repeat(300)}`], ['assistant', `银行 ${'很长的回答。'.repeat(300)}`]]);
      for (let i = 0; i < 12; i++) db.raw.run('UPDATE coach_conversations SET summary = ? WHERE id = ?', ['银行 '.repeat(200), `big${i}`]);
      const r = await executeSearchMyChats({ query: '银行', limit: 50 }, ctx());
      expect((r.results as unknown[]).length).toBeLessThanOrEqual(5);
      expect(estimateTokens(JSON.stringify(r))).toBeLessThanOrEqual(SEARCH_MAX_TOKENS);
    });

    it('read_chat: my chat by id or short id, never someone else’s; ≤ 20 messages within the cap; centred on `around`', async () => {
      expect(await executeReadChat({ thread_id: 'theirs' }, ctx())).toEqual({ error: 'No chat of this learner with that id.' });
      expect((await executeReadChat({ thread_id: 'mine1' }, ctx())).messages).toHaveLength(2);
      expect((await executeReadChat({ thread_id: 'mine1' }, ctx(OTHER))).error).toBeDefined();

      const msgs: Array<['user' | 'assistant', string]> = Array.from({ length: 40 }, (_, i) => [i % 2 ? 'assistant' : 'user', i === 7 ? '我们说过「火车站」吗？' : `第${i}条。${'内容很长。'.repeat(200)}`]);
      thread(db, '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', 'long', msgs);
      const short = await executeReadChat({ thread_id: '0f1e2d3c-4b5a', max_messages: 50 }, ctx());
      expect(short.thread_id).toBe('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
      const list = short.messages as Array<{ text: string }>;
      expect(list.length).toBeLessThanOrEqual(20);
      expect(list.every((m) => m.text.length <= 400)).toBe(true);
      expect(estimateTokens(JSON.stringify(short))).toBeLessThanOrEqual(READ_MAX_TOKENS);
      expect(list.at(-1)!.text).toContain('第39条');
      const around = await executeReadChat({ thread_id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', around: '火车站' }, ctx());
      expect((around.messages as Array<{ text: string }>).some((m) => m.text.includes('火车站'))).toBe(true);
      expect(String(around.showing)).toMatch(/^messages \d+–\d+ of 40$/);
      // A short id must be unique and long enough.
      expect((await executeReadChat({ thread_id: '0f1e' }, ctx())).error).toBeDefined();
    });
  });

  describe('history compaction', () => {
    const turn = (role: 'user' | 'assistant', i: number, len = 900) => ({ role, content: `${role === 'user' ? '问' : '答'}${i} ${'这是一段很长的中文内容。'.repeat(len / 10)}` });

    it('unchanged within the budget; over it: the first message + the last turns, alternating, the summary in the note', () => {
      const short = [turn('user', 0, 10), turn('assistant', 1, 10), turn('user', 2, 10)];
      expect(compactMessages(short)).toEqual({ messages: short, note: '', dropped: 0 });

      const long = Array.from({ length: 31 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', i));
      expect(long.reduce((a, m) => a + estimateTokens(m.content), 0)).toBeGreaterThan(HISTORY_TOKEN_BUDGET);
      const c = compactMessages(long, { summary: 'Talked about 银行.', threadId: 'th-x' });
      expect(c.messages[0]).toBe(long[0]);
      expect(c.messages.at(-1)).toBe(long.at(-1));
      expect(c.messages.length).toBeLessThanOrEqual(HISTORY_KEEP_TURNS + 1);
      for (let i = 1; i < c.messages.length; i++) expect(c.messages[i].role).not.toBe(c.messages[i - 1].role);
      expect(c.messages.reduce((a, m) => a + estimateTokens(m.content), 0)).toBeLessThanOrEqual(HISTORY_TOKEN_BUDGET);
      expect(c.dropped).toBe(long.length - c.messages.length);
      expect(c.note).toContain('Summary of the chat so far: Talked about 银行.');
      expect(c.note).toContain('read_chat with thread_id "th-x"');

      // No summary yet: the left-out questions are named instead.
      expect(compactMessages(long).note).toContain('「问');
    });

    it('in a turn: a long thread is sent compacted with its summary; the card framing stays on the first message', async () => {
      thread(db, 'lt', 'long', []);
      db.raw.run("UPDATE coach_conversations SET summary = 'Asked about 银行 many times.' WHERE id = 'lt'");
      const turns = Array.from({ length: 41 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', i));
      const p = await prepareClaudeTurn(envOf(db), { kind: 'card', note_id: 'n1' }, { userId: U, language: 'en', threadId: 'lt', turns }, { client: memoryModel().client });
      expect(p.messages.length).toBeLessThanOrEqual(HISTORY_KEEP_TURNS + 1);
      expect(String(p.messages[0].content)).toContain('The user is studying this vocabulary:');
      expect(String(p.messages.at(-1)!.content)).toContain('问40');
      const context = p.system.map((b) => b.text).join('\n');
      expect(context).toContain('Summary of the chat so far: Asked about 银行 many times.');
      // Someone else's thread id: its summary is never read.
      db.raw.run("UPDATE coach_conversations SET user_id = 'u2' WHERE id = 'lt'");
      const q = await prepareClaudeTurn(envOf(db), { kind: 'card', note_id: 'n1' }, { userId: U, language: 'en', threadId: 'lt', turns }, { client: memoryModel().client });
      expect(q.system.map((b) => b.text).join('\n')).not.toContain('many times');
    });
  });

  it('rebuildLearnerDigest with no chats: nothing to do', async () => {
    expect(await rebuildLearnerDigest(envOf(db), U, { client: memoryModel().client })).toBe('skipped');
  });
});
