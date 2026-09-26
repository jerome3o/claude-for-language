import { describe, it, expect } from 'vitest';
import { formatOffset, groupTurns, mergeTranscript, parseTimestamp, transcriptToText } from './transcript';

const seg = (id: string, user_id: string, start_ms: number, end_ms: number, text = id, translation: string | null = null) =>
  ({ id, user_id, start_ms, end_ms, text, translation });

describe('mergeTranscript', () => {
  it('interleaves both speakers by start time', () => {
    const merged = mergeTranscript([seg('t2', 'tutor', 5000, 7000), seg('s1', 'student', 1000, 4000), seg('t1', 'tutor', 0, 900)]);
    expect(merged.map((s) => s.id)).toEqual(['t1', 's1', 't2']);
  });
});

describe('formatOffset', () => {
  it('formats minutes and hours', () => {
    expect(formatOffset(0)).toBe('0:00');
    expect(formatOffset(245_000)).toBe('4:05');
    expect(formatOffset(3_729_000)).toBe('1:02:09');
    expect(formatOffset(-5)).toBe('0:00');
  });
});

describe('parseTimestamp', () => {
  it('reads numbers, seconds strings and clock strings', () => {
    expect(parseTimestamp(12.5)).toBe(12.5);
    expect(parseTimestamp('83.5')).toBe(83.5);
    expect(parseTimestamp('1:23')).toBe(83);
    expect(parseTimestamp('01:23.5')).toBe(83.5);
    expect(parseTimestamp('1:02:03')).toBe(3723);
  });
  it('rejects junk', () => {
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('1:xx')).toBeNull();
    expect(parseTimestamp(-1)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
  });
});

describe('groupTurns', () => {
  it('joins close segments by the same speaker, splits on a speaker change or a long pause', () => {
    const merged = [seg('a', 'x', 0, 1000), seg('b', 'x', 2000, 3000), seg('c', 'y', 3100, 4000), seg('d', 'y', 9000, 9500)];
    expect(groupTurns(merged).map((t) => t.map((s) => s.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});

describe('transcriptToText', () => {
  it('prefixes offsets and names, optionally translations', () => {
    const text = transcriptToText(
      [seg('a', 't', 1000, 2000, '你今天怎么样？', 'How are you today?'), seg('b', 's', 65_000, 66_000, '我很好, but 有点累')],
      { t: '王老师', s: 'Jerome' },
      1000,
      { translations: true },
    );
    expect(text).toBe('[0:00] 王老师: 你今天怎么样？\n    (How are you today?)\n[1:04] Jerome: 我很好, but 有点累');
  });
});
