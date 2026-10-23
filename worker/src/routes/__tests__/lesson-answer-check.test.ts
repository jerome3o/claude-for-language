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
import lessonAttempts, { checkAttemptSpeaking } from '../lesson-attempts';
import { ANSWER_CHECK_FIXTURES, SPEAKING_FIXTURE, fakeAnswerCheckClient } from '../../services/answer-check-fake';
import {
  answerCheckUserTurn, checkLessonAnswer, runAnswerCheck, ANSWER_CHECK_SYSTEM, SPEAKING_CHECK_SYSTEM, ANSWER_CHECK_FALLBACK_MODEL,
} from '../../services/answer-check';
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

describe('free speaking (oral_expression / speak)', () => {
  let db: SqliteD1;
  let post: ReturnType<typeof client>;
  const speaking = (extra: Record<string, unknown> = {}) => ({
    prompt_en: SPEAKING_FIXTURE.prompt, model_answer: '', answer: SPEAKING_FIXTURE.transcript, exercise_type: 'oral_expression',
    input: 'spoken', hints: ['就是', '就在', '关于'], ...extra,
  });

  beforeEach(async () => {
    db = await createSqliteD1();
    post = client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env);
  });

  it('the Annie answer: all four parts, 是关于…的 with a slip, a cleaner version, tips with the better words + pinyin', async () => {
    const r = await post('/lessons/answer-check', speaking());
    expect(r.status).toBe(200);
    const c = r.json.check;
    expect(c.verdict).toBe('acceptable');
    expect(c.suggested).toBe('got_it');
    expect(c.cleaned).not.toContain('sorry');
    expect(c.cleaned).not.toContain('wait');
    expect(c.corrected).toContain('是关于下个月的活动的');
    expect(c.corrected_pinyin).toMatch(/guān ?yú/);
    expect(c.cleaned_pinyin).toMatch(/nǐ hǎo/);
    expect(c.parts.map((p: { status: string }) => p.status)).toEqual(['used', 'used', 'used_with_issue', 'used']);
    expect(c.tips[0]).toMatchObject({ quote: '是关于下个月的活动', fix: '是关于下个月的活动的' });
    expect(c.cleaned_pinyin).toContain('Annie ba?');
    expect(c.tips[0].fix_pinyin).toMatch(/huó ?dòng de$/);
    const again = await post('/lessons/answer-check', speaking({ answer: SPEAKING_FIXTURE.transcript.replace(/[，。？！]/g, ' ') }));
    expect(again.json.cached).toBe(true);
  });

  it('takes a long transcript (up to 1500 characters) without a model answer', async () => {
    const r = await post('/lessons/answer-check', speaking({ answer: '我们团队最近很忙。'.repeat(150), exercise_type: 'speak' }));
    expect(r.status).toBe(200);
    expect(r.json.check.cleaned.length).toBeGreaterThan(300);
  });

  it('the prompt: gracious, punctuation ignored, numbered parts listed, the larger model first', async () => {
    expect(SPEAKING_CHECK_SYSTEM).toMatch(/false starts/);
    expect(SPEAKING_CHECK_SYSTEM).toMatch(/PUNCTUATION/);
    expect(SPEAKING_CHECK_SYSTEM).toMatch(/在\/再/);
    expect(SPEAKING_CHECK_SYSTEM).toMatch(/at most 4/);
    const turn = answerCheckUserTurn({ ...speaking(), question: '她是谁？' } as never);
    expect(turn).toContain('① 就是…吧 — Guess who she is');
    expect(turn).toContain('④ 形容词 + 到… — how busy the team is');
    expect(turn).toContain('Useful words shown: 就是、就在、关于');
    expect(turn).toContain('Question played to them in Chinese: 她是谁？');
    expect(turn).not.toContain('One way to say it');
    const seen: Array<{ model: string; tool: string }> = [];
    const spy = {
      messages: {
        create: async (p: { model: string; tool_choice: { name: string } }) => {
          seen.push({ model: p.model, tool: p.tool_choice.name });
          return fakeAnswerCheckClient().messages.create(p as never);
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    await runAnswerCheck(speaking() as never, { apiKey: 'k', client: spy });
    expect(seen).toEqual([{ model: ANSWER_CHECK_FALLBACK_MODEL, tool: 'check_speaking' }]);
  });

  it('a recording uploaded later (made offline) is checked server-side and the check lands in the attempt', async () => {
    await db.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)').bind('user-1', 'u@example.com', 'U', 'student').run();
    const spec = { title: 'At the office', sections: [{ title: 's', exercises: [{ type: 'oral_expression', prompt: SPEAKING_FIXTURE.prompt, hints: [{ hanzi: '就是' }] }] }] };
    await db.prepare('INSERT INTO custom_lessons (id, user_id, title, spec) VALUES (?, ?, ?, ?)').bind('lesson-1', 'user-1', 'At the office', JSON.stringify(spec)).run();
    const data = { started_at: '', duration_ms: 1, exercises: [{ section: 0, index: 0, type: 'oral_expression', correct: true, points: 1, max_points: 1, duration_ms: 1, answer: { self_assessed: true, recording: { media_key: 'm0', duration_ms: 40000 } } }] };
    await db.prepare('INSERT INTO custom_lesson_attempts (id, user_id, lesson_id, completed_at, duration_ms, spec, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('att-1', 'user-1', 'lesson-1', new Date().toISOString(), 1, JSON.stringify(spec), JSON.stringify(data)).run();
    const env = { DB: db, E2E_TEST_MODE: 'true' } as unknown as Env;
    expect(await checkAttemptSpeaking(env, 'user-1', 'att-1', 'm0', SPEAKING_FIXTURE.transcript)).toBe(true);
    const row = db.rows('SELECT data FROM custom_lesson_attempts WHERE id = ?', ['att-1'])[0] as { data: string };
    const answer = JSON.parse(row.data).exercises[0].answer;
    expect(answer.text).toBe(SPEAKING_FIXTURE.transcript);
    expect(answer.input).toBe('spoken');
    expect(answer.check.parts).toHaveLength(4);
    // Already checked → nothing more.
    expect(await checkAttemptSpeaking(env, 'user-1', 'att-1', 'm0', SPEAKING_FIXTURE.transcript)).toBe(false);
    expect(await checkAttemptSpeaking(env, 'user-2', 'att-1', 'm0', SPEAKING_FIXTURE.transcript)).toBe(false);
  });
});
