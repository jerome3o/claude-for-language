import { describe, expect, it } from 'vitest';
import {
  backSectionTarget,
  buildFeedbackEvent,
  flaggedRowIndex,
  nextSectionTarget,
  pickFeedbackEvent,
  rowIndexAt,
  sectionGraceMs,
  summarizeLessonFeedback,
  type AudioLessonFeedbackEvent,
} from './feedback';
import { transcriptRows, type TranscriptRow } from './timeline';
import type { AudioLessonTranscriptLine } from './types';

const line = (start_ms: number, text: string, extra: Partial<AudioLessonTranscriptLine> = {}): AudioLessonTranscriptLine => ({
  start_ms, lang: 'zh', voice: 'teacher', text, chapter: 0, ...extra,
});

// A story: each chunk ×3, its English, ×2 more → one row per chunk.
const LINES: AudioLessonTranscriptLine[] = [
  line(0, '小明起床了。', { pinyin: 'Xiǎomíng qǐchuáng le.', english: 'Xiaoming got up' }),
  line(2000, '小明起床了。'),
  line(4000, '小明起床了。'),
  line(6000, 'Xiaoming got up.', { lang: 'en', voice: 'recap' }),
  line(8000, '小明起床了。'),
  line(10_000, '小明起床了。'),
  line(12_000, '他很累。', { pinyin: 'tā hěn lèi.', english: 'He is tired.' }),
  line(14_000, '他很累。'),
  line(16_000, '他很累。'),
  line(18_000, 'He is tired.', { lang: 'en', voice: 'recap' }),
  line(20_000, '他很累。'),
  line(22_000, '他很累。'),
  line(24_000, '他去公司。', { pinyin: 'tā qù gōngsī.', english: 'He goes to the office.' }),
];
const ROWS = transcriptRows(LINES);
const CHAPTERS = [{ title: 'One', start_ms: 0 }, { title: 'Two', start_ms: 12_000 }];

describe('sections', () => {
  it('a row is a sentence with its repeats', () => {
    expect(ROWS.map((r) => [r.start_ms, r.text, r.repeat, r.again])).toEqual([
      [0, '小明起床了。', 3, 2],
      [12_000, '他很累。', 3, 2],
      [24_000, '他去公司。', undefined, undefined],
    ]);
    expect(rowIndexAt(ROWS, -5)).toBe(-1);
    expect(rowIndexAt(ROWS, 11_998)).toBe(0);
    expect(rowIndexAt(ROWS, 11_999)).toBe(1); // the ±1 ms edge, like transcriptIndexAt
    expect(rowIndexAt(ROWS, 99_000)).toBe(2);
  });

  it('back a section: this row from its start, or the one before within 2 s of listening', () => {
    expect(backSectionTarget(ROWS, 18_000)).toEqual({ target_ms: 12_000, row_index: 1, kind: 'again' });
    expect(backSectionTarget(ROWS, 14_000)).toEqual({ target_ms: 12_000, row_index: 1, kind: 'again' });
    expect(backSectionTarget(ROWS, 13_999)).toEqual({ target_ms: 0, row_index: 0, kind: 'back_section' });
    expect(backSectionTarget(ROWS, 12_000)).toEqual({ target_ms: 0, row_index: 0, kind: 'back_section' });
    // At 0.75× two seconds of listening are 1.5 s of audio; at 1.25×, 2.5 s.
    expect(sectionGraceMs(0.75)).toBe(1500);
    expect(sectionGraceMs(1.25)).toBe(2500);
    expect(sectionGraceMs(Number.NaN)).toBe(2000);
    expect(backSectionTarget(ROWS, 13_600, 0.75)?.kind).toBe('again');
    expect(backSectionTarget(ROWS, 14_400, 1.25)?.kind).toBe('back_section');
    // The first row restarts itself; before it → the start; no transcript → null (chapters instead).
    expect(backSectionTarget(ROWS, 500)).toEqual({ target_ms: 0, row_index: 0, kind: 'again' });
    expect(backSectionTarget(ROWS, -10)).toEqual({ target_ms: 0, row_index: -1, kind: 'again' });
    expect(backSectionTarget([], 5000)).toBeNull();
  });

  it('next section: the next row, none after the last', () => {
    expect(nextSectionTarget(ROWS, 3000)).toEqual({ target_ms: 12_000, row_index: 1, kind: 'skip' });
    expect(nextSectionTarget(ROWS, 25_000)).toBeNull();
    expect(nextSectionTarget(ROWS, -5)).toEqual({ target_ms: 0, row_index: 0, kind: 'skip' });
    expect(nextSectionTarget([], 0)).toBeNull();
  });
});

