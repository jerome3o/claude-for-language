/**
 * Claude's check of a self-assessed lesson answer (POST /api/lessons/answer-check,
 * services/answer-check.ts) against real SQLite with every migration and the fake model
 * (services/answer-check-fake.ts, Jerome's three real answers): verdicts, the minimal correction
 * with app pinyin, tips quoting the Chinese, the cache (a second ask never reaches the model),
 * the prompt shaping (spoken = lenient), 400 / 503 / 502, and 💬 Ask about this.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import lessonAttempts from '../lesson-attempts';
import { ANSWER_CHECK_FIXTURES, fakeAnswerCheckClient } from '../../services/answer-check-fake';
import { answerCheckUserTurn, checkLessonAnswer, runAnswerCheck, ANSWER_CHECK_SYSTEM } from '../../services/answer-check';
import type { Env } from '../../types';

function client(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: 'user-1' } as never);
    await next();
  });
  app.route('/api', lessonAttempts);
  return async (path: string, body: unknown) => {
    const res = await app.request(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

const [cheap, worry, doctor] = ANSWER_CHECK_FIXTURES;
const body = (f: typeof cheap, extra: Record<string, unknown> = {}) => ({
  prompt_en: f.english, model_answer: f.model, answer: f.answer, exercise_type: 'translate', input: 'spoken', ...extra,
});

describe('POST /api/lessons/answer-check', () => {
  let db: SqliteD1;
  let post: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    post = client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env);
  });

  it('1. 即使便宜，我也不买 → correct, no correction, 即使再便宜 as the alternative', async () => {
    const r = await post('/lessons/answer-check', body(cheap));
    expect(r.status).toBe(200);
    expect(r.json.check.verdict).toBe('correct');
    expect(r.json.check.suggested).toBe('got_it');
    expect(r.json.check.corrected).toBe('');
    expect(r.json.check.alternative.hanzi).toBe('即使再便宜，我也不买。');
    expect(r.json.check.alternative.pinyin).toContain('wǒ yě bù mǎi');
    expect(r.json.cached).toBe(false);
  });

  it('2. 也不着急 → almost, the fix with app pinyin, tips quoting the Chinese', async () => {
    const r = await post('/lessons/answer-check', body(worry));
    const c = r.json.check;
    expect(c.verdict).toBe('almost');
    expect(c.suggested).toBe('missed_it');
    expect(c.corrected).toBe('即使你不记得这些词，也别着急，你就多练习吧。');
    expect(c.corrected_pinyin).toMatch(/bié zháojí/);
    expect(c.tips.map((t: { quote?: string }) => t.quote)).toEqual(['也不着急', '就多练习']);
  });

  it('3. 吃药和好好休息 → almost: 和 can’t join two actions', async () => {
    const r = await post('/lessons/answer-check', body(doctor, { input: 'typed' }));
    expect(r.json.check.verdict).toBe('almost');
    expect(r.json.check.corrected).toBe('医生让我吃药，好好休息。');
    expect(r.json.check.tips[0].quote).toBe('和');
  });

  it('caches by the answer (punctuation-blind): the second ask never reaches the model', async () => {
    await post('/lessons/answer-check', body(worry));
    const again = await post('/lessons/answer-check', body(worry, { answer: '即使你不记得这些词 也不着急 就多练习' }));
    expect(again.json.cached).toBe(true);
    expect(again.json.check.corrected).toBe('即使你不记得这些词，也别着急，你就多练习吧。');
    expect(db.rows('SELECT verdict FROM lesson_answer_checks')).toHaveLength(1);
    // Typed vs spoken is a different check (leniency differs).
    const typed = await post('/lessons/answer-check', body(worry, { input: 'typed' }));
    expect(typed.json.cached).toBe(false);
  });

  it('the model answer itself (the "Exact match" chip) never reaches the model, even without a key', async () => {
    const exact = { prompt_en: 'The station is right opposite my home.', model_answer: '车站就在我家对面。', answer: '车站就在我家对面', exercise_type: 'translate', input: 'spoken' };
    const noKey = client({ DB: db } as unknown as Env);
    const r = await noKey('/lessons/answer-check', exact);
    expect(r.status).toBe(200);
    expect(r.json.local).toBe(true);
    expect(r.json.check).toMatchObject({ verdict: 'correct', suggested: 'got_it', corrected: '', tips: [] });
    expect(db.rows('SELECT * FROM lesson_answer_checks')).toHaveLength(0);
    // One character off is not exact: Claude is asked (here: no key → 503).
    expect((await noKey('/lessons/answer-check', { ...exact, answer: '车站在我家对面' })).status).toBe(503);
  });

  it('400 without an answer in Chinese', async () => {
    const r = await post('/lessons/answer-check', body(cheap, { answer: 'cheap' }));
    expect(r.status).toBe(400);
    expect(r.json.problems).toContain('answer has no Chinese to check');
  });

  it('503 (not retryable) without a key', async () => {
    const r = await client({ DB: db } as unknown as Env)('/lessons/answer-check', body(cheap));
    expect(r.status).toBe(503);
    expect(r.json.retryable).toBe(false);
  });

  it('💬 Ask about this replies with the exercise as context', async () => {
    const r = await post('/lessons/answer-check/ask', { ...body(worry), question: 'Why 别 and not 不?', history: [{ role: 'user', text: 'hi' }] });
    expect(r.status).toBe(200);
    expect(r.json.reply).toContain('别');
    const none = await post('/lessons/answer-check/ask', body(worry));
    expect(none.status).toBe(400);
  });
});

describe('answer check service', () => {
  it('tells the model a spoken answer is a transcript, and never to fault different wording', () => {
    const turn = answerCheckUserTurn({ prompt_en: 'x', model_answer: '你好', answer: '泥好', exercise_type: 'translate', input: 'spoken', focus: '即使…也' });
    expect(turn).toContain('SPOKEN');
    expect(turn).toContain('Lesson focus: 即使…也');
    expect(answerCheckUserTurn({ prompt_en: 'x', model_answer: '你好', answer: '你好', exercise_type: 'translate', input: 'typed' })).toContain('(typed)');
    expect(ANSWER_CHECK_SYSTEM).toMatch(/Never call different-but-valid wording wrong/);
  });

  it('a correct verdict never carries a correction, whatever the model says', async () => {
    const lying = {
      messages: { create: async () => ({ stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'x', name: 'check_answer', input: { verdict: 'acceptable', headline: 'Fine.', corrected: '你好。', tips: [{ text: 'no Chinese quote', quote: 'abc' }] } }] }) },
    } as unknown as Pick<Anthropic, 'messages'>;
    const c = await runAnswerCheck({ prompt_en: 'hello', model_answer: '你好', answer: '您好', exercise_type: 'translate' }, { apiKey: 'k', client: lying });
    expect(c.corrected).toBe('');
    expect(c.tips).toEqual([{ text: 'no Chinese quote' }]);
    expect(c.suggested).toBe('got_it');
  });

  it('a failing model is reported, nothing cached', async () => {
    const db = await createSqliteD1();
    const failing = { messages: { create: vi.fn(async () => { throw new Error('overloaded'); }) } } as unknown as Pick<Anthropic, 'messages'>;
    await expect(checkLessonAnswer(db, { prompt_en: 'hello', model_answer: '你好', answer: '你好', exercise_type: 'translate' }, { apiKey: 'k', client: failing })).rejects.toThrow();
    expect(db.rows('SELECT * FROM lesson_answer_checks')).toHaveLength(0);
    // The fake answers an exact match as correct.
    const ok = await checkLessonAnswer(db, { prompt_en: 'hello', model_answer: '你好', answer: '你好！', exercise_type: 'translate' }, { apiKey: 'k', client: fakeAnswerCheckClient() });
    expect(ok.check.verdict).toBe('correct');
  });
});
