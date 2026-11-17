import { describe, it, expect } from 'vitest';
import { groupQuestions } from '../backfill';

const q = (id: string, note_id: string, asked_at: string) => ({ id, note_id, asked_at });
const ids = (groups: Array<Array<{ id: string }>>) => groups.map((g) => g.map((x) => x.id));

/** How the frozen note_questions rows are copied into card threads (the apps' old 30-minute grouping). */
describe('groupQuestions', () => {
  it('joins questions on one card within the gap and splits across cards', () => {
    const rows = [q('a', 'n1', '2026-09-25T10:00:00Z'), q('b', 'n1', '2026-09-25T10:05:00Z'), q('c', 'n2', '2026-09-25T10:06:00Z'), q('d', 'n1', '2026-09-25T12:00:00Z')];
    expect(ids(groupQuestions(rows))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('does not care about input order and keeps questions oldest-first inside a group', () => {
    expect(ids(groupQuestions([q('b', 'n1', '2026-09-25T10:05:00Z'), q('a', 'n1', '2026-09-25T10:00:00Z')]))).toEqual([['a', 'b']]);
  });

  it('interleaved cards each keep their own open group; the gap is measured from the previous question', () => {
    const rows = [q('a', 'n1', '2026-09-25T10:00:00Z'), q('b', 'n2', '2026-09-25T10:01:00Z'), q('c', 'n1', '2026-09-25T10:25:00Z'), q('d', 'n1', '2026-09-25T10:54:00Z')];
    expect(ids(groupQuestions(rows))).toEqual([['a', 'c', 'd'], ['b']]);
  });

  it('returns nothing for no rows', () => {
    expect(groupQuestions([])).toEqual([]);
  });
});
