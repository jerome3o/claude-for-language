import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveNoteAudioSource } from './useAudio';
import { cacheAudio } from '../services/audioCache';
import { db } from '../db/database';

/**
 * Card audio used to be played by handing the media element a cache-busted
 * network URL, so the on-device cache was populated but never used and every
 * card streamed from Cloudflare — stalling mid-clip on a mobile connection.
 * These pin the invariant: if the bytes are on the device, play the bytes.
 *
 * (fake-indexeddb does not preserve Blob through a round-trip, so "played from
 * the device" is asserted as "not a URL string" rather than by instance.)
 */

const API = 'https://api.test';
const KEY = 'generated/note-1_abc123.mp3';
const NETWORK_URL = `${API}/api/audio/${KEY}`;

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    value: online,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  setOnline(true);
});

describe('resolveNoteAudioSource', () => {
  it('plays the cached bytes rather than streaming', async () => {
    await cacheAudio(KEY, new Blob(['mp3-bytes'], { type: 'audio/mpeg' }));

    const source = await resolveNoteAudioSource(KEY, API);
    expect(typeof source).not.toBe('string');
  });

  it('fetches and caches on a miss, so the next play is local', async () => {
    const fetched = new Blob(['fresh-bytes'], { type: 'audio/mpeg' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fetched),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveNoteAudioSource(KEY, API);
    expect(typeof first).not.toBe('string');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.cachedAudio.get(KEY)).toBeDefined();

    fetchMock.mockClear();
    const second = await resolveNoteAudioSource(KEY, API);
    expect(typeof second).not.toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the network URL when offline with nothing cached', async () => {
    setOnline(false);
    expect(await resolveNoteAudioSource(KEY, API)).toBe(NETWORK_URL);
  });

  it('falls back to the network URL when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await resolveNoteAudioSource(KEY, API)).toBe(NETWORK_URL);
  });

  it('falls back to the network URL when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await resolveNoteAudioSource(KEY, API)).toBe(NETWORK_URL);
  });

  it('never appends a cache-busting query to the fallback URL', async () => {
    setOnline(false);
    expect(await resolveNoteAudioSource(KEY, API)).not.toContain('?');
  });
});
