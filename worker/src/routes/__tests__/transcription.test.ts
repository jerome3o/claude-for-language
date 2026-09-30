/**
 * POST /api/transcribe — the upload path a take falls back to when the device's live
 * (Soniox real-time) stream gives nothing. On 30 Sep 2026 every Whisper call failed in
 * ~350 ms (Workers AI error) while the live stream on the Lab app was also failing, so the
 * card showed "Transcribing…" and then nothing. The route now tries Soniox async and Gemini
 * after Whisper, logs each provider's own error, and logs why the device's live stream failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import transcription from '../transcription';
import type { Env } from '../../types';

const WAV = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 1, 2, 3, 4]);

function makeApp(env: Partial<Env>, user: { id: string } | null = { id: 'learner' }) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    await next();
  });
  app.route('/api', transcription);
  return (fields: Record<string, string> = {}, bytes: Uint8Array = WAV) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'take.wav');
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return app.request('/api/transcribe', { method: 'POST', body: form }, env as Env);
  };
}

function aiFailing(message = '3040: Capacity temporarily exceeded, please try again.') {
  return { run: vi.fn(async () => { const e = new Error(message); e.name = 'AiError'; throw e; }) } as unknown as Ai;
}

function aiAnswering(text: string) {
  return { run: vi.fn(async () => ({ text, transcription_info: { language: 'zh' } })) } as unknown as Ai;
}

/** A Soniox async API stand-in: upload → job → completed → transcript, and the clean-up deletes. */
function sonioxFetch(tokens: Array<{ text: string; start_ms: number; end_ms: number }>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/v1/files')) return json({ id: 'file-1' }, 201);
    if (url.endsWith('/v1/transcriptions')) return json({ id: 'job-1' }, 201);
    if (url.endsWith('/v1/transcriptions/job-1')) return json({ status: 'completed' });
    if (url.endsWith('/v1/transcriptions/job-1/transcript')) return json({ tokens });
    return json({ error: 'unexpected ' + url }, 500);
  });
}

describe('POST /api/transcribe', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    const keep = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'error').mockImplementation(keep);
    vi.spyOn(console, 'warn').mockImplementation(keep);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('answers with Whisper when Whisper works', async () => {
    const res = await makeApp({ AI: aiAnswering('你好') })();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '你好', language: 'zh', provider: 'whisper' });
  });

  it('falls back to Soniox async when Whisper fails, and logs Whisper’s own error', async () => {
    const f = sonioxFetch([{ text: '谢', start_ms: 100, end_ms: 300 }, { text: '谢', start_ms: 300, end_ms: 500 }]);
    vi.stubGlobal('fetch', f);
    const res = await makeApp({ AI: aiFailing(), SONIOX_API_KEY: 'PERMANENT' })({ live_error: 'Soniox 402: organization_balance_exhausted', client: 'lab' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '谢谢', language: 'zh', provider: 'soniox' });
    expect(logs.some((l) => l.includes('whisper failed: AiError: 3040: Capacity temporarily exceeded'))).toBe(true);
    expect(logs.some((l) => l.includes('live stream failed on lab: Soniox 402: organization_balance_exhausted'))).toBe(true);
    // The upload went to Soniox with the permanent key (server side only) and was cleaned up.
    const calls = f.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u).replace('https://api.soniox.com/v1', '')}`);
    expect(calls).toEqual(expect.arrayContaining(['POST /files', 'POST /transcriptions', 'DELETE /transcriptions/job-1', 'DELETE /files/file-1']));
    expect(logs.join('\n')).not.toContain('PERMANENT');
  });

  it('falls through to Gemini when Whisper and Soniox both fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('soniox')) return new Response('{"error_message":"balance exhausted"}', { status: 402 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"start":"00:00","end":"00:01","text":"再见","language":"zh"}]' }] } }] }), { status: 200 });
    }));
    const res = await makeApp({ AI: aiFailing(), SONIOX_API_KEY: 'k', GEMINI_API_KEY: 'g' })();
    expect(await res.json()).toEqual({ text: '再见', language: 'zh', provider: 'gemini' });
    expect(logs.some((l) => l.includes('soniox failed') && l.includes('HTTP 402'))).toBe(true);
  });

  it('every provider failing is a 502 the device shows as "Couldn’t transcribe — tap to retry"', async () => {
    const res = await makeApp({ AI: aiFailing() })({ live_error: 'timeout', client: 'web' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't transcribe the recording", providers: ['whisper'] });
    expect(logs.some((l) => l.includes('every provider failed (web, audio/wav, 16 B)'))).toBe(true);
  });

  it('refuses a signed-out caller, a missing file and an empty take', async () => {
    expect((await makeApp({ AI: aiAnswering('x') }, null)()).status).toBe(401);
    expect((await makeApp({ AI: aiAnswering('x') })({}, new Uint8Array())).status).toBe(400);
  });
});
