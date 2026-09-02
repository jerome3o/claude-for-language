import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateTTS, classifyMp3 } from '../audio';
import type { Env } from '../../types';

/**
 * The provider policy that produced the "crunchy" audio: MiniMax failing on a
 * rate limit and the clip quietly going to Google instead — a different voice,
 * half the bitrate, time-stretched slow speech — and being stored forever.
 * These pin the replacement policy: retry MiniMax; on a transient failure
 * return nothing so the caller can try again later; Google only when MiniMax
 * is gone for good or was asked for explicitly.
 */

type Call = { url: string; body: unknown };
let calls: Call[];
let minimaxResponses: Array<() => Response>;
let googleResponses: Array<() => Response>;
let stored: Array<{ key: string; bytes: number }>;

// A minimal valid-looking MP3 payload, hex-encoded the way MiniMax returns it.
const MINIMAX_HEX = 'fffb9064' + '00'.repeat(32);
const GOOGLE_B64 = btoa(String.fromCharCode(0xff, 0xf3, 0x64, 0x64, ...new Array(32).fill(0)));

const minimaxOk = () =>
  new Response(JSON.stringify({ data: { audio: MINIMAX_HEX }, base_resp: { status_code: 0, status_msg: 'success' } }), { status: 200 });
const minimaxRateLimited = () =>
  new Response(JSON.stringify({ data: {}, base_resp: { status_code: 1002, status_msg: 'rate limit' } }), { status: 200 });
const minimaxBadKey = () =>
  new Response(JSON.stringify({ data: {}, base_resp: { status_code: 1004, status_msg: 'invalid api key' } }), { status: 200 });
const googleOk = () => new Response(JSON.stringify({ audioContent: GOOGLE_B64 }), { status: 200 });

function env(overrides: Partial<Env> = {}): Env {
  return {
    MINIMAX_API_KEY: 'mm-key',
    GOOGLE_TTS_API_KEY: 'g-key',
    AUDIO_BUCKET: {
      put: async (key: string, data: ArrayBuffer) => {
        stored.push({ key, bytes: data.byteLength });
      },
    },
    ...overrides,
  } as unknown as Env;
}

beforeEach(() => {
  calls = [];
  minimaxResponses = [];
  googleResponses = [];
  stored = [];
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

/** Run generateTTS while draining the retry backoff timers. */
async function run(e: Env, opts?: Parameters<typeof generateTTS>[3]) {
  const promise = generateTTS(e, '你好', 'note-1', opts);
  await vi.runAllTimersAsync();
  return promise;
}

const minimaxCalls = () => calls.filter(c => c.url.includes('minimax')).length;
const googleCalls = () => calls.filter(c => c.url.includes('googleapis')).length;

describe('generateTTS provider policy', () => {
  it('uses MiniMax and pins the encode', async () => {
    minimaxResponses.push(minimaxOk);
    const result = await run(env());

    expect(result?.provider).toBe('minimax');
    expect(googleCalls()).toBe(0);
    const body = calls[0].body as { audio_setting: Record<string, unknown> };
    expect(body.audio_setting).toMatchObject({ sample_rate: 32000, bitrate: 128000, channel: 1 });
  });

  it('retries a rate limit and succeeds without touching Google', async () => {
    minimaxResponses.push(minimaxRateLimited, minimaxRateLimited, minimaxOk);
    const result = await run(env());

    expect(result?.provider).toBe('minimax');
    expect(minimaxCalls()).toBe(3);
    expect(googleCalls()).toBe(0);
  });

  it('returns nothing — not a Google clip — when MiniMax stays rate-limited', async () => {
    minimaxResponses.push(minimaxRateLimited, minimaxRateLimited, minimaxRateLimited);
    const result = await run(env());

    expect(result).toBeNull();
    expect(googleCalls()).toBe(0);
    expect(stored).toHaveLength(0);
  });

  it('treats a network error as transient', async () => {
    minimaxResponses.push(() => { throw new Error('ECONNRESET'); }, minimaxOk);
    const result = await run(env());

    expect(result?.provider).toBe('minimax');
    expect(googleCalls()).toBe(0);
  });

  it('falls back to Google only when MiniMax is permanently unavailable', async () => {
    minimaxResponses.push(minimaxBadKey);
    googleResponses.push(googleOk);
    const result = await run(env());

    expect(result?.provider).toBe('gtts');
    expect(minimaxCalls()).toBe(1); // no point retrying a bad key
  });

  it('falls back to Google when MiniMax is not configured', async () => {
    googleResponses.push(googleOk);
    const result = await run(env({ MINIMAX_API_KEY: '' }));

    expect(result?.provider).toBe('gtts');
    expect(minimaxCalls()).toBe(0);
  });

  it('honours an explicit request for Google', async () => {
    googleResponses.push(googleOk);
    const result = await run(env(), { preferProvider: 'gtts' });

    expect(result?.provider).toBe('gtts');
    expect(minimaxCalls()).toBe(0);
  });

  it('does not send the headphone EQ profile to Google', async () => {
    googleResponses.push(googleOk);
    await run(env(), { preferProvider: 'gtts' });

    const body = calls[0].body as { audioConfig: Record<string, unknown> };
    expect(body.audioConfig.effectsProfileId).toBeUndefined();
  });
});

describe('classifyMp3', () => {
  // MPEG-1 Layer III, 32 kHz: 0xFF 0xFB, sample index 2 → (0x9?) bits 2-3 = 10
  const MINIMAX_FRAME = new Uint8Array([0xff, 0xfb, 0x98, 0x64, 0, 0]);
  // MPEG-2 Layer III, 24 kHz: 0xFF 0xF3, sample index 1 → bits 2-3 = 01
  const GOOGLE_FRAME = new Uint8Array([0xff, 0xf3, 0x64, 0x64, 0, 0]);

  it('recognises a MiniMax clip', () => {
    expect(classifyMp3(MINIMAX_FRAME)).toBe('minimax');
  });

  it('recognises a Google clip', () => {
    expect(classifyMp3(GOOGLE_FRAME)).toBe('gtts');
  });

  it('skips a leading ID3 tag', () => {
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    const withTag = new Uint8Array([...tag, ...GOOGLE_FRAME]);
    expect(classifyMp3(withTag)).toBe('gtts');
  });

  it('reports anything else as unknown', () => {
    expect(classifyMp3(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe('unknown');
    // MPEG-1 at 44.1 kHz — neither provider
    expect(classifyMp3(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0]))).toBe('unknown');
  });
});
