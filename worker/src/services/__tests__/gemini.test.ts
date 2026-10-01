import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GEMINI_FLASH_MODELS, GEMINI_IMAGE_MODELS, GeminiError, geminiErrorMessage, geminiGenerateContent, leastThinking, modelOrder,
  resetGeminiModelMemory,
} from '../gemini';
import { transcribeWithGemini } from '../calls/transcribe';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, message: string) => new Response(JSON.stringify({ error: { code: status, message } }), { status });
const modelOf = (url: string) => url.split('/models/')[1].split(':')[0];

describe('gemini models', () => {
  beforeEach(() => resetGeminiModelMemory());

  it('lists current models first and keeps the 2.5 family only as the last resort', () => {
    expect(GEMINI_FLASH_MODELS[0]).not.toMatch(/2\.5/);
    expect(GEMINI_FLASH_MODELS.at(-1)).toBe('gemini-2.5-flash');
    expect(GEMINI_IMAGE_MODELS[0]).not.toMatch(/2\.5/);
  });

  it('picks the least thinking each family allows', () => {
    expect(leastThinking('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
    expect(leastThinking('gemini-3.6-flash')).toEqual({ thinkingLevel: 'minimal' });
    expect(leastThinking('gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' });
    expect(leastThinking('something-else')).toBeUndefined();
  });

  it('404 → next model → success; the answering model is remembered', async () => {
    const fetch = vi.fn(async (url: string) => (modelOf(url) === 'a' ? fail(404, 'models/a is not found for API version v1beta') : ok({ hi: modelOf(url) })));
    const call = { apiKey: 'k', models: ['a', 'b', 'c'], body: (m: string) => ({ m }), fetch };
    expect(await geminiGenerateContent(call)).toEqual({ data: { hi: 'b' }, model: 'b' });
    expect(fetch.mock.calls.map(([u]) => modelOf(u))).toEqual(['a', 'b']);
    expect(modelOrder(['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
    expect(modelOrder(['a', 'b', 'c'], 'z')).toEqual(['z', 'b', 'a', 'c']);
    fetch.mockClear();
    await geminiGenerateContent(call);
    expect(fetch.mock.calls.map(([u]) => modelOf(u))).toEqual(['b']);
  });

  it("a 400 about the thinking setting also moves on; other failures stop with Google's message", async () => {
    const fetch = vi.fn(async (url: string) =>
      modelOf(url) === 'a' ? fail(400, 'Thinking level minimal is not supported for this model.') : fail(429, 'Resource has been exhausted (e.g. check quota).'));
    const err = await geminiGenerateContent({ apiKey: 'k', models: ['a', 'b', 'c'], body: () => ({}), fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err).toMatchObject({ status: 429, model: 'b', tried: ['a', 'b'] });
    expect(err.message).toBe('Gemini 429: Resource has been exhausted (e.g. check quota).');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never puts the key in the URL or the message', async () => {
    const key = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012';
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => fail(404, `bad request ?key=${key} x`));
    const err = await geminiGenerateContent({ apiKey: key, models: ['a'], body: () => ({}), fetch }).catch((e) => e);
    expect(fetch.mock.calls[0][0]).not.toContain('AIza');
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-goog-api-key')).toBe(key);
    expect(err.message).not.toContain('AIzaSyABC');
    expect(geminiErrorMessage('plain text failure')).toBe('plain text failure');
  });

  it('call transcription falls back too, with the override tried first', async () => {
    const segments = JSON.stringify([{ start: '00:01', end: '00:03', text: '你好', language: 'zh' }]);
    const fetch = vi.fn(async (url: string) =>
      GEMINI_FLASH_MODELS.slice(0, 2).includes(modelOf(url)) || modelOf(url) === 'gone-model'
        ? fail(404, `models/${modelOf(url)} is not found`)
        : ok({ candidates: [{ content: { parts: [{ text: segments }] } }] }));
    const out = await transcribeWithGemini('k', new Uint8Array([1, 2, 3]), 'audio/webm', 'gone-model', fetch);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('你好');
    expect(fetch.mock.calls.map(([u]) => modelOf(u))).toEqual(['gone-model', GEMINI_FLASH_MODELS[0], GEMINI_FLASH_MODELS[1], GEMINI_FLASH_MODELS[2]]);
  });
});
