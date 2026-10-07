/**
 * TTS providers (docs/AUDIO.md "Providers"): Azure's SSML and error
 * classification, the fallback order, which clips count as current, voice
 * mapping, and one limiter + account pause per provider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AZURE_OUTPUT_FORMAT,
  azureProvider,
  buildAzureSsml,
  classifyAzureError,
  classifyGoogleError,
} from '../tts/providers';
import {
  acceptableProviders,
  buildStoredClipPolicy,
  clearTtsConfigCache,
  loadTtsConfig,
  providerVoice,
  conversationProviderVoice,
  activeConversationProvider,
  saveTtsConfig,
  storedClipHash,
  voiceRole,
} from '../tts/config';
import { minimaxProvider } from '../tts/providers';
import { conversationTtsCacheKey } from '../tts-cache';
import { combineProviderFailures, generateConversationTTS, generateTTSDetailed, shouldTryNextProvider } from '../audio';
import { accountFailureCondition } from '../tts/account';
import { ttsSettings } from '../tts/settings';
import { TtsLimiter } from '../../durable/tts-limiter';
import { cloneTtsConfig, type TtsConfig } from '@shared/tts';
import { createSqliteD1 } from './sqlite-d1';
import type { Env } from '../../types';

const MINIMAX_HEX = 'fffb9064' + '00'.repeat(32);
const minimaxOk = () => new Response(JSON.stringify({ data: { audio: MINIMAX_HEX }, base_resp: { status_code: 0, status_msg: 'success' } }), { status: 200 });
const minimaxCode = (code: number) => () => new Response(JSON.stringify({ data: {}, base_resp: { status_code: code, status_msg: 'x' } }), { status: 200 });
const azureOk = () => new Response(new Uint8Array([0xff, 0xf3, 0x64, 0x64, 1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

describe('Azure SSML', () => {
  it('voice + prosody rate as a percentage, text escaped', () => {
    const ssml = buildAzureSsml('你好 <b> & "再见"', 'zh-CN-XiaoxiaoNeural', 0.7);
    expect(ssml).toContain('<voice name="zh-CN-XiaoxiaoNeural">');
    expect(ssml).toContain('<prosody rate="-30%">你好 &lt;b&gt; &amp; &quot;再见&quot;</prosody>');
    expect(ssml).toContain('xml:lang="zh-CN"');
  });

  it('no prosody at rate 1 or for HD voices (they ignore it)', () => {
    expect(buildAzureSsml('你好', 'zh-CN-XiaoxiaoNeural', 1)).not.toContain('prosody');
    expect(buildAzureSsml('你好', 'zh-CN-Xiaoxiao:DragonHDFlashLatestNeural', 0.7)).not.toContain('prosody');
  });
});

describe('error classification', () => {
  it.each([
    [401, { rateLimited: true, account: 'azure http 401', permanent: false }],
    [403, { rateLimited: true, account: 'azure http 403', permanent: false }],
    [429, { rateLimited: true, permanent: false, retryAfterMs: 60_000 }],
    [400, { rateLimited: false, permanent: true }],
    [500, { rateLimited: false, permanent: false }],
  ])('Azure HTTP %i', (status, expected) => {
    const out = classifyAzureError(status, 'body');
    expect(out).toMatchObject(expected);
    if (status !== 401 && status !== 403) expect(out.account).toBeUndefined();
    expect(out.reason.startsWith(`azure http ${status}`)).toBe(true);
  });

  it('Google HTTP 403 is an account problem, 429 a rate limit', () => {
    expect(classifyGoogleError(403)).toMatchObject({ account: 'google http 403', rateLimited: true });
    expect(classifyGoogleError(429)).toMatchObject({ rateLimited: true });
    expect(classifyGoogleError(429).account).toBeUndefined();
  });

  it("account failures written by Azure are found by the recovery's reset", () => {
    const cond = accountFailureCondition();
    expect(cond.params).toContain('azure http 401%');
    expect(cond.params).toContain('base_resp 2053%');
    expect(accountFailureCondition('azure http 403').params).toEqual(['base_resp 403%', 'http 403%', 'azure http 403%', 'google http 403%']);
  });
});

describe('Azure call (mocked fetch)', () => {
  it('posts SSML to the region endpoint with the key and the mp3 output format', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return azureOk();
    }) as unknown as typeof fetch;
    const out = await azureProvider.synthesize({ AZURE_SPEECH_KEY: 'k1', AZURE_SPEECH_REGION: 'WestEurope' } as Env, { text: '你好', voice: 'zh-CN-YunxiNeural', rate: 0.7 }, fetcher);
    expect(out).toMatchObject({ ok: true, mime: 'audio/mpeg' });
    expect(seen[0].url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('k1');
    expect(headers['X-Microsoft-OutputFormat']).toBe(AZURE_OUTPUT_FORMAT);
    expect(headers['Content-Type']).toBe('application/ssml+xml');
    expect(String(seen[0].init.body)).toContain('zh-CN-YunxiNeural');
  });

  it('a thrown fetch is a network failure, unconfigured is skipped', async () => {
    const out = await azureProvider.synthesize({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastus' } as Env, { text: '你', voice: 'v', rate: 1 }, (async () => {
      throw new Error('reset');
    }) as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: false, network: true });
    expect(azureProvider.configured({ AZURE_SPEECH_KEY: 'k' } as Env)).toBe(false);
  });
});

describe('fallback rules (pure)', () => {
  const fail = (o: Partial<{ permanent: boolean; rateLimited: boolean; account: string | number; retryAfterMs: number; network: boolean; reason: string }>) =>
    ({ ok: false as const, permanent: false, rateLimited: false, reason: 'x', ...o });

  it('account pause / failure → next provider; a plain rate limit only for someone waiting', () => {
    expect(shouldTryNextProvider(fail({ rateLimited: true, account: 2053 }), 'batch')).toBe(true);
    expect(shouldTryNextProvider(fail({ rateLimited: true }), 'batch')).toBe(false);
    expect(shouldTryNextProvider(fail({ rateLimited: true }), 'interactive')).toBe(true);
    expect(shouldTryNextProvider(fail({ permanent: true }), 'batch')).toBe(true);
  });

  it('combined: the shortest wait wins; account only when every waiter is paused', () => {
    expect(combineProviderFailures([
      { provider: 'minimax', outcome: fail({ rateLimited: true, account: 2053, retryAfterMs: 300_000 }) },
      { provider: 'azure', outcome: fail({ rateLimited: true, retryAfterMs: 4000, reason: 'limiter' }) },
    ])).toMatchObject({ rateLimited: true, retryAfterMs: 4000, account: undefined, reason: 'limiter' });
    expect(combineProviderFailures([
      { provider: 'minimax', outcome: fail({ rateLimited: true, account: 2053, retryAfterMs: 300_000 }) },
    ])).toMatchObject({ rateLimited: true, account: 2053 });
    expect(combineProviderFailures([
      { provider: 'minimax', outcome: fail({ permanent: true, reason: 'base_resp 2013 bad' }) },
      { provider: 'azure', outcome: fail({ permanent: false, reason: 'azure http 500' }) },
    ])).toMatchObject({ rateLimited: false, permanent: false, reason: 'base_resp 2013 bad; azure http 500' });
    expect(combineProviderFailures([])).toMatchObject({ permanent: true, reason: 'not configured' });
  });
});

describe('which clips are current', () => {
  const ALL = { minimax: true, azure: true, google: true };
  const cfg = (o: Partial<TtsConfig> = {}): TtsConfig => ({ ...cloneTtsConfig(), ...o });

  it('the first provider only — the backups too while it is paused, or when upgrading is off', () => {
    expect(acceptableProviders(['minimax', 'azure'], true, false)).toEqual(['minimax']);
    expect(acceptableProviders(['minimax', 'azure'], true, true)).toEqual(['minimax', 'azure']);
    expect(acceptableProviders(['minimax', 'azure'], false, false)).toEqual(['minimax', 'azure']);
    expect(acceptableProviders([], true, true)).toEqual([]);
  });

  it('policy: a paused MiniMax makes Azure clips current; an unconfigured MiniMax makes Azure the first', () => {
    const c = cfg({ stored_order: ['minimax', 'azure'] });
    const paused = buildStoredClipPolicy(c, ALL, { minimax: { code: 2053 } as never });
    expect(paused).toMatchObject({ primary: 'minimax', primaryUnavailable: true, acceptable: ['minimax', 'azure'] });
    expect(paused.acceptableHashes).toEqual([paused.hashes.minimax, paused.hashes.azure]);
    const fine = buildStoredClipPolicy(c, ALL, {});
    expect(fine.acceptable).toEqual(['minimax']);
    const noKey = buildStoredClipPolicy(c, { ...ALL, minimax: false }, {});
    expect(noKey).toMatchObject({ order: ['azure'], primary: 'azure', acceptable: ['azure'] });
  });

  it("MiniMax's hash is unchanged by providers (clips made before stay current)", () => {
    expect(storedClipHash('minimax', cfg())).toBe(ttsSettings({}).hash);
    // Another voice / rate for Azure = another hash (the backfill remakes them).
    const a = cfg();
    const b = cfg();
    b.providers.azure.speed_factor = 0.5;
    expect(storedClipHash('azure', a)).not.toBe(storedClipHash('azure', b));
  });
});

describe('voice mapping', () => {
  const c = cloneTtsConfig();
  it('a MiniMax catalogue voice → the role of its gender on another provider', () => {
    expect(voiceRole(undefined, c)).toBe('default');
    expect(voiceRole('Chinese (Mandarin)_Radio_Host', c)).toBe('default');
    expect(voiceRole('Chinese (Mandarin)_News_Anchor', c)).toBe('female');
    expect(voiceRole('presenter_male', c)).toBe('male');
    expect(providerVoice('azure', c, { voiceId: 'presenter_male', speed: 0.9 })).toEqual({ voice: 'zh-CN-YunxiNeural', rate: 0.93 });
    expect(providerVoice('azure', c, { speed: 0.6 })).toEqual({ voice: 'zh-CN-XiaoxiaoNeural', rate: 0.7 });
    expect(providerVoice('minimax', c, { voiceId: 'presenter_male', speed: 0.9 })).toEqual({ voice: 'presenter_male', rate: 0.9 });
    expect(providerVoice('google', c, { voiceId: 'audiobook_female_1', speed: 0.6 })).toEqual({ voice: 'cmn-CN-Wavenet-C', rate: 0.6 });
  });
});

describe('the fallback order end to end (mocked fetch, settings in D1)', () => {
  let calls: string[];
  let limiterNames: string[];
  let minimaxQ: Array<() => Response>;
  let azureQ: Array<() => Response>;
  let googleQ: Array<() => Response>;
  let stored: string[];

  async function env(config: Partial<TtsConfig>, overrides: Partial<Env> = {}): Promise<Env> {
    const db = await createSqliteD1();
    await saveTtsConfig(db as unknown as D1Database, { ...cloneTtsConfig(), ...config }, null);
    const limiter = (name: string) => ({
      acquire: async () => {
        limiterNames.push(name);
        return { granted: true, retryAfterMs: 0, remaining: 3 };
      },
      report: async () => ({}),
      accountStatus: async () => null,
    });
    return {
      DB: db,
      MINIMAX_API_KEY: 'mm',
      GOOGLE_TTS_API_KEY: 'g',
      AZURE_SPEECH_KEY: 'az',
      AZURE_SPEECH_REGION: 'eastus',
      AUDIO_BUCKET: { put: async (key: string) => void stored.push(key) },
      TTS_LIMITER: { idFromName: (n: string) => n, get: (n: string) => limiter(n) },
      ...overrides,
    } as unknown as Env;
  }

  beforeEach(() => {
    clearTtsConfigCache();
    calls = [];
    limiterNames = [];
    minimaxQ = [];
    azureQ = [];
    googleQ = [];
    stored = [];
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async (url: string) => {
      const q = url.includes('minimax') ? minimaxQ : url.includes('microsoft') ? azureQ : googleQ;
      calls.push(url.includes('minimax') ? 'minimax' : url.includes('microsoft') ? 'azure' : 'google');
      const next = q.shift();
      if (!next) throw new Error(`unexpected call to ${url}`);
      return next();
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearTtsConfigCache();
  });

  const run = async <T,>(p: Promise<T>) => {
    const settled = p.then((v) => v);
    await vi.runAllTimersAsync();
    return settled;
  };

  it('defaults: stored clips never touch Azure even when MiniMax has no credit', async () => {
    const e = await env({});
    minimaxQ.push(minimaxCode(2053));
    const out = await run(generateTTSDetailed(e, '你好', 'n1'));
    expect(out).toMatchObject({ ok: false, rateLimited: true, account: 2053 });
    expect(calls).toEqual(['minimax']);
  });

  it('[minimax, azure]: no credit at MiniMax → Azure makes the clip, recorded as azure with its own hash', async () => {
    const e = await env({ stored_order: ['minimax', 'azure'] });
    minimaxQ.push(minimaxCode(2053));
    azureQ.push(azureOk);
    const out = await run(generateTTSDetailed(e, '你好', 'n1', { priority: 'batch' }));
    expect(calls).toEqual(['minimax', 'azure']);
    expect(limiterNames).toEqual(['minimax', 'azure']);
    const config = await loadTtsConfig(e);
    expect(out).toMatchObject({ ok: true, result: { provider: 'azure', voice: 'zh-CN-XiaoxiaoNeural', speed: 0.7, model: 'azure-neural', settingsHash: storedClipHash('azure', config) } });
    expect(stored).toHaveLength(1);
  });

  it('[minimax, azure]: a plain MiniMax rate limit waits in the background, falls back for a tap', async () => {
    const e = await env({ stored_order: ['minimax', 'azure'] });
    minimaxQ.push(minimaxCode(1002));
    expect(await run(generateTTSDetailed(e, '你好', 'n1', { priority: 'batch' }))).toMatchObject({ ok: false, rateLimited: true, account: undefined });
    expect(calls).toEqual(['minimax']);
    calls = [];
    minimaxQ.push(minimaxCode(1002));
    azureQ.push(azureOk);
    expect(await run(generateTTSDetailed(e, '你好', 'n1', { priority: 'interactive' }))).toMatchObject({ ok: true, result: { provider: 'azure' } });
    expect(calls).toEqual(['minimax', 'azure']);
  });

  it('a disabled or unconfigured provider is skipped', async () => {
    const e = await env({ stored_order: ['azure', 'minimax'] }, { AZURE_SPEECH_KEY: undefined });
    minimaxQ.push(minimaxOk);
    expect(await run(generateTTSDetailed(e, '你好', 'n1'))).toMatchObject({ ok: true, result: { provider: 'minimax' } });
    expect(calls).toEqual(['minimax']);
  });

  it('live playback uses the live order (Google as the last resort); a male voice maps to Azure male', async () => {
    const e = await env({ live_order: ['azure', 'google'] });
    azureQ.push(() => new Response('busy', { status: 503 }), () => new Response('busy', { status: 503 }));
    googleQ.push(() => new Response(JSON.stringify({ audioContent: btoa('abc') }), { status: 200 }));
    const out = await run(generateConversationTTS(e, '你好', { voiceId: 'presenter_male', speed: 0.9, allowGoogleFallback: true }));
    expect(out).toMatchObject({ provider: 'gtts', providerId: 'google', providerVoice: 'cmn-CN-Wavenet-B' });
    expect(calls).toEqual(['azure', 'azure', 'google']); // interactive: one retry on a 5xx, then the next
  });
});

describe('one limiter per provider', () => {
  function fakeDoState() {
    const store = new Map<string, unknown>();
    return { store, storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, v), delete: async (k: string) => store.delete(k) } };
  }
  class TestLimiter extends TtsLimiter {
    pings: string[] = [];
    protected override async notify(event: 'account_problem' | 'account_cleared'): Promise<void> {
      this.pings.push(event);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-04T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it("Azure's cap is the admin's max RPM (not MINIMAX_RPM); its account pause is its own", async () => {
    const azure = new TestLimiter(fakeDoState() as never, { MINIMAX_RPM: '55' } as Env);
    const minimax = new TestLimiter(fakeDoState() as never, { MINIMAX_RPM: '55' } as Env);
    await azure.acquire('interactive', { provider: 'azure', maxRpm: 12 });
    const snap = await azure.snapshot();
    expect(snap).toMatchObject({ provider: 'azure', rpm_cap: 12 });
    expect(snap.learned_rpm).toBeLessThanOrEqual(12);

    await azure.report('account_error', { code: 'azure http 401', message: 'azure http 401' }, { provider: 'azure', maxRpm: 12 });
    expect(await azure.acquire('interactive', { provider: 'azure', maxRpm: 12 })).toMatchObject({ granted: false, account: 'azure http 401' });
    expect(await azure.accountStatus()).toMatchObject({ code: 'azure http 401' });
    expect(azure.pings).toEqual(['account_problem']);
    // MiniMax is untouched.
    expect((await minimax.acquire('interactive', { provider: 'minimax', maxRpm: 55 })).granted).toBe(true);
    expect(await minimax.accountStatus()).toBeNull();
    expect((await minimax.snapshot()).rpm_cap).toBe(55);
  });

  it("MiniMax: the admin's max RPM can only lower the env cap; last success / error are kept", async () => {
    const lim = new TestLimiter(fakeDoState() as never, { MINIMAX_RPM: '55' } as Env);
    await lim.acquire('interactive', { provider: 'minimax', maxRpm: 30 });
    expect((await lim.snapshot()).rpm_cap).toBe(30);
    await lim.acquire('interactive', { provider: 'minimax', maxRpm: 500 });
    expect((await lim.snapshot()).rpm_cap).toBe(55);
    await lim.report('ok');
    await lim.report('failed', { code: 'failed', message: 'base_resp 2013 bad text' });
    const snap = await lim.snapshot();
    expect(snap.last_ok_at).toBe(Date.parse('2026-10-04T12:00:00Z'));
    expect(snap.last_error).toMatchObject({ reason: 'base_resp 2013 bad text' });
  });
});

describe('conversation audio (docs/AUDIO.md "Conversation audio")', () => {
  const c = cloneTtsConfig();
  it('speaks a provider\'s own voice at its own conversation rate, mapping other voices by gender', () => {
    expect(conversationProviderVoice('azure', c, { voiceId: 'zh-CN-YunjianNeural' })).toEqual({ voice: 'zh-CN-YunjianNeural', rate: 0.75 });
    expect(conversationProviderVoice('azure', c, { voiceId: 'presenter_male', speed: 0.9 })).toEqual({ voice: 'zh-CN-YunxiNeural', rate: 0.9 });
    expect(conversationProviderVoice('minimax', c, { voiceId: 'zh-CN-XiaoyiNeural', speed: 0.5 })).toEqual({ voice: 'Chinese (Mandarin)_News_Anchor', rate: 0.5 });
    expect(conversationProviderVoice('azure', c, { voiceId: 'zh-CN-YunxiNeural', speed: 0.3 }).rate).toBe(0.6);
    expect(conversationProviderVoice('minimax', c, { voiceId: 'presenter_male' }).rate).toBe(0.85);
  });
  it('adds the delivery the voice supports', () => {
    expect(conversationProviderVoice('azure', c, { voiceId: 'zh-CN-XiaoxiaoNeural', delivery: 'calm' }).style).toBe('calm');
    expect(conversationProviderVoice('azure', c, { voiceId: 'zh-CN-XiaochenNeural', delivery: 'calm' }).style).toBeUndefined();
    expect(conversationProviderVoice('minimax', c, { voiceId: 'presenter_male', delivery: 'cheerful' }).emotion).toBe('happy');
  });
  it('the SSML carries express-as with the mstts namespace only when styled', () => {
    const ssml = buildAzureSsml('你好', 'zh-CN-XiaoxiaoNeural', 0.75, { style: 'calm' });
    expect(ssml).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
    expect(ssml).toContain('<mstts:express-as style="calm"><prosody rate="-25%">你好</prosody></mstts:express-as>');
    expect(buildAzureSsml('你好', 'zh-CN-XiaoxiaoNeural', 0.75)).not.toContain('mstts');
  });
  it('MiniMax gets the emotion in voice_setting', async () => {
    let body: Record<string, unknown> = {};
    const fetcher = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: { audio: 'fff3' } }), { status: 200 });
    }) as unknown as typeof fetch;
    await minimaxProvider.synthesize({ MINIMAX_API_KEY: 'k' } as Env, { text: '你好', voice: 'presenter_male', rate: 0.8, emotion: 'calm' }, fetcher);
    expect(body.voice_setting).toEqual({ voice_id: 'presenter_male', speed: 0.8, emotion: 'calm' });
  });
  it('the active provider is the next stored one while the first is paused', () => {
    expect(activeConversationProvider({ order: ['minimax', 'azure'], primaryUnavailable: true })).toBe('azure');
    expect(activeConversationProvider({ order: ['minimax', 'azure'], primaryUnavailable: false })).toBe('minimax');
    expect(activeConversationProvider({ order: [], primaryUnavailable: false })).toBe('minimax');
  });
  it('conversation clips get their own R2 keys per rate and delivery', async () => {
    const a = await conversationTtsCacheKey('你好', 'azure', { voice: 'zh-CN-YunxiNeural', rate: 0.75 });
    const b = await conversationTtsCacheKey('你好', 'azure', { voice: 'zh-CN-YunxiNeural', rate: 0.8 });
    const d = await conversationTtsCacheKey('你好', 'azure', { voice: 'zh-CN-YunxiNeural', rate: 0.75, style: 'chat' });
    expect(new Set([a, b, d]).size).toBe(3);
    expect(a).toMatch(/^tts-cache\/v2\/c-[0-9a-f]{64}\.mp3$/);
  });
});
