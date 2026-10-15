import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, Blob>();
const generate = vi.fn();

vi.mock('./audioCache', () => ({
  getCachedAudio: async (key: string) => store.get(key) ?? null,
  cacheAudio: async (key: string, blob: Blob) => { store.set(key, blob); },
  isAudioCached: async (key: string) => store.has(key),
}));
vi.mock('../api/client', () => ({
  generatePracticeTTS: (...args: unknown[]) => generate(...args),
  generateConversationLineTTS: (...args: unknown[]) => generate(...args),
}));

const { getTTSWithCache, getLessonClip, isLessonClipCached, lessonClipCacheKey, ttsCacheKey, conversationClipKey } = await import('./ttsCache');

describe('ttsCache: one request per clip', () => {
  beforeEach(() => {
    store.clear();
    generate.mockReset();
  });

  it('a clip asked for while it is being fetched joins that request', async () => {
    let release!: () => void;
    generate.mockImplementation(() => new Promise((r) => { release = () => r({ audio_base64: btoa('mp3'), content_type: 'audio/mpeg' }); }));
    const a = getTTSWithCache('即使他很忙，也每天复习中文。');
    const b = getTTSWithCache('即使他很忙，也每天复习中文。');
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [x, y] = await Promise.all([a, b]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
    // Then it's on the device: no request at all.
    await getTTSWithCache('即使他很忙，也每天复习中文。');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('lesson clip keys are the keys the player reads', async () => {
    expect(lessonClipCacheKey({ kind: 'tts', text: '好' })).toBe(ttsCacheKey('好'));
    const line = { kind: 'conversation' as const, text: '好', voice: 'v', speed: 0.85, delivery: 'calm' as const, exercise: 0 };
    expect(lessonClipCacheKey(line)).toBe(conversationClipKey({ text: '好', voice: 'v', speed: 0.85, delivery: 'calm' }));
    generate.mockResolvedValue({ audio_base64: btoa('mp3'), content_type: 'audio/mpeg' });
    expect(await isLessonClipCached(line)).toBe(false);
    expect(await getLessonClip(line)).not.toBeNull();
    expect(await isLessonClipCached(line)).toBe(true);
  });
});
