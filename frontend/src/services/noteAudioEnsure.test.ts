import { describe, it, expect, beforeEach, vi } from 'vitest';

const ensureMock = vi.fn();
vi.mock('../api/client', () => ({ ensureNoteAudio: (...a: unknown[]) => ensureMock(...a) }));

import { db } from '../db/database';
import {
  ENSURE_MAX_ATTEMPTS,
  ENSURE_RETRY_MS,
  ensureAudioForNote,
  isPending,
  mayAsk,
  needsAudio,
  reportBrokenClip,
  resetEnsureState,
} from './noteAudioEnsure';

const NOTE = { id: 'n1', audio_url: null, sentence_clue: '今天刮风了。', sentence_clue_audio_url: null };

describe('web ensure-audio (docs/AUDIO.md)', () => {
  beforeEach(async () => {
    resetEnsureState();
    ensureMock.mockReset();
    await db.notes.clear();
  });

  it('asks only when a clip is missing or failed to load', () => {
    expect(needsAudio({ audio_url: null, sentence_clue: null, sentence_clue_audio_url: null })).toBe(true);
    expect(needsAudio({ audio_url: 'a', sentence_clue: '今天。', sentence_clue_audio_url: null })).toBe(true);
    expect(needsAudio({ audio_url: 'a', sentence_clue: '  ', sentence_clue_audio_url: null })).toBe(false);
    expect(needsAudio({ audio_url: 'a', sentence_clue: '今天。', sentence_clue_audio_url: 'b' })).toBe(false);
    expect(needsAudio({ audio_url: 'a', sentence_clue: null, sentence_clue_audio_url: null }, ['a'])).toBe(true);
  });

  it('throttles per note: every 20 s, at most 6 times', () => {
    const m = new Map<string, { at: number; count: number }>();
    expect(mayAsk(m, 'n1', 0)).toBe(true);
    m.set('n1', { at: 1000, count: 1 });
    expect(mayAsk(m, 'n1', 1000 + ENSURE_RETRY_MS - 1)).toBe(false);
    expect(mayAsk(m, 'n1', 1000 + ENSURE_RETRY_MS)).toBe(true);
    m.set('n1', { at: 0, count: ENSURE_MAX_ATTEMPTS });
    expect(mayAsk(m, 'n1', 10 ** 9)).toBe(false);
  });

  it('writes the clips that came back into IndexedDB and reports queued ones as pending', async () => {
    await db.notes.put({ ...NOTE, deck_id: 'd', hanzi: '刮风', pinyin: 'guā fēng', english: 'windy', updated_at: 'old' } as never);
    ensureMock.mockResolvedValue({
      note: { ...NOTE, audio_url: 'generated/n1_a.mp3', audio_provider: 'minimax', updated_at: '2026-10-03 12:00:00' },
      word: 'generated',
      sentence: 'queued',
    });
    const res = await ensureAudioForNote(NOTE, 0);
    expect(ensureMock).toHaveBeenCalledWith('n1', []);
    expect(res?.patch).toEqual({ audio_url: 'generated/n1_a.mp3', audio_provider: 'minimax' });
    expect(isPending(res!.response.word)).toBe(false);
    expect(isPending(res!.response.sentence)).toBe(true);
    const stored = await db.notes.get('n1');
    expect(stored?.audio_url).toBe('generated/n1_a.mp3');
    // throttled straight after
    expect(await ensureAudioForNote(NOTE, 1)).toBeNull();
    expect(ensureMock).toHaveBeenCalledTimes(1);
  });

  it('a clip that failed to play is reported as broken, and asked about at once', async () => {
    const note = { id: 'n2', audio_url: 'generated/gone.mp3', sentence_clue: null, sentence_clue_audio_url: null };
    ensureMock.mockResolvedValue({ note: null, word: 'ok', sentence: 'none' });
    expect(await ensureAudioForNote(note, 0)).toBeNull(); // nothing missing, nothing broken: no call
    reportBrokenClip('n2', 'generated/gone.mp3');
    await ensureAudioForNote(note, 5);
    expect(ensureMock).toHaveBeenCalledWith('n2', ['generated/gone.mp3']);
  });
});
