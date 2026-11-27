import { describe, expect, it } from 'vitest';
import {
  activeLineIndex,
  checkWatchChunk,
  firstUrlIn,
  lineEndCrossed,
  lineIndexAt,
  linePauseMs,
  lineSeekMs,
  nextWatchReveal,
  nextWatchSpeed,
  parseGeminiWatchLines,
  parseTimeSeconds,
  parseWatchSpeed,
  parseYouTubeVideoId,
  planWatchChunks,
  resumeAtMs,
  stepLine,
  tidyWatchLines,
  watchClock,
  watchStatusLine,
} from './index';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeVideoId', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=AbCdEf123`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/embed/${ID}?start=10`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`youtu.be/${ID}`],
    [`www.youtube.com/watch?v=${ID}`],
    [ID],
    [`小欢喜 第1集 https://youtu.be/${ID}?si=xyz`],
    [`Check this out: https://www.youtube.com/watch?v=${ID}.`],
  ])('reads %s', (input) => {
    expect(parseYouTubeVideoId(input)).toBe(ID);
  });

  it.each([
    [''],
    ['hello'],
    ['https://www.youtube.com/channel/UC123'],
    ['https://www.youtube.com/playlist?list=PL123'],
    ['https://vimeo.com/12345678901'],
    ['https://www.youtube.com/watch?v=short'],
    ['https://example.com/watch?v=dQw4w9WgXcQ'],
    ['dQw4w9WgXc'],
  ])('refuses %s', (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });

  it('finds the first link in a share text', () => {
    expect(firstUrlIn('watch https://youtu.be/abc), ok')).toBe('https://youtu.be/abc');
    expect(firstUrlIn('no link')).toBeNull();
  });
});

const lines = [
  { start_ms: 1000, end_ms: 3000 },
  { start_ms: 3000, end_ms: 5000 },
  { start_ms: 8000, end_ms: 9500 },
];

describe('line rules', () => {
  it('finds the line at a time', () => {
    expect(lineIndexAt(lines, 0)).toBe(-1);
    expect(lineIndexAt(lines, 1000)).toBe(0);
    expect(lineIndexAt(lines, 2999)).toBe(0);
    expect(lineIndexAt(lines, 3000)).toBe(1);
    expect(lineIndexAt(lines, 7000)).toBe(1);
    expect(lineIndexAt(lines, 99999)).toBe(2);
  });

  it('seeks a little early and pauses a little late, never into the next line', () => {
    expect(lineSeekMs(lines, 0)).toBe(750);
    expect(lineSeekMs([{ start_ms: 100, end_ms: 500 }], 0)).toBe(0);
    expect(linePauseMs(lines, 0)).toBe(3000);
    expect(linePauseMs(lines, 1)).toBe(5200);
    expect(linePauseMs(lines, 2)).toBe(9700);
  });

  it('keeps the focused line on screen from its seek point, and a while after pausing', () => {
    expect(activeLineIndex(lines, 2800, 1, true)).toBe(1);
    expect(activeLineIndex(lines, 2800, null, true)).toBe(0);
    expect(activeLineIndex(lines, 3100, 0, false)).toBe(0);
    expect(activeLineIndex(lines, 3100, 0, true)).toBe(1);
    expect(activeLineIndex(lines, 5000, 0, false)).toBe(1);
  });

  it('pauses when a line end is played through, not on a seek', () => {
    expect(lineEndCrossed(lines, 2900, 3050, null)).toBe(0);
    expect(lineEndCrossed(lines, 2900, 2950, null)).toBeNull();
    expect(lineEndCrossed(lines, 5100, 5300, null)).toBe(1);
    expect(lineEndCrossed(lines, 1000, 6000, null)).toBeNull();
    expect(lineEndCrossed(lines, 3050, 2900, null)).toBeNull();
    // Replaying line 1 from its seek point (inside line 0): the pause is at line 1's end, not line 0's.
    expect(lineEndCrossed(lines, 2750, 3050, 1)).toBeNull();
  });

  it('steps between lines', () => {
    expect(stepLine(3, -1, 1)).toBe(0);
    expect(stepLine(3, -1, -1)).toBe(0);
    expect(stepLine(3, 0, -1)).toBe(0);
    expect(stepLine(3, 2, 1)).toBe(2);
    expect(stepLine(3, 1, 1)).toBe(2);
    expect(stepLine(0, 0, 1)).toBe(-1);
  });

  it('reveals step by step', () => {
    expect(nextWatchReveal('listen', true, true)).toBe('hanzi');
    expect(nextWatchReveal('hanzi', true, true)).toBe('pinyin');
    expect(nextWatchReveal('hanzi', false, true)).toBe('english');
    expect(nextWatchReveal('pinyin', true, false)).toBe('listen');
    expect(nextWatchReveal('english', true, true)).toBe('listen');
  });

  it('cycles speeds', () => {
    expect(nextWatchSpeed(1)).toBe(0.75);
    expect(nextWatchSpeed(0.75)).toBe(0.5);
    expect(nextWatchSpeed(0.5)).toBe(1);
    expect(nextWatchSpeed(2)).toBe(1);
    expect(parseWatchSpeed('0.5')).toBe(0.5);
    expect(parseWatchSpeed('fast')).toBe(1);
  });

  it('labels', () => {
    expect(watchClock(65_000)).toBe('1:05');
    expect(watchClock(3_725_000)).toBe('1:02:05');
    expect(resumeAtMs(120_000, 2_700_000)).toBe(120_000);
    expect(resumeAtMs(2_690_000, 2_700_000)).toBe(0);
    expect(resumeAtMs(3_000, 2_700_000)).toBe(0);
    expect(watchStatusLine({ status: 'transcribing', chunks_done: 2, chunks_total: 9 })).toBe('Making the transcript… (part 3 of 9)');
    expect(watchStatusLine({ status: 'failed', error: 'nope' })).toBe("Couldn't make the transcript: nope");
  });
});

