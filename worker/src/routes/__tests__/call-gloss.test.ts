import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Claude is mocked at the SDK: structuredCall builds `new Anthropic(...)` and
// calls messages.create — we answer with a forced tool reply (or an error).
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
  }
  class FakeAnthropic {
    static APIError = APIError;
    messages = { create };
  }
  return { default: FakeAnthropic, APIError };
});

import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import calls from '../calls';
import { resetBoardGlossState, BOARD_GLOSS_RATE_PER_MIN, glossBoardText } from '../../services/calls/gloss';
import type { Env } from '../../types';

const toolReply = (input: unknown, stop_reason = 'tool_use') => ({
  stop_reason,
  usage: { output_tokens: 12 },
  content: [{ type: 'tool_use', id: 't', name: 'gloss', input }],
});

function makeApp(db: SqliteD1, user: { id: string } | null, key = 'k') {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    await next();
  });
  app.route('/api', calls);
  const env = { DB: db, ANTHROPIC_API_KEY: key } as unknown as Env;
  return (callId: string, body: unknown) =>
    app.request(`/api/calls/${callId}/gloss`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
}

describe('POST /api/calls/:id/gloss', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    create.mockReset();
    resetBoardGlossState();
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('t1', 't@x.test', 'Tutor'), ('s1', 's@x.test', 'Student'), ('o1', 'o@x.test', 'Other')");
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r1', 't1', 's1', 'tutor', 'active')");
    db.raw.run("INSERT INTO calls (id, relationship_id, created_by) VALUES ('c1', 'r1', 't1')");
  });

  it('glosses Chinese for a member with Haiku (forced tool, thinking off, small budget) and caches it', async () => {
    create.mockResolvedValueOnce(toolReply({ pinyin: 'wǒ xiǎng hē kāfēi', english: 'I want to drink coffee.' }));
    const post = makeApp(db, { id: 's1' });
    const res = await post('c1', { text: '我想喝咖啡' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '我想喝咖啡', pinyin: 'wǒ xiǎng hē kāfēi', english: 'I want to drink coffee', cached: false });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toMatch(/haiku/);
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'gloss' });
    expect(params.max_tokens).toBeLessThanOrEqual(300);
    expect(params.messages[0].content).toBe('我想喝咖啡');

    // Same text again (the other member, too): from the cache, no Claude call.
    const again = await makeApp(db, { id: 't1' })('c1', { text: ' 我想喝咖啡 ' });
    expect(await again.json()).toMatchObject({ pinyin: 'wǒ xiǎng hē kāfēi', cached: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('flattens a reply with line breaks to one line', async () => {
    create.mockResolvedValueOnce(toolReply({ pinyin: 'nǐ\nhǎo', english: 'hello\r\nthere' }));
    const res = await makeApp(db, { id: 's1' })('c1', { text: '你好' });
    expect(await res.json()).toMatchObject({ pinyin: 'nǐ hǎo', english: 'hello there' });
  });

  it('retries once when the reply is unusable, then gives up quietly (503)', async () => {
    create.mockResolvedValueOnce(toolReply({ pinyin: '', english: '' })).mockResolvedValueOnce(toolReply({ pinyin: 'xièxie', english: 'thank you' }));
    const ok = await makeApp(db, { id: 's1' })('c1', { text: '谢谢' });
    expect(await ok.json()).toMatchObject({ pinyin: 'xièxie', english: 'thank you' });
    expect(create).toHaveBeenCalledTimes(2);

    create.mockReset();
    create.mockResolvedValue(toolReply({ pinyin: '你好', english: 'x' }));
    const bad = await makeApp(db, { id: 's1' })('c1', { text: '再见' });
    expect(bad.status).toBe(503);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('only for members of the call', async () => {
    const res = await makeApp(db, { id: 'o1' })('c1', { text: '你好' });
    expect(res.status).toBe(404);
    expect((await makeApp(db, { id: 's1' })('nope', { text: '你好' })).status).toBe(404);
    expect((await makeApp(db, null)('c1', { text: '你好' })).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses text that is not a short Chinese run', async () => {
    const post = makeApp(db, { id: 's1' });
    expect((await post('c1', { text: 'hello' })).status).toBe(400);
    expect((await post('c1', { text: '' })).status).toBe(400);
    expect((await post('c1', { text: '你好\n谢谢' })).status).toBe(400);
    expect((await post('c1', { text: '我'.repeat(80) })).status).toBe(400);
    expect((await post('c1', {})).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('503 without an API key', async () => {
    expect((await makeApp(db, { id: 's1' }, '')('c1', { text: '你好' })).status).toBe(503);
  });

  it('rate-limits each user', async () => {
    create.mockResolvedValue(toolReply({ pinyin: 'yī', english: 'one' }));
    const post = makeApp(db, { id: 's1' });
    const statuses: number[] = [];
    for (let i = 0; i <= BOARD_GLOSS_RATE_PER_MIN; i++) {
      // A different text each time so the cache can't answer.
      statuses.push((await post('c1', { text: `一${String.fromCodePoint(0x4e00 + i + 1)}` })).status);
    }
    expect(statuses.slice(0, BOARD_GLOSS_RATE_PER_MIN).every((s) => s === 200)).toBe(true);
    expect(statuses[BOARD_GLOSS_RATE_PER_MIN]).toBe(429);
    // Another user is not affected.
    expect((await makeApp(db, { id: 't1' })('c1', { text: '好的' })).status).toBe(200);
  });
});

describe('glossBoardText', () => {
  it('uses the client given (test seam)', async () => {
    const fake = { messages: { create: vi.fn(async () => toolReply({ pinyin: 'hǎo', english: 'good' })) } };
    await expect(glossBoardText('k', '好', fake as never)).resolves.toEqual({ pinyin: 'hǎo', english: 'good' });
  });
});
