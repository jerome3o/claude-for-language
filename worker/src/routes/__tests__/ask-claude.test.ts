/**
 * Ask Claude, immersion edition (routes/ask-claude.ts) against real SQLite with every migration:
 * the answer language (default Chinese, the account setting, the request's choice, an explicit
 * "in English"), the Chinese prompt with the learner's known words, Markdown taken out of a
 * Chinese answer, tools still applied, the question's auto-check (stored, the switch, quick
 * chips, English questions), word chips + translation made on request and cached, ownership.
 * Claude is faked: the ask agent loop through its client seam, everything else below
 * `structuredCall` (the real retry / validate logic runs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import type { Env } from '../../types';

const ai = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../services/structured-call', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/structured-call')>();
  return {
    ...mod,
    structuredCall: (opts: Parameters<typeof mod.structuredCall>[0]) =>
      mod.structuredCall({ ...opts, client: { messages: { create: ai.create } } as never, sleep: async () => {} }),
  };
});
vi.mock('../../services/ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/ai')>();
  return {
    ...mod,
    askAboutNoteWithTools: (...args: Parameters<typeof mod.askAboutNoteWithTools>) => {
      const [k, n, q, ctx, h, d, o] = args;
      return mod.askAboutNoteWithTools(k, n, q, ctx, h, d, { ...o, client: { messages: { create: ai.create } } as never });
    },
  };
});

const { default: askClaude } = await import('../ask-claude');

const ME = 'user-1';
const OTHER = 'user-2';

type Params = { system?: string; tool_choice?: { name: string }; tools?: Array<{ name: string }>; messages: Array<{ role: string; content: unknown }> };
const toolReply = (input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'x', input }], usage: { output_tokens: 10 } });
const textReply = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { output_tokens: 10 } });

const ZH_ANSWER = '**银行**就是放钱的地方。\n\n- 银：钱\n- 行：店\n\n例句：我去银行。';
const IMPROVABLE = {
  status: 'improvable',
  severity: 'moderate',
  corrected: { hanzi: '银行是什么意思？', pinyin: 'yínháng shì shénme yìsi', english: 'What does 银行 mean?' },
  mistakes: [{ quote: '什么意', fix: '什么意思', why: 'The word is 意思.' }],
};

let answerFor: (p: Params) => unknown = () => textReply(ZH_ANSWER);
let checkReply: unknown = IMPROVABLE;
function installClaude() {
  ai.create.mockReset();
  ai.create.mockImplementation(async (p: Params) => {
    const forced = p.tool_choice?.name;
    if (forced === 'check_message') return toolReply(checkReply);
    if (forced === 'split_words') {
      return toolReply({ words: [{ text: '银行', pinyin: 'yínháng', gloss: 'bank' }] });
    }
    if (forced) return toolReply({ translation: 'A bank is where money is kept.' });
    return answerFor(p);
  });
}
const calls = () => ai.create.mock.calls.map(([p]) => p as Params);
const askCalls = () => calls().filter((p) => !p.tool_choice);
const checkCalls = () => calls().filter((p) => p.tool_choice?.name === 'check_message');

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES (?, 'a@x.test', 'Jerome', 'student')", [ME]);
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES (?, 'b@x.test', 'Other', 'student')", [OTHER]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'HSK 2')", [ME]);
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-1', 'd-1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-2', 'd-1', '学生', 'xuésheng', 'student')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c-1', 'n-1', 'hanzi_to_meaning', 2)");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c-2', 'n-2', 'hanzi_to_meaning', 2)");
}

describe('Ask Claude (immersion)', () => {
  let db: SqliteD1;
  let env: Env;
  const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const as = (userId: string) => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/api/*', async (c, next) => { c.set('user', { id: userId } as never); await next(); });
    app.route('/api', askClaude);
    return async <T = Record<string, any>>(method: string, path: string, body?: unknown) => {
      const res = await app.request(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env, ctx);
      return { status: res.status, body: (await res.json()) as T };
    };
  };

  beforeEach(async () => {
    installClaude();
    answerFor = () => textReply(ZH_ANSWER);
    checkReply = IMPROVABLE;
    db = await createSqliteD1();
    seed(db);
    env = { DB: db, ANTHROPIC_API_KEY: 'test-key' } as unknown as Env;
  });

  it('answers in Chinese by default: the immersion prompt with known words, Markdown taken out, stored as zh', async () => {
    const r = await as(ME)('POST', '/api/notes/n-1/ask', { question: '这个词怎么用？', quick: true });
    expect(r.status).toBe(201);
    const system = askCalls()[0].system ?? '';
    expect(system).toContain('answer ENTIRELY in simple Chinese');
    expect(system).toMatch(/银行|学生/);
    // The card's state reaches Claude (the context query used a cards.deck_id that doesn't exist).
    expect(String(askCalls()[0].messages[0].content)).toContain('- Card status: hanzi_to_meaning: review');
    expect(r.body.answer_lang).toBe('zh');
    expect(r.body.answer).toBe('银行就是放钱的地方。\n\n・银：钱\n・行：店\n\n例句：我去银行。');
    expect(r.body.answer_words).toBeNull();
    const row = db.raw.exec("SELECT answer, answer_lang FROM note_questions")[0].values[0];
    expect(row).toEqual([r.body.answer, 'zh']);
  });

  it('the account setting, the request and an explicit "in English" pick English', async () => {
    const put = await as(ME)('PUT', '/api/profile/ask-claude-language', { ask_claude_language: 'en' });
    expect(put.body).toEqual({ ask_claude_language: 'en' });
    answerFor = () => textReply('**Bank**: a place for money.');
    let r = await as(ME)('POST', '/api/notes/n-1/ask', { question: 'What does it mean?', quick: true });
    expect(r.body.answer_lang).toBe('en');
    expect(r.body.answer).toBe('**Bank**: a place for money.');
    expect(askCalls()[0].system).not.toContain('ENTIRELY in simple Chinese');

    // The sheet's own choice wins over the account's.
    r = await as(ME)('POST', '/api/notes/n-1/ask', { question: '什么意思？', language: 'zh', quick: true });
    expect(r.body.answer_lang).toBe('zh');

    // Back to the default (Chinese), then "in English please" for one turn.
    await as(ME)('PUT', '/api/profile/ask-claude-language', { ask_claude_language: null });
    r = await as(ME)('POST', '/api/notes/n-1/ask', { question: 'Can you explain it in English please?', quick: true });
    expect(r.body.answer_lang).toBe('en');
    expect((await as(ME)('PUT', '/api/profile/ask-claude-language', { ask_claude_language: 'fr' })).status).toBe(400);
  });

  it("checks the learner's Chinese question like a chat message and returns the result with the answer", async () => {
    const r = await as(ME)('POST', '/api/notes/n-1/ask', { question: '银行是什么意？' });
    expect(checkCalls()).toHaveLength(1);
    expect(r.body.question_check_pending).toBe(false);
    expect(r.body.question_check.status).toBe('improvable');
    expect(r.body.question_check.text).toBe('银行是什么意？');
    // Stored on the row and served by GET.
    const got = await as(ME)('GET', `/api/note-questions/${r.body.id}`);
    expect(got.body.question_check.corrected).toBe('银行是什么意思？');
  });

  it('no check for English questions, quick chips or with the auto-check switched off', async () => {
    await as(ME)('POST', '/api/notes/n-1/ask', { question: 'What does this mean in a sentence?' });
    await as(ME)('POST', '/api/notes/n-1/ask', { question: '请用这个词造几个简单的句子。', quick: true });
    db.raw.run('UPDATE users SET chat_auto_check = 0 WHERE id = ?', [ME]);
    const r = await as(ME)('POST', '/api/notes/n-1/ask', { question: '银行是什么意？' });
    expect(checkCalls()).toHaveLength(0);
    expect(r.body.question_check).toBeNull();
  });

  it('tools still work in Chinese mode: an edit of the card is applied', async () => {
    let turn = 0;
    answerFor = () => {
      turn++;
      if (turn === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'e1', name: 'edit_current_card', input: { english: 'bank (financial)' } }] };
      return textReply('好的，我改了卡片。');
    };
    const r = await as(ME)('POST', '/api/notes/n-1/ask', { question: '英文意思不对', quick: true });
    expect(r.body.toolResults[0]).toMatchObject({ tool: 'edit_current_card', success: true });
    expect(db.raw.exec("SELECT english FROM notes WHERE id = 'n-1'")[0].values[0][0]).toBe('bank (financial)');
    expect(r.body.answer).toBe('好的，我改了卡片。');
  });

  it('word chips and the translation are made on request, cached on the row, and owner-only', async () => {
    answerFor = () => textReply('银行');
    const r = await as(ME)('POST', '/api/notes/n-1/ask', { question: 'hi', quick: true });
    const id = r.body.id;
    const w1 = await as(ME)('POST', `/api/note-questions/${id}/words`, { part: 'answer' });
    expect(w1.body).toEqual({ words: [{ text: '银行', pinyin: 'yínháng', gloss: 'bank' }], cached: false });
    const w2 = await as(ME)('POST', `/api/note-questions/${id}/words`, { part: 'answer' });
    expect(w2.body.cached).toBe(true);
    // The question has no Chinese: no chips, no Claude call.
    const q = await as(ME)('POST', `/api/note-questions/${id}/words`, { part: 'question' });
    expect(q.body.words).toBeNull();
    const t1 = await as(ME)('POST', `/api/note-questions/${id}/translate`, { part: 'answer' });
    expect(t1.body).toEqual({ translation: 'A bank is where money is kept.', cached: false });
    expect((await as(ME)('POST', `/api/note-questions/${id}/translate`, { part: 'answer' })).body.cached).toBe(true);
    expect((await as(ME)('POST', `/api/note-questions/${id}/translate`, { part: 'question' })).status).toBe(400);
    expect((await as(ME)('POST', `/api/note-questions/${id}/words`, { part: 'nope' })).status).toBe(400);
    const got = await as(ME)('GET', `/api/note-questions/${id}`);
    expect(got.body.answer_words).toHaveLength(1);
    expect(got.body.answer_translation).toBe('A bank is where money is kept.');
    expect((await as(OTHER)('GET', `/api/note-questions/${id}`)).status).toBe(404);
    expect((await as(OTHER)('POST', `/api/note-questions/${id}/words`, { part: 'answer' })).status).toBe(404);
  });
});
