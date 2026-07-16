import { describe, it, expect, beforeEach, vi } from 'vitest';
import { diffManifest, prefetchAllAudio } from './audioPrefetch';
import { cacheAudio, getCachedAudioKeys } from './audioCache';

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
}

function mockFetch(manifest: string[], failUrls: string[] = []) {
  return vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/audio-manifest')) {
      return new Response(JSON.stringify({ urls: manifest }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/audio/')) {
      const key = url.split('/api/audio/')[1];
      if (failUrls.includes(key)) {
        return new Response('not found', { status: 404 });
      }
      return new Response(blobOfSize(50), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

describe('diffManifest', () => {
  it('returns only urls missing from the cache', () => {
    const cached = new Set(['a', 'b']);
    expect(diffManifest(['a', 'b', 'c', 'd'], cached)).toEqual(['c', 'd']);
  });

  it('skips empty urls', () => {
    expect(diffManifest(['', 'a'], new Set())).toEqual(['a']);
  });
});

describe('prefetchAllAudio', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('downloads all missing manifest urls into the cache', async () => {
    await cacheAudio('already-cached.mp3', blobOfSize(10));
    mockFetch(['already-cached.mp3', 'one.mp3', 'two.mp3']);

    const result = await prefetchAllAudio({ force: true });

    expect(result).toEqual({ total: 2, downloaded: 2, failed: 0 });
    const keys = await getCachedAudioKeys();
    expect(keys.has('one.mp3')).toBe(true);
    expect(keys.has('two.mp3')).toBe(true);
  });

  it('counts failed downloads without aborting the run', async () => {
    mockFetch(['good.mp3', 'bad.mp3'], ['bad.mp3']);

    const result = await prefetchAllAudio({ force: true });

    expect(result).toEqual({ total: 2, downloaded: 1, failed: 1 });
    const keys = await getCachedAudioKeys();
    expect(keys.has('good.mp3')).toBe(true);
    expect(keys.has('bad.mp3')).toBe(false);
  });

  it('throttles auto-runs but not forced runs', async () => {
    mockFetch(['a.mp3']);
    localStorage.setItem('audioPrefetchLastRun', String(Date.now()));

    // Auto-run within the throttle window is skipped
    expect(await prefetchAllAudio()).toBeNull();

    // Forced run proceeds
    const result = await prefetchAllAudio({ force: true });
    expect(result?.downloaded).toBe(1);
  });
});
