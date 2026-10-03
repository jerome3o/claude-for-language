import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMessageAudio: vi.fn(),
  getChatClips: vi.fn(),
  getChatListening: vi.fn(),
  putChatListeningDefault: vi.fn(),
  putConversationListening: vi.fn(),
}));
const cache = vi.hoisted(() => ({ store: new Map<string, Blob>() }));

vi.mock('../api/chat', () => api);
vi.mock('./audioCache', () => ({
  cacheAudio: vi.fn(async (k: string, b: Blob) => void cache.store.set(k, b)),
  getCachedAudio: vi.fn(async (k: string) => cache.store.get(k) ?? null),
  isAudioCached: vi.fn(async (k: string) => cache.store.has(k)),
}));

import {
  clipCacheKey,
  getMessageClip,
  listeningFor,
  loadRevealed,
  prefetchChatClipsInSync,
  prefetchMessageClips,
  refreshChatListening,
  resetChatListeningForTests,
  revealMessage,
  setConversationListening,
  setListeningDefault,
} from './chatListening';

const blob = (s: string) => new Blob([s], { type: 'audio/mpeg' });

beforeEach(() => {
  localStorage.clear();
  resetChatListeningForTests();
  cache.store.clear();
  for (const f of Object.values(api)) f.mockReset();
});

describe('the setting on this device', () => {
  it('is saved locally at once and confirmed by the server', async () => {
    api.putConversationListening.mockResolvedValue({ conversation_id: 'c1', on: true, since: '2026-10-03T10:00:00.000Z', updated_at: 'T' });
    await setConversationListening('c1', true, '2026-10-03T10:00:00.000Z');
    expect(listeningFor('c1')).toEqual({ on: true, since: '2026-10-03T10:00:00.000Z' });
    expect(api.putConversationListening).toHaveBeenCalledWith('c1', true, '2026-10-03T10:00:00.000Z');
    // Survives a reload (localStorage).
    resetChatListeningForTests();
    expect(listeningFor('c1').on).toBe(true);
  });

  it('keeps an offline change and re-sends it on the next refresh', async () => {
    api.putConversationListening.mockRejectedValueOnce(new Error('offline'));
    await setConversationListening('c1', true, null);
    api.getChatListening.mockResolvedValue({ default_on: false, conversations: [{ conversation_id: 'c2', on: true, since: null, updated_at: 'T' }] });
    api.putConversationListening.mockResolvedValue({ conversation_id: 'c1', on: true, since: null, updated_at: 'T2' });
    await refreshChatListening();
    expect(api.putConversationListening).toHaveBeenLastCalledWith('c1', true, null);
    expect(listeningFor('c1').on).toBe(true);
    expect(listeningFor('c2').on).toBe(true);
    expect(listeningFor('c3')).toEqual({ on: false, since: null });
  });

  it('the default applies to chats without their own setting', async () => {
    api.putChatListeningDefault.mockResolvedValue({ default_on: true });
    await setListeningDefault(true);
    expect(listeningFor('any')).toEqual({ on: true, since: null });
  });
});

describe('revealed messages', () => {
  it('are remembered per conversation', () => {
    revealMessage('c1', 'm1');
    revealMessage('c1', 'm2');
    expect(loadRevealed('c1')).toEqual(['m1', 'm2']);
    expect(loadRevealed('c2')).toEqual([]);
    expect(JSON.parse(localStorage.getItem('chat-listening-revealed-v1:c1')!)).toEqual(['m1', 'm2']);
  });
});

describe('clips', () => {
  it('plays from the cache, else fetches once and caches under the clip id', async () => {
    api.fetchMessageAudio.mockResolvedValue({ blob: blob('a'), clip: 'm1-abc' });
    const first = await getMessageClip({ id: 'm1', audio_clip: null }, true);
    expect(first).toBeTruthy();
    expect(cache.store.has(clipCacheKey('m1-abc'))).toBe(true);
    // Known clip → cache, no network.
    await getMessageClip({ id: 'm1', audio_clip: 'm1-abc' }, true);
    expect(api.fetchMessageAudio).toHaveBeenCalledTimes(1);
    // Offline and never downloaded → null.
    expect(await getMessageClip({ id: 'm9', audio_clip: 'm9-x' }, false)).toBeNull();
  });

  it('prefetches the other person’s ready Chinese clips only', async () => {
    api.fetchMessageAudio.mockImplementation(async (id: string) => ({ blob: blob(id), clip: `${id}-h` }));
    const at = '2026-10-03T10:00:00.000Z';
    const n = await prefetchMessageClips(
      [
        { id: 'a', sender_id: 'them', content: '你好', created_at: at, audio_clip: 'a-h' },
        { id: 'b', sender_id: 'me', content: '我很好', created_at: at, audio_clip: 'b-h' },
        { id: 'c', sender_id: 'them', content: '看', created_at: at, attachment: { kind: 'image' }, audio_clip: null },
        { id: 'd', sender_id: 'them', content: '明天', created_at: at, audio_clip: null },
      ],
      'me',
    );
    expect(n).toBe(1);
    expect(api.fetchMessageAudio.mock.calls.map((c) => c[0])).toEqual(['a']);
  });

  it('background sync fetches what the server lists and skips what is cached', async () => {
    cache.store.set(clipCacheKey('x-1'), blob('x'));
    api.getChatClips.mockResolvedValue({ clips: [{ message_id: 'x', conversation_id: 'c', clip: 'x-1' }, { message_id: 'y', conversation_id: 'c', clip: 'y-1' }] });
    api.fetchMessageAudio.mockResolvedValue({ blob: blob('y'), clip: 'y-1' });
    expect(await prefetchChatClipsInSync()).toBe(1);
    expect(api.fetchMessageAudio).toHaveBeenCalledWith('y');
  });
});