function ev(kind: AudioLessonFeedbackEvent['kind'], positionMs: number, id = `ev-${kind}-${positionMs}`, speed = 1): AudioLessonFeedbackEvent {
  return buildFeedbackEvent({
    id, lessonId: 'al-1', kind, where: 'lock_screen', positionMs, speed, audioVersion: 'v3',
    createdAt: new Date(Date.UTC(2026, 10, 23, 8, 0, 0) + positionMs).toISOString(), rows: ROWS, chapters: CHAPTERS,
  });
}

describe('events', () => {
  it('keeps the row playing and the one before it', () => {
    const e = ev('too_hard', 15_000.4);
    expect(e).toMatchObject({ position_ms: 15_000, chapter_index: 1, row_index: 1, audio_version: 'v3', where: 'lock_screen' });
    expect(e.row).toEqual({ index: 1, start_ms: 12_000, text: '他很累。', pinyin: 'tā hěn lèi.', english: 'He is tired.' });
    expect(e.previous_row?.text).toBe('小明起床了。');
    expect(ev('too_hard', 100).previous_row).toBeNull();
    const before = buildFeedbackEvent({ id: 'x1234567', lessonId: 'a', kind: 'too_hard', where: 'player', positionMs: 5, speed: 1, audioVersion: null, createdAt: 'now', rows: [] as TranscriptRow[], chapters: [] });
    expect(before).toMatchObject({ row_index: -1, row: null, previous_row: null, chapter_index: 0 });
  });

  it('an event is about the row he reacted to', () => {
    expect(flaggedRowIndex(ev('too_hard', 15_000))).toBe(1);
    expect(flaggedRowIndex(ev('too_hard', 13_000))).toBe(0); // reaction lag: just after a new row started
    expect(flaggedRowIndex(ev('too_hard', 13_400, 'slow', 0.75))).toBe(0); // 1.4 s of audio < the 1.5 s grace at 0.75×
    expect(flaggedRowIndex(ev('too_hard', 13_600, 'slow2', 0.75))).toBe(1);
    expect(flaggedRowIndex(ev('again', 15_000))).toBe(1);
    expect(flaggedRowIndex(ev('back_section', 12_500))).toBe(0);
    expect(flaggedRowIndex(ev('skip', 5_000))).toBe(0);
    expect(flaggedRowIndex(ev('too_hard', 100))).toBe(0);
  });

  it('checks an upload', () => {
    const good = ev('too_hard', 15_000, 'abc-123-def');
    expect(pickFeedbackEvent(JSON.parse(JSON.stringify(good)), 'al-1')).toEqual(good);
    expect(pickFeedbackEvent({ ...good, audio_lesson_id: 'other' }, 'al-1')).toBeNull();
    expect(pickFeedbackEvent({ ...good, kind: 'meh' }, 'al-1')).toBeNull();
    expect(pickFeedbackEvent({ ...good, id: 'x' }, 'al-1')).toBeNull();
    expect(pickFeedbackEvent({ ...good, position_ms: -1 }, 'al-1')).toBeNull();
    expect(pickFeedbackEvent({ ...good, created_at: 'soon' }, 'al-1')).toBeNull();
    expect(pickFeedbackEvent(null, 'al-1')).toBeNull();
    const loose = pickFeedbackEvent({ id: 'abcdefgh', kind: 'again', position_ms: 1.6, created_at: '2026-11-23T08:00:00Z', where: 'car', speed: 99, row: { index: -1, text: 'x' } }, 'al-1');
    expect(loose).toMatchObject({ where: 'player', speed: 1, position_ms: 2, row: null, row_index: -1, audio_version: null, created_at: '2026-11-23T08:00:00.000Z' });
    const long = pickFeedbackEvent({ ...good, row: { ...good.row, text: '好'.repeat(500) } }, 'al-1');
    expect(long?.row?.text.length).toBe(300);
  });
});

describe('summary for Claude', () => {
  it('ranks the rows he struggled with and says it in one line', () => {
    const events = [
      ev('too_hard', 15_000, 'a1'),
      ev('too_hard', 16_000, 'a2'),
      ev('again', 17_000, 'a3'),
      ev('back_section', 12_500, 'a4'), // back to row 0
      ev('skip', 25_000, 'a5'),
    ];
    const s = summarizeLessonFeedback(events);
    expect(s.counts).toEqual({ too_hard: 2, back_section: 1, again: 1, skip: 1 });
    expect(s.rows.map((r) => [r.index, r.too_hard, r.replays, r.skips])).toEqual([[1, 2, 1, 0], [0, 0, 1, 0], [2, 0, 0, 1]]);
    expect(s.furthest_ms).toBe(25_000);
    expect(s.line).toBe('Too hard ×2 · went back ×2 · skipped ×1 — hardest: 他很累。 (too hard ×2, replayed ×1)');
    expect(summarizeLessonFeedback([]).line).toBe('No feedback');
    expect(summarizeLessonFeedback([ev('skip', 1000)]).line).toBe('skipped ×1');
  });
});
