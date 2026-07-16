import { describe, it, expect } from 'vitest';
import {
  cacheAudio,
  getCachedAudio,
  isAudioCached,
  getCachedAudioKeys,
  evictIfOverBudget,
  getAudioCacheStats,
  clearAudioCache,
} from './audioCache';
import { db } from '../db/database';

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
}

describe('audio cache', () => {
  it('stores blob and metadata together', async () => {
    await cacheAudio('generated/a.mp3', blobOfSize(100));

    expect(await isAudioCached('generated/a.mp3')).toBe(true);
    const meta = await db.cachedAudioMeta.get('generated/a.mp3');
    expect(meta?.size).toBe(100);
    expect(meta?.last_used_at).toBeGreaterThan(0);

    // Note: fake-indexeddb doesn't preserve Blob.size through round-trips,
    // so only assert presence here; size is asserted via the meta row above.
    const blob = await getCachedAudio('generated/a.mp3');
    expect(blob).not.toBeNull();
  });

  it('never expires cached audio', async () => {
    await cacheAudio('generated/old.mp3', blobOfSize(10));
    // Simulate a very old entry (would have expired under the old 30-day TTL)
    const ancient = Date.now() - 400 * 24 * 60 * 60 * 1000;
    await db.cachedAudio.update('generated/old.mp3', { cached_at: ancient });
    await db.cachedAudioMeta.update('generated/old.mp3', { cached_at: ancient, last_used_at: ancient });

    expect(await getCachedAudio('generated/old.mp3')).not.toBeNull();
    expect(await isAudioCached('generated/old.mp3')).toBe(true);
  });

  it('evicts least-recently-used entries when over budget', async () => {
    await cacheAudio('a', blobOfSize(100));
    await cacheAudio('b', blobOfSize(100));
    await cacheAudio('c', blobOfSize(100));
    // Make 'a' the least recently used, 'b' the most recent
    await db.cachedAudioMeta.update('a', { last_used_at: 1000 });
    await db.cachedAudioMeta.update('c', { last_used_at: 2000 });
    await db.cachedAudioMeta.update('b', { last_used_at: 3000 });

    // Budget of 250 bytes: must evict one entry (the LRU: 'a')
    const evicted = await evictIfOverBudget(250);
    expect(evicted).toBe(1);
    expect(await db.cachedAudio.get('a')).toBeUndefined();
    expect(await db.cachedAudioMeta.get('a')).toBeUndefined();
    expect(await isAudioCached('b')).toBe(true);
    expect(await isAudioCached('c')).toBe(true);
  });

  it('does not evict when under budget', async () => {
    await cacheAudio('a', blobOfSize(100));
    const evicted = await evictIfOverBudget(1000);
    expect(evicted).toBe(0);
    expect(await isAudioCached('a')).toBe(true);
  });

  it('playback refreshes the LRU timestamp', async () => {
    await cacheAudio('a', blobOfSize(10));
    await db.cachedAudioMeta.update('a', { last_used_at: 1000 });

    await getCachedAudio('a');
    // last_used update is fire-and-forget; give it a tick
    await new Promise((r) => setTimeout(r, 10));

    const meta = await db.cachedAudioMeta.get('a');
    expect(meta!.last_used_at).toBeGreaterThan(1000);
  });

  it('backfills metadata for entries cached before the meta table existed', async () => {
    // Simulate a pre-v8 entry: blob row without meta row
    await db.cachedAudio.put({ key: 'legacy', blob: blobOfSize(42), cached_at: 12345 });

    expect(await isAudioCached('legacy')).toBe(true);
    // Meta row was backfilled (size comes from the stored blob; fake-indexeddb
    // doesn't preserve Blob.size, so just assert the row exists)
    const meta = await db.cachedAudioMeta.get('legacy');
    expect(meta).toBeDefined();
    expect(typeof meta!.size).toBe('number');
  });

  it('reports stats from metadata and lists cached keys', async () => {
    await cacheAudio('a', blobOfSize(100));
    await cacheAudio('b', blobOfSize(200));

    const stats = await getAudioCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.totalSize).toBe(300);

    const keys = await getCachedAudioKeys();
    expect(keys).toEqual(new Set(['a', 'b']));

    await clearAudioCache();
    expect((await getAudioCacheStats()).count).toBe(0);
    expect((await getCachedAudioKeys()).size).toBe(0);
  });
});
