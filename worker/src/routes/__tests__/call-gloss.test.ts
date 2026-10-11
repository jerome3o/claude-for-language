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
import { resetBoardGlossState, cachedGloss, BOARD_GLOSS_RATE_PER_MIN, BOARD_GLOSS_MAX_TOKENS, glossBoardText } from '../../services/calls/gloss';
import { GLOSS_CACHE_VERSION, glossStoreKey } from '@shared/calls';
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

  it('glosses Chinese for a member with Sonnet (forced tool, thinking off, small budget) and caches it', async () => {
    create.mockResolvedValueOnce(toolReply({ pinyin: 'wǒ xiǎng hē kāfēi', english: 'I want to drink coffee.' }));
    const post = makeApp(db, { id: 's1' });
    const res = await post('c1', { text: '我想喝咖啡' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '我想喝咖啡', direction: 'zh', pinyin: 'wǒ xiǎng hē kāfēi', english: 'I want to drink coffee', cached: false });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toMatch(/sonnet/);
    // The prompt teaches the context readings and the neutral tones.
    expect(params.system).toMatch(/银行 yínháng/);
    expect(params.system).toMatch(/Neutral tones/);
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'gloss' });
    expect(params.max_tokens).toBeLessThanOrEqual(BOARD_GLOSS_MAX_TOKENS);
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
    expect((await post('c1', { text: 'hello', direction: 'zh' })).status).toBe(400);
    expect((await post('c1', { text: '你好', direction: 'en' })).status).toBe(400);
    expect((await post('c1', { text: 'a', direction: 'en' })).status).toBe(400);
    expect((await post('c1', { text: '你好', direction: 'fr' })).status).toBe(400);
    expect((await post('c1', { text: '' })).status).toBe(400);
    expect((await post('c1', { text: '你好\n谢谢' })).status).toBe(400);
    expect((await post('c1', { text: '我'.repeat(80) })).status).toBe(400);
    expect((await post('c1', {})).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('English → Chinese + pinyin (direction en, or inferred from a text without Chinese)', async () => {
    create.mockResolvedValueOnce(toolReply({ chinese: '洗澡。', pinyin: 'xǐ zǎo' }));
    const post = makeApp(db, { id: 's1' });
    const res = await post('c1', { text: 'to take a shower', direction: 'en' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'to take a shower', direction: 'en', chinese: '洗澡', pinyin: 'xǐ zǎo', cached: false });
    const params = create.mock.calls[0][0];
    expect(params.model).toMatch(/sonnet/);
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'gloss' });
    expect(params.tools[0].input_schema.required).toEqual(['chinese', 'pinyin']);
    expect(params.messages[0].content).toBe('to take a shower');

    // No direction: a text without Chinese is English. Cached from the first answer.
    const again = await post('c1', { text: 'to take a shower' });
    expect(await again.json()).toMatchObject({ direction: 'en', chinese: '洗澡', cached: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("checks the English answer's pinyin against its Chinese too (一 / 不 rule, wrong readings)", async () => {
    create.mockResolvedValueOnce(toolReply({ chinese: '一起去银行', pinyin: 'yīqǐ qù yínxìng' }));
    const res = await makeApp(db, { id: 's1' })('c1', { text: 'go to the bank together', direction: 'en' });
    expect(await res.json()).toMatchObject({ chinese: '一起去银行', pinyin: 'yìqǐ qù yínháng' });
  });

  it("replaces a reading the character never has with the dictionary's (pinyin-pro without the asset dictionary)", async () => {
    create.mockResolvedValueOnce(toolReply({ pinyin: 'tā zhāngdà lè', english: 'He grew up' }));
    const res = await makeApp(db, { id: 's1' })('c1', { text: '他长大了' });
    expect(await res.json()).toMatchObject({ pinyin: 'tā zhǎngdà le', english: 'He grew up' });
    // A left-out syllable: the whole line from the dictionary.
    create.mockResolvedValueOnce(toolReply({ pinyin: 'wǒ hē kāfēi', english: 'I want to drink coffee' }));
    const res2 = await makeApp(db, { id: 's1' })('c1', { text: '我想喝咖啡' });
    expect(((await res2.json()) as { pinyin: string }).pinyin.replace(/ /g, '')).toBe('wǒxiǎnghēkāfēi');
  });

  it('caches per rules version and direction (old glosses are never served)', async () => {
    expect(GLOSS_CACHE_VERSION).toBeGreaterThanOrEqual(2);
    expect(glossStoreKey('你好', 'zh')).toBe(`v${GLOSS_CACHE_VERSION}:zh:你好`);
    create.mockResolvedValueOnce(toolReply({ pinyin: 'nǐ hǎo', english: 'hello' }));
    await makeApp(db, { id: 's1' })('c1', { text: '你好' });
    expect(cachedGloss('你好', 'zh')).toEqual({ pinyin: 'nǐ hǎo', english: 'hello' });
    expect(cachedGloss('你好', 'en')).toBeNull();
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
    await expect(glossBoardText('k', '好', { client: fake as never })).resolves.toEqual({ pinyin: 'hǎo', english: 'good' });
  });
});
