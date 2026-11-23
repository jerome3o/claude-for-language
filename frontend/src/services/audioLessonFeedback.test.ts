import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../api/audioLessons', () => ({ postAudioLessonFeedback: vi.fn() }));
vi.mock('./analytics', () => ({ track: vi.fn() }));

import { postAudioLessonFeedback } from '../api/audioLessons';
import { track } from './analytics';
import {
  __resetAudioLessonFeedbackForTests,
  backSection,
  feedbackMediaHandlers,
  flushAudioLessonFeedback,
  listFeedbackEvents,
  nextSection,
  tooHard,
  tooHardRows,
  type FeedbackPlayer,
} from './audioLessonFeedback';
import { transcriptRows } from '@shared/audio-lesson/timeline';

const post = vi.mocked(postAudioLessonFeedback);

const rows = transcriptRows([
  { start_ms: 0, lang: 'zh', voice: 'teacher', text: '小明起床了。', pinyin: 'Xiǎomíng qǐchuáng le.', english: 'Xiaoming got up.', chapter: 0 },
  { start_ms: 10_000, lang: 'zh', voice: 'teacher', text: '他很累。', pinyin: 'tā hěn lèi.', english: 'He is tired.', chapter: 0 },
  { start_ms: 20_000, lang: 'zh', voice: 'teacher', text: '他去公司。', chapter: 1 },
]);

function player(at: number, extra: Partial<FeedbackPlayer> = {}): FeedbackPlayer & { seeks: number[] } {
  const seeks: number[] = [];
  return {
    lessonId: 'al-1', format: 'story', audioVersion: 'v2', rows, chapters: [{ title: 'A', start_ms: 0 }, { title: 'B', start_ms: 20_000 }],
    position: () => at, speed: () => 1, seekTo: (ms) => seeks.push(ms), seeks, ...extra,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  await __resetAudioLessonFeedbackForTests();
  post.mockReset();
  vi.mocked(track).mockReset();
});

describe('audio lesson feedback on the web', () => {
  it('"Too hard" is saved on the device first, posted, and marks the row', async () => {
    post.mockResolvedValue({ accepted: [], stored: 1, rejected: [] });
    const e = tooHard(player(15_000), 'player');
    expect(e).toMatchObject({ kind: 'too_hard', where: 'player', row_index: 1, position_ms: 15_000, audio_version: 'v2' });
    await settle();
    expect(post).toHaveBeenCalledWith('al-1', [expect.objectContaining({ id: e.id, kind: 'too_hard' })]);
    expect((await listFeedbackEvents('al-1'))[0].uploaded).toBe(1);
    expect(await tooHardRows('al-1')).toEqual(new Set([1]));
    expect(track).toHaveBeenCalledWith('audio_lesson.too_hard', { format: 'story', where: 'player' });
  });

  it('offline: kept until the sync posts it; a refusal never blocks the queue', async () => {
    post.mockRejectedValue(new TypeError('Failed to fetch'));
    tooHard(player(15_000), 'player');
    await settle();
    expect((await listFeedbackEvents('al-1'))[0].uploaded).toBe(0);
    expect(await flushAudioLessonFeedback()).toEqual({ sent: 0, failed: 0 });

    post.mockReset();
    post.mockRejectedValue(Object.assign(new Error('Audio lesson not found'), { status: 404 }));
    expect(await flushAudioLessonFeedback()).toEqual({ sent: 0, failed: 1 });
    expect((await listFeedbackEvents('al-1'))[0].uploaded).toBe(1);
    post.mockReset();
    expect(await flushAudioLessonFeedback()).toEqual({ sent: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();
  });

  it('back a section: this line again, or the one before within 2 s; recorded as again / back_section', async () => {
    post.mockResolvedValue({ accepted: [], stored: 1, rejected: [] });
    const later = player(15_000);
    expect(backSection(later, 'player')?.kind).toBe('again');
    expect(later.seeks).toEqual([10_000]);
    const early = player(11_000);
    expect(backSection(early, 'player')?.kind).toBe('back_section');
    expect(early.seeks).toEqual([0]);
    expect(track).toHaveBeenCalledWith('audio_lesson.back_section', { format: 'story', where: 'player', kind: 'back_section' });
    // No transcript: the previous chapter, nothing recorded.
    const bare = player(25_000, { rows: [] });
    expect(backSection(bare, 'player')).toBeNull();
    expect(bare.seeks).toEqual([20_000]);
    const next = player(5_000);
    expect(nextSection(next, 'player')?.kind).toBe('skip');
    expect(next.seeks).toEqual([10_000]);
    expect(nextSection(player(25_000), 'player')).toBeNull();
  });

  it('the Media Session ⏮ / ⏭ step sections (lock screen while the page is hidden)', async () => {
    post.mockResolvedValue({ accepted: [], stored: 1, rejected: [] });
    const p = player(15_000);
    const handlers = new Map(feedbackMediaHandlers(() => p));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    handlers.get('previoustrack')!({ action: 'previoustrack' });
    handlers.get('nexttrack')!({ action: 'nexttrack' });
    expect(p.seeks).toEqual([10_000, 20_000]);
    await settle();
    const events = await listFeedbackEvents('al-1');
    expect(events.map((e) => [e.kind, e.where])).toEqual(expect.arrayContaining([['again', 'lock_screen'], ['skip', 'lock_screen']]));
    // Before the lesson is in the player: nothing happens.
    expect(() => new Map(feedbackMediaHandlers(() => null)).get('previoustrack')!({ action: 'previoustrack' })).not.toThrow();
  });
});
