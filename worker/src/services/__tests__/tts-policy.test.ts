import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateTTSDetailed, generateTTS, generateConversationTTS } from '../audio';
import type { Env } from '../../types';

/**
 * The provider policy (docs/AUDIO.md): stored clips are MiniMax only, made with
 * speech-2.8-hd / Radio Host; a rate limit (1002, 1039, HTTP 429) is never
 * retried inside the request and never falls back to Google — the caller
 * requeues; every call asks the shared limiter first and reports back.
 */

type Call = { url: string; body: any };
let calls: Call[];
let minimaxResponses: Array<() => Response | Promise<Response>>;
let googleResponses: Array<() => Response>;
let stored: Array<{ key: string; bytes: number }>;
let limiterCalls: string[];
let limiterGrants: boolean;

const MINIMAX_HEX = 'fffb9064' + '00'.repeat(32);
const GOOGLE_B64 = btoa(String.fromCharCode(0xff, 0xf3, 0x64, 0x64, ...new Array(32).fill(0)));

const minimaxOk = () =>
  new Response(JSON.stringify({ data: { audio: MINIMAX_HEX }, base_resp: { status_code: 0, status_msg: 'success' } }), { status: 200 });
const minimaxCode = (code: number) => () =>
  new Response(JSON.stringify({ data: {}, base_resp: { status_code: code, status_msg: 'x' } }), { status: 200 });
const googleOk = () => new Response(JSON.stringify({ audioContent: GOOGLE_B64 }), { status: 200 });

function env(overrides: Partial<Env> = {}, withLimiter = true): Env {
  const limiter = {
    acquire: async (p: string) => {
      limiterCalls.push(`acquire:${p}`);
      return limiterGrants ? { granted: true, retryAfterMs: 0, remaining: 3 } : { granted: false, retryAfterMs: 4000, remaining: 0 };
    },
    report: async (o: string) => {
      limiterCalls.push(`report:${o}`);
    },
  };
  return {
    MINIMAX_API_KEY: 'mm-key',
    GOOGLE_TTS_API_KEY: 'g-key',
    AUDIO_BUCKET: {
      put: async (key: string, data: ArrayBuffer) => {
        stored.push({ key, bytes: data.byteLength });
      },
    },
    ...(withLimiter ? { TTS_LIMITER: { idFromName: () => 'id', get: () => limiter } } : {}),
    ...overrides,
  } as unknown as Env;
}

