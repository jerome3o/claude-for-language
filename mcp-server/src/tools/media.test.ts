import { describe, expect, it } from 'vitest';
import { signMediaUrls, MCP_MEDIA_LINK_TTL_S } from './media.js';

const BASE = 'https://api.example';

function fakeApi(allowed: string[]) {
  const calls: Array<{ path: string; body: { keys: string[]; ttl_s: number } }> = [];
  return {
    calls,
    baseUrl: BASE,
    post: async <T,>(path: string, body?: unknown): Promise<T> => {
      const b = body as { keys: string[]; ttl_s: number };
      calls.push({ path, body: b });
      const urls: Record<string, string | null> = {};
      for (const k of b.keys) urls[k] = allowed.includes(k) ? `/api/audio/${k}?exp=1&sig=s` : null;
      return { urls } as T;
    },
  };
}

describe('signMediaUrls (recordings in tool results get expiring links)', () => {
  it('signs private keys and links, keeps public clips and other text as they are', async () => {
    const api = fakeApi(['recordings/a.webm', 'calls/c1/p1.webm']);
    const out = await signMediaUrls(api, {
      recordings: [
        { audio_url: `${BASE}/api/audio/recordings/a.webm`, note: { hanzi: '银行', audio_url: `${BASE}/api/audio/generated/n.mp3` } },
        { recording_url: 'recordings/a.webm' },
      ],
      call: { audio_url: '/api/audio/calls/c1/p1.webm' },
      text: 'recordings are great',
    });
    expect(out.recordings[0].audio_url).toBe(`${BASE}/api/audio/recordings/a.webm?exp=1&sig=s`);
    expect(out.recordings[0].note?.audio_url).toBe(`${BASE}/api/audio/generated/n.mp3`);
    expect(out.recordings[1].recording_url).toBe(`${BASE}/api/audio/recordings/a.webm?exp=1&sig=s`);
    expect(out.call.audio_url).toBe(`${BASE}/api/audio/calls/c1/p1.webm?exp=1&sig=s`);
    expect(out.text).toBe('recordings are great');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].path).toBe('/api/media/sign');
    expect(api.calls[0].body.ttl_s).toBe(MCP_MEDIA_LINK_TTL_S);
    expect(api.calls[0].body.keys.sort()).toEqual(['calls/c1/p1.webm', 'recordings/a.webm']);
  });

  it('makes no call when there is nothing private, and leaves keys the user may not see alone', async () => {
    const api = fakeApi([]);
    const plain = { audio_url: `${BASE}/api/audio/generated/n.mp3` };
    expect(await signMediaUrls(api, plain)).toBe(plain);
    expect(api.calls).toHaveLength(0);
    const out = await signMediaUrls(api, { audio_url: `${BASE}/api/audio/recordings/b.webm` });
    expect(out.audio_url).toBe(`${BASE}/api/audio/recordings/b.webm`);
  });

  it('never fails the tool when signing fails', async () => {
    const api = { baseUrl: BASE, post: async () => { throw new Error('down'); } };
    const data = { audio_url: `${BASE}/api/audio/recordings/a.webm` };
    expect(await signMediaUrls(api as never, data)).toEqual(data);
  });
});
