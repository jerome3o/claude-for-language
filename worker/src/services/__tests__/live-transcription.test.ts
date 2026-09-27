import { describe, expect, it, vi } from 'vitest';
import { LIVE_KEY_TTL_SECONDS, LiveTranscriptionError, mintLiveSession, transcriptionCapabilities } from '../live-transcription';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('mintLiveSession', () => {
  it('without a key the client keeps the upload path (no network call)', async () => {
    const f = fakeFetch(200, {});
    expect(await mintLiveSession({ SONIOX_API_KEY: '' }, 'u1', f as unknown as typeof fetch)).toEqual({ provider: 'upload' });
    expect(await mintLiveSession({}, 'u1', f as unknown as typeof fetch)).toEqual({ provider: 'upload' });
    expect(f).not.toHaveBeenCalled();
  });

  it('mints a temporary websocket key tagged with the user and never returns the permanent key', async () => {
    const f = fakeFetch(201, { api_key: 'temp:abc', expires_at: '2026-09-27T10:30:00Z' });
    const session = await mintLiveSession({ SONIOX_API_KEY: 'PERMANENT' }, 'user-42', f as unknown as typeof fetch);
    expect(session).toEqual({
      provider: 'soniox',
      api_key: 'temp:abc',
      expires_at: '2026-09-27T10:30:00Z',
      websocket_url: 'wss://stt-rt.soniox.com/transcribe-websocket',
      model: 'stt-rt-v5',
      language_hints: ['zh', 'en'],
    });
    expect(JSON.stringify(session)).not.toContain('PERMANENT');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.soniox.com/v1/auth/temporary-api-key');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer PERMANENT');
    expect(JSON.parse(init!.body as string)).toEqual({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: LIVE_KEY_TTL_SECONDS,
      client_reference_id: 'user-42',
      max_session_duration_seconds: 300,
    });
  });

  it('a Soniox failure is a 502 the client falls back from', async () => {
    const f = fakeFetch(401, { error_message: 'bad key' });
    await expect(mintLiveSession({ SONIOX_API_KEY: 'k' }, 'u', f as unknown as typeof fetch)).rejects.toMatchObject({ status: 502 });
    await expect(mintLiveSession({ SONIOX_API_KEY: 'k' }, 'u', fakeFetch(201, {}) as unknown as typeof fetch)).rejects.toBeInstanceOf(LiveTranscriptionError);
  });

  it('fills a missing expiry from the TTL', async () => {
    const before = Date.now();
    const s = await mintLiveSession({ SONIOX_API_KEY: 'k' }, 'u', fakeFetch(201, { api_key: 't' }) as unknown as typeof fetch);
    expect(s.provider).toBe('soniox');
    if (s.provider === 'soniox') expect(Date.parse(s.expires_at)).toBeGreaterThanOrEqual(before + LIVE_KEY_TTL_SECONDS * 1000 - 5);
  });
});

describe('transcriptionCapabilities', () => {
  it('reports booleans, never the key', () => {
    const caps = transcriptionCapabilities({ SONIOX_API_KEY: 'secret-value', GEMINI_API_KEY: '', AI: {} as Ai });
    expect(caps).toEqual({ live: 'soniox', upload: 'whisper', soniox_configured: true, gemini_configured: false, workers_ai: true, live_model: 'stt-rt-v5' });
    expect(JSON.stringify(caps)).not.toContain('secret-value');
    expect(transcriptionCapabilities({ SONIOX_API_KEY: ' ', GEMINI_API_KEY: 'g', AI: {} as Ai }).live).toBeNull();
  });
});
