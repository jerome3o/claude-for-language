import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getChatClips: vi.fn(),
  getChatListening: vi.fn(),
  putChatListeningDefault: vi.fn(),
  putConversationListening: vi.fn(),
}));
const cache = vi.hoisted(() => ({ store: new Map<string, Blob>() }));

vi.mock('../api/chat', () => api);
const tts = vi.hoisted(() => ({ getTTSWithCache: vi.fn() }));
vi.mock('./audioCache', () => ({
  isAudioCached: vi.fn(async (k: string) => cache.store.has(k)),
}));
vi.mock('./ttsCache', () => ({
  getTTSWithCache: tts.getTTSWithCache,
  ttsCacheKey: (text: string, speed: number, voice: string) => `tts/${text}|${voice}|${speed}`,
}));

import {
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
  tts.getTTSWithCache.mockReset();
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

describe('clips (the Read-aloud path)', () => {
  const V = { voice: 'Chinese (Mandarin)_Radio_Host', speed: 0.6 };

  it('plays the Read-aloud clip for the text in that voice', async () => {
    tts.getTTSWithCache.mockResolvedValue(blob('a'));
    expect(await getMessageClip('你好', V)).toBeTruthy();
    expect(tts.getTTSWithCache).toHaveBeenCalledWith('你好', 0.6, V.voice);
  });

  it('prefetches the other person’s Chinese text messages that are not cached yet', async () => {
    tts.getTTSWithCache.mockImplementation(async (t: string) => blob(t));
    cache.store.set(`tts/明天|${V.voice}|0.6`, blob('x'));
    const at = '2026-10-03T10:00:00.000Z';
    const n = await prefetchMessageClips(
      [
        { id: 'a', sender_id: 'them', content: '你好', created_at: at },
        { id: 'b', sender_id: 'me', content: '我很好', created_at: at },
        { id: 'c', sender_id: 'them', content: '看', created_at: at, attachment: { kind: 'image' } },
        { id: 'd', sender_id: 'them', content: '明天', created_at: at },
        { id: 'e', sender_id: 'them', content: 'ok', created_at: at },
      ],
      'me',
      () => V,
    );
    expect(n).toBe(1);
    expect(tts.getTTSWithCache.mock.calls.map((c) => c[0])).toEqual(['你好']);
  });

  it('background sync fetches what the server lists in the voice it names, skipping what is cached', async () => {
    cache.store.set('tts/早|v1|0.6', blob('x'));
    api.getChatClips.mockResolvedValue({ clips: [
      { message_id: 'x', conversation_id: 'c', text: '早', voice_id: 'v1', speed: 0.6 },
      { message_id: 'y', conversation_id: 'c', text: '晚安', voice_id: 'v2', speed: 0.6 },
    ] });
    tts.getTTSWithCache.mockResolvedValue(blob('y'));
    expect(await prefetchChatClipsInSync()).toBe(1);
    expect(tts.getTTSWithCache).toHaveBeenCalledWith('晚安', 0.6, 'v2');
  });
});