beforeEach(() => {
  calls = [];
  minimaxResponses = [];
  googleResponses = [];
  stored = [];
  limiterCalls = [];
  limiterGrants = true;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const queue = url.includes('minimax') ? minimaxResponses : googleResponses;
    const next = queue.shift();
    if (!next) throw new Error(`unexpected call to ${url}`);
    return next();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const minimaxCalls = () => calls.filter((c) => c.url.includes('minimax')).length;
const googleCalls = () => calls.filter((c) => c.url.includes('googleapis')).length;

async function run<T>(p: Promise<T>): Promise<T> {
  const settled = p.then((v) => v);
  await vi.runAllTimersAsync();
  return settled;
}

describe('stored clips: MiniMax only, through the limiter', () => {
  it('makes the clip with speech-2.8-hd, Radio Host, 0.6, the pinned encode', async () => {
    minimaxResponses.push(minimaxOk);
    const out = await run(generateTTSDetailed(env(), '你好', 'n1'));
    expect(out).toMatchObject({ ok: true, result: { provider: 'minimax', model: 'speech-2.8-hd', voice: 'Chinese (Mandarin)_Radio_Host', speed: 0.6 } });
    expect(calls[0].body).toMatchObject({
      model: 'speech-2.8-hd',
      voice_setting: { voice_id: 'Chinese (Mandarin)_Radio_Host', speed: 0.6 },
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
    });
    expect(stored).toHaveLength(1);
    expect(limiterCalls).toEqual(['acquire:interactive', 'report:ok']);
  });

  it.each([1002, 1039])('MiniMax %i (rate limit): one call, no retry, no Google, nothing stored, limiter told', async (code) => {
    minimaxResponses.push(minimaxCode(code));
    const out = await run(generateTTSDetailed(env(), '你好', 'n1'));
    expect(out).toMatchObject({ ok: false, rateLimited: true, permanent: false, retryAfterMs: 60_000 });
    expect(minimaxCalls()).toBe(1);
    expect(googleCalls()).toBe(0);
    expect(stored).toEqual([]);
    expect(limiterCalls).toEqual(['acquire:interactive', 'report:rate_limited']);
  });

  it('HTTP 429 is a rate limit too', async () => {
    minimaxResponses.push(() => new Response('slow down', { status: 429 }));
    const out = await run(generateTTSDetailed(env(), '你好', 'n1', { priority: 'batch' }));
    expect(out).toMatchObject({ ok: false, rateLimited: true });
  });

  it('the limiter saying no means no MiniMax call at all', async () => {
    limiterGrants = false;
    const out = await run(generateTTSDetailed(env(), '你好', 'n1', { priority: 'batch' }));
    expect(out).toMatchObject({ ok: false, rateLimited: true, reason: 'limiter', retryAfterMs: 4000 });
    expect(minimaxCalls()).toBe(0);
  });

  it('a network blip: interactive tries once more, batch leaves it to the queue', async () => {
    minimaxResponses.push(() => Promise.reject(new Error('reset')), minimaxOk);
    expect(await run(generateTTS(env(), '你好', 'n1'))).not.toBeNull();
    expect(minimaxCalls()).toBe(2);

    calls = [];
    minimaxResponses.push(() => Promise.reject(new Error('reset')));
    const out = await run(generateTTSDetailed(env(), '你好', 'n1', { priority: 'batch' }));
    expect(out).toMatchObject({ ok: false, rateLimited: false, permanent: false });
    expect(minimaxCalls()).toBe(1);
  });

  it('a bad key is an ACCOUNT problem (pause, not a clip failure) and still never Google', async () => {
    minimaxResponses.push(minimaxCode(1004));
    const out = await run(generateTTSDetailed(env(), '你好', 'n1'));
    expect(out).toMatchObject({ ok: false, permanent: false, rateLimited: true, account: 1004 });
    expect(minimaxCalls()).toBe(1);
    expect(googleCalls()).toBe(0);
    expect(limiterCalls).toEqual(['acquire:interactive', 'report:account_error']);
  });

  it('no MiniMax key: no clip (no Google fallback); an old client asking for Google gets MiniMax', async () => {
    expect(await run(generateTTS(env({ MINIMAX_API_KEY: '' }), '你好', 'n1'))).toBeNull();
    expect(googleCalls()).toBe(0);
    minimaxResponses.push(minimaxOk);
    const result = await run(generateTTS(env(), '你好', 'n1', { preferProvider: 'gtts' }));
    expect(result?.provider).toBe('minimax');
    expect(googleCalls()).toBe(0);
  });

  it('runs without a limiter binding (tests, a broken deploy)', async () => {
    minimaxResponses.push(minimaxOk);
    expect(await run(generateTTS(env({}, false), '你好', 'n1'))).not.toBeNull();
  });
});

describe('ephemeral conversation audio', () => {
  it('without allowGoogleFallback: no Google at all (anything a device keeps waits for MiniMax)', async () => {
    minimaxResponses.push(minimaxCode(2053));
    const out = await run(generateConversationTTS(env(), '你好'));
    expect(out).toBeNull();
    expect(googleCalls()).toBe(0);
  });

  it('live playback may still use Google in the moment (never stored)', async () => {
    minimaxResponses.push(minimaxCode(1002));
    googleResponses.push(googleOk);
    const out = await run(generateConversationTTS(env(), '你好', { allowGoogleFallback: true }));
    expect(out?.provider).toBe('gtts');
    expect(stored).toEqual([]);
    expect(calls.find((c) => c.url.includes('googleapis'))!.url).not.toContain('key=');
  });
});