describe('transcript', () => {
  it('plans 5-minute windows, a short tail joining the last', () => {
    expect(planWatchChunks(45 * 60_000).length).toBe(9);
    const p = planWatchChunks(11 * 60_000);
    expect(p.map((c) => [c.start_ms, c.end_ms])).toEqual([
      [0, 300_000],
      [300_000, 660_000],
    ]);
    expect(planWatchChunks(0)).toEqual([]);
  });

  it('reads times in several shapes', () => {
    expect(parseTimeSeconds(75.4)).toBe(75.4);
    expect(parseTimeSeconds('75.4')).toBe(75.4);
    expect(parseTimeSeconds('1:15.5')).toBe(75.5);
    expect(parseTimeSeconds('01:01:15')).toBe(3675);
    expect(parseTimeSeconds('12s')).toBe(12);
    expect(Number.isNaN(parseTimeSeconds('soon'))).toBe(true);
  });

  it('parses absolute times and shifts relative ones', () => {
    const w = { start_ms: 300_000, end_ms: 600_000 };
    const abs = parseGeminiWatchLines(JSON.stringify([{ start: 301.2, end: 303, zh: '你回来了？' }, { start: '5:05', end: '5:07', zh: '嗯，刚到。' }]), w);
    expect(abs.map((l) => l.start_ms)).toEqual([301_200, 305_000]);
    const rel = parseGeminiWatchLines(JSON.stringify({ lines: [{ start: 1.2, end: 3, zh: '你回来了？' }, { start: 5, end: 7, zh: '嗯，刚到。' }, { start: 'x', zh: '坏' }, { start: 9, zh: 'OK' }] }), w);
    expect(rel.map((l) => [l.start_ms, l.end_ms])).toEqual([
      [301_200, 303_000],
      [305_000, 307_000],
    ]);
    expect(() => parseGeminiWatchLines('not json', w)).toThrow();
  });

  it('flags implausible answers', () => {
    const w = { start_ms: 0, end_ms: 300_000 };
    const same = Array.from({ length: 8 }, (_, i) => ({ start_ms: 1000 + i, end_ms: 2000, zh: '好', speaker: null }));
    expect(checkWatchChunk(same, w)).toMatch(/same time/);
    const ok = Array.from({ length: 8 }, (_, i) => ({ start_ms: 1000 + i * 20_000, end_ms: 3000 + i * 20_000, zh: '好', speaker: null }));
    expect(checkWatchChunk(ok, w)).toBeNull();
  });

  it('tidies lines: order, merged repeats, ends', () => {
    const out = tidyWatchLines([
      { start_ms: 5000, end_ms: 5000, zh: '我先走了。', speaker: null },
      { start_ms: 1000, end_ms: 2500, zh: '你吃饭了吗？', speaker: '妈妈' },
      { start_ms: 2000, end_ms: 4000, zh: '你吃饭了吗？', speaker: '妈妈' },
      { start_ms: 4200, end_ms: 4900, zh: '吃了。', speaker: null },
      { start_ms: 9000, end_ms: 9000, zh: 'OK', speaker: null },
    ]);
    expect(out.map((l) => [l.i, l.start_ms, l.end_ms, l.zh])).toEqual([
      [0, 1000, 4200, '你吃饭了吗？'],
      [1, 4200, 5000, '吃了。'],
      [2, 5000, 6000, '我先走了。'],
    ]);
  });
});
