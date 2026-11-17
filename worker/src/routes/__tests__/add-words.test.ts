import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import add from '../add-words';
import { costGroupFor } from '../../middleware/cost-guard';
import { cleanCandidates, parseOcrAnswer, readChineseFromPhoto, OCR_PROMPT } from '../../services/add-words';

/** The routes behind a stand-in auth middleware (user u1). */
function app() {
  const a = new Hono<{ Variables: { user: { id: string } } }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: 'u1' });
    await next();
  });
  a.route('/', add as never);
  return a;
}

/** The first bytes of a PNG (enough for the sniffer): 8-byte signature, IHDR with 2×2. */
function png(extra = 0): Uint8Array {
  const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0];
  const out = new Uint8Array(head.length + extra);
  out.set(head);
  return out;
}

const ocr = (body: BodyInit, env: Record<string, unknown>, headers: Record<string, string> = { 'content-type': 'image/png' }) =>
  app().request('/ocr/words', { method: 'POST', body, headers }, env);

describe('POST /ocr/words', () => {
  it('is in the cost guard\'s ai group', () => {
    expect(costGroupFor('POST', '/api/ocr/words')).toBe('ai');
    expect(costGroupFor('POST', '/api/ai/english-words')).toBe('ai');
    expect(costGroupFor('POST', '/api/custom-lessons/generate')).toBe('jobs');
  });

  it('answers with the stand-in in E2E_TEST_MODE, the subtitle first', async () => {
    const res = await ocr(png(), { E2E_TEST_MODE: 'true', GEMINI_API_KEY: 'real-key' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: Array<{ text: string; box: number[] | null; main: boolean }> };
    expect(body.lines[0]).toMatchObject({ text: '太体面了', main: true });
    expect(body.lines.map((l) => l.text)).not.toContain('Share screen');
    expect(body.lines.every((l) => /\p{Script=Han}/u.test(l.text))).toBe(true);
  });

  it('refuses no photo, other types and big uploads', async () => {
    expect((await ocr(new Uint8Array(0), { E2E_TEST_MODE: 'true' })).status).toBe(400);
    expect((await ocr(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), { E2E_TEST_MODE: 'true' }, { 'content-type': 'image/svg+xml' })).status).toBe(415);
    expect((await ocr(png(4 * 1024 * 1024 + 10), { E2E_TEST_MODE: 'true' })).status).toBe(413);
  });

  it('accepts multipart `picture`', async () => {
    const form = new FormData();
    form.append('picture', new Blob([png()], { type: 'image/png' }), 'p.png');
    const res = await app().request('/ocr/words', { method: 'POST', body: form }, { E2E_TEST_MODE: 'true' });
    expect(res.status).toBe(200);
  });

  it('says so when photo reading is not set up', async () => {
    const res = await ocr(png(), {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: false });
  });
});

describe('readChineseFromPhoto', () => {
  it('sends the photo once with least thinking and orders the lines', async () => {
    const answer = JSON.stringify({
      lines: [
        { text: 'Chrome 新标签页', box_2d: [10, 10, 40, 300], main: false },
        { text: '太 体 面 了', box_2d: [700, 350, 780, 650], main: true },
        { text: 'Mute', box_2d: [950, 10, 980, 80], main: false },
      ],
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }), { status: 200 }));
    const result = await readChineseFromPhoto('k', png(), 'image/png', { fetch });
    expect(result.lines.map((l) => l.text)).toEqual(['太体面了', '新标签页']);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(':generateContent');
    expect(url).not.toContain('k=');
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe('image/png');
    expect(body.contents[0].parts[1].text).toBe(OCR_PROMPT);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('parses fenced or bare answers', () => {
    expect(parseOcrAnswer('```json\n{"lines":[{"text":"你好"}]}\n```')).toEqual([{ text: '你好', box: null, main: false }]);
    expect(parseOcrAnswer('[{"text":"你好","box_2d":[1,2,3,4],"main":true}]')).toEqual([{ text: '你好', box: [1, 2, 3, 4], main: true }]);
    expect(parseOcrAnswer('{"lines":[]}')).toEqual([]);
    expect(() => parseOcrAnswer('not json')).toThrow();
  });
});

describe('POST /ai/english-words', () => {
  const post = (body: unknown, env: Record<string, unknown>) =>
    app().request('/ai/english-words', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);

  it('answers with the stand-in in E2E_TEST_MODE', async () => {
    const res = await post({ text: 'bank' }, { E2E_TEST_MODE: 'true' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }] });
  });

  it('refuses an empty or long text, and says so without Claude', async () => {
    expect((await post({ text: ' ' }, { E2E_TEST_MODE: 'true' })).status).toBe(400);
    expect((await post({ text: 'x'.repeat(200) }, { E2E_TEST_MODE: 'true' })).status).toBe(400);
    expect((await post({ text: 'bank' }, {})).status).toBe(503);
  });

  it('keeps clean candidates only, with the 一 / 不 tone changes', () => {
    expect(
      cleanCandidates({
        words: [
          { hanzi: '一样', pinyin: 'yīyàng', english: 'the same' },
          { hanzi: '你好/您好', pinyin: 'x', english: 'hi' },
          { hanzi: 'hello', pinyin: '', english: '' },
          { hanzi: '一样', pinyin: 'yíyàng', english: 'dup' },
        ],
      }),
    ).toEqual([{ hanzi: '一样', pinyin: 'yíyàng', english: 'the same' }]);
    expect(() => cleanCandidates({ words: [] })).toThrow();
  });
});

describe('POST /custom-lessons/generate', () => {
  it('needs a prompt and Claude', async () => {
    const post = (body: unknown, env: Record<string, unknown>) =>
      app().request('/custom-lessons/generate', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);
    expect((await post({ prompt: '' }, { E2E_TEST_MODE: 'true' })).status).toBe(400);
    expect((await post({ prompt: 'ordering coffee' }, {})).status).toBe(503);
  });
});
