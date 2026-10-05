import { describe, expect, it } from 'vitest';
import { activitySummary, reduceActivity, reviewMarkOf, startActivity, validateActivitySpec, REVIEW_ACTIVITY_ID, type ActivitySession, type ReviewItem, type ReviewSpec } from './index';

const T = 'tutor-1';
const S = 'student-1';

const item = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => ({
  id, source: 'recording', event_id: id, flag_id: null, note_id: `n-${id}`, hanzi: '银行', pinyin: 'yínháng', english: 'bank',
  recording_key: `recordings/${id}.webm`, reference_key: `generated/${id}.mp3`, labels: ['Sounded off: 银 (tone)'], transcript: '音行',
  weak: [{ char: '银', kind: 'tone' }], flag_message: null, mark: null, recorded_at: '2026-10-01T10:00:00Z', ...over,
});

const spec: ReviewSpec = {
  id: REVIEW_ACTIVITY_ID, kind: 'review', title: 'Review together', level: 'beginner', topic: 'pronunciation', summary: 's',
  role_names: { a: 'Tutor', b: 'Student' }, tutor_role: 'a',
  items: [item('e1'), item('e2', { hanzi: '买', pinyin: 'mǎi', english: 'buy', reference_key: null, labels: ['Rated Again'] }), item('f1', { source: 'flag', event_id: null, flag_id: 'f1', recording_key: null, flag_message: 'tones?' })],
};

function start(): ActivitySession {
  return startActivity(spec, { sessionId: 'sess', starter: S, tutor: T, present: [T, S], names: { [T]: 'Minghui', [S]: 'Jerome' }, now: 1 });
}

describe('review together', () => {
  it('validates and starts with the tutor as host on item 0', () => {
    expect(validateActivitySpec(spec)).toEqual([]);
    const s = start();
    expect(s.host).toBe(T);
    expect(s.roles).toEqual({ a: T, b: S });
    expect(s.round).toBe(0);
    expect(s.data).toEqual({ play: 0, clip: null });
  });

  it('either person selects; selecting keeps the play counter (no replay on select)', () => {
    let s = reduceActivity(start(), { type: 'play_clip', clip: 'recording' }, S, 2)!;
    expect(s.data).toMatchObject({ play: 1, clip: 'recording' });
    s = reduceActivity(s, { type: 'select', index: 1 }, S, 3)!;
    expect(s.round).toBe(1);
    expect(s.data.play).toBe(1);
    s = reduceActivity(s, { type: 'select', index: 2 }, T, 4)!;
    expect(s.round).toBe(2);
    expect(reduceActivity(s, { type: 'select', index: 2 }, T, 5)).toBeNull(); // already there
    expect(reduceActivity(s, { type: 'select', index: 9 }, T, 5)).toBeNull();
    expect(reduceActivity(s, { type: 'select', index: 0 }, 'stranger', 5)).toBeNull();
  });

  it('plays only clips the item has, for both people', () => {
    let s = reduceActivity(start(), { type: 'select', index: 1 }, T, 2)!;
    expect(reduceActivity(s, { type: 'play_clip', clip: 'reference' }, T, 3)).toBeNull(); // no reference clip
    s = reduceActivity(s, { type: 'play_clip', clip: 'recording' }, T, 3)!;
    s = reduceActivity(s, { type: 'play_clip', clip: 'recording' }, S, 4)!;
    expect(s.data).toMatchObject({ play: 2, clip: 'recording' });
    expect(s.v).toBe(4);
  });

  it('only the tutor marks; a mark is the item result and shows in the summary', () => {
    const s0 = start();
    expect(reduceActivity(s0, { type: 'review_mark', status: 'listened' }, S, 2)).toBeNull();
    let s = reduceActivity(s0, { type: 'review_mark', status: 'needs_work', comment: '  Second tone: yín ' }, T, 2)!;
    expect(reviewMarkOf(s, 0)).toEqual({ status: 'needs_work', comment: 'Second tone: yín' });
    expect(reduceActivity(s, { type: 'review_mark', status: 'needs_work', comment: 'Second tone: yín' }, T, 3)).toBeNull(); // same again
    s = reduceActivity(s, { type: 'select', index: 2 }, S, 3)!;
    s = reduceActivity(s, { type: 'review_mark', status: 'listened' }, T, 4)!;
    expect(reviewMarkOf(s, 2)).toEqual({ status: 'listened', comment: null });
    expect(reviewMarkOf(s, 1)).toBeNull();
    s = reduceActivity(s, { type: 'finish' }, S, 5)!;
    expect(s.phase).toBe('done');
    expect(reduceActivity(s, { type: 'select', index: 0 }, T, 6)).toBeNull();
    const sum = activitySummary(s);
    expect(sum).toMatchObject({ kind: 'review', played: 2, scored: 0, total_rounds: 3, finished: true });
    expect(sum.lines).toEqual([
      '银行 (yínháng, bank) [Sounded off: 银 (tone)] — needs work: Second tone: yín',
      '银行 (yínháng, bank) [Sounded off: 银 (tone)] — listened',
    ]);
    // The host can take it up again after finishing.
    expect(reduceActivity(s, { type: 'restart' }, T, 7)!.phase).toBe('play');
  });

  it('an empty list takes no actions but can be finished', () => {
    const empty = startActivity({ ...spec, items: [] }, { sessionId: 'x', starter: T, tutor: T, present: [T, S], names: {}, now: 1 });
    expect(reduceActivity(empty, { type: 'play_clip', clip: 'recording' }, T, 2)).toBeNull();
    expect(reduceActivity(empty, { type: 'review_mark', status: 'listened' }, T, 2)).toBeNull();
    expect(reduceActivity(empty, { type: 'finish' }, T, 2)!.phase).toBe('done');
  });
});
