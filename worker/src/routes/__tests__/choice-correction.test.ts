/**
 * POST /api/lessons/choice-correction (services/choice-correction.ts): the right version of a "which sentence is
 * wrong?" choice's wrong option, for lessons without `correction` — against real SQLite with every migration and the
 * fake model: the corrected sentence with app pinyin, `unchanged` for a false alarm, the cache shared by everyone (a
 * second ask never reaches the model), 400 / 503 / 502.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import lessonAttempts from '../lesson-attempts';
import { correctChoiceSentence, choiceCorrectionUserTurn } from '../../services/choice-correction';
import { fakeAnswerCheckClient } from '../../services/answer-check-fake';
import type { Env } from '../../types';

function client(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: 'user-1' } as never);
    await next();
  });
  app.route('/api', lessonAttempts);
  return async (body: unknown) => {
    const res = await app.request('/api/lessons/choice-correction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

const ASK = { question: 'Which sentence is wrong?', sentence: '他了去北京。', others: ['我昨天买了一本书。', '我吃了饭。'], explanation: '了 never goes before the verb.' };

describe('POST /api/lessons/choice-correction', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
  });

  it('corrects the wrong sentence with the app pinyin, then serves it from the cache', async () => {
    const post = client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env);
    const first = await post(ASK);
    expect(first.status).toBe(200);
    expect(first.json.correction.hanzi).toBe('他去北京了。');
    expect(first.json.correction.pinyin).toMatch(/^tā qù běi ?jīng le/i);
    expect(first.json.correction.english).toBe('He went to Beijing.');
    expect(first.json.unchanged).toBe(false);
    expect(first.json.cached).toBe(false);
    const again = await post({ ...ASK, others: undefined });
    expect(again.json).toMatchObject({ correction: { hanzi: '他去北京了。' }, cached: true });
  });

  it('a sentence with nothing wrong comes back unchanged', async () => {
    const post = client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env);
    const r = await post({ question: 'Which sentence is wrong?', sentence: '我很好。' });
    expect(r.status).toBe(200);
    expect(r.json.unchanged).toBe(true);
    expect(r.json.correction.hanzi).toBe('我很好。');
  });

  it('400 on a bad body, 503 without a key', async () => {
    expect((await client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env)({ question: 'x' })).status).toBe(400);
    expect((await client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env)({ sentence: 'abc' })).status).toBe(400);
    const r = await client({ DB: db } as unknown as Env)(ASK);
    expect(r.status).toBe(503);
    expect(r.json.retryable).toBe(false);
  });

  it('one model call for everyone; the prompt carries the question, the other options and the explanation', async () => {
    const fake = fakeAnswerCheckClient();
    const create = vi.fn(fake.messages.create);
    const deps = { apiKey: 'k', client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'> };
    const a = await correctChoiceSentence(db, ASK, deps);
    const b = await correctChoiceSentence(db, { question: ASK.question, sentence: ASK.sentence }, deps);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0] as { thinking?: unknown; tool_choice?: { name?: string } };
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.tool_choice?.name).toBe('give_correction');
    const turn = choiceCorrectionUserTurn(ASK);
    expect(turn).toContain('<wrong>他了去北京。</wrong>');
    expect(turn).toContain('- 我吃了饭。');
    expect(turn).toContain('了 never goes before the verb.');
  });

  it('502 when the model declines', async () => {
    const bad = { messages: { create: async () => ({ stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'x', name: 'give_correction', input: { hanzi: '', english: '', already_correct: false } }] }) } };
    await expect(correctChoiceSentence(db, ASK, { apiKey: 'k', client: bad as unknown as Pick<Anthropic, 'messages'> })).rejects.toThrow();
  });
});
