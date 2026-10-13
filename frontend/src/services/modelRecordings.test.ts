import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModelRecordingBlob, modelRecordingCacheKey, prefetchModelRecordings, primeModelRecording } from './modelRecordings';
import { db } from '../db/database';

/**
 * The tutor's model recording on the device: fetched once with the session, kept in the audio
 * cache under its own key (the URL changes with every new clip), then played offline.
 */
const URL_A = '/api/recording-marks/ev-1/model-audio?v=abc';
const URL_B = '/api/recording-marks/ev-2/model-audio?v=def';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await db.cachedAudio.clear();
  await db.cachedAudioMeta.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/recording-marks/')) return new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), { status: 200 });
    if (String(url).includes('/api/audio/recordings/')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return new Response('nope', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('model recordings', () => {
  it('fetches with the session once, then plays from the cache', async () => {
    expect(await getModelRecordingBlob(URL_A)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect(await db.cachedAudio.get(modelRecordingCacheKey(URL_A))).toBeTruthy();
    expect(await getModelRecordingBlob(URL_A)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a clip the tutor just recorded is primed without a download', async () => {
    await primeModelRecording(URL_B, new Blob([new Uint8Array([9])], { type: 'audio/webm' }));
    expect(await getModelRecordingBlob(URL_B)).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the sync prefetches each tutor clip once and my take beside it; notes without one are skipped', async () => {
    const n = await prefetchModelRecordings([
      { model_audio_url: URL_A, recording_url: 'recordings/ev-1.webm' },
      { model_audio_url: URL_A, recording_url: 'recordings/ev-1.webm' },
      { model_audio_url: null, recording_url: 'recordings/ev-3.webm' },
    ]);
    expect(n).toBe(1);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/model-audio'))).toHaveLength(1);
    expect(urls.some((u) => u.includes('recordings/ev-1.webm'))).toBe(true);
    expect(urls.some((u) => u.includes('ev-3'))).toBe(false);
  });
});
