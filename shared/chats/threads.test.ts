import { describe, it, expect } from 'vitest';
import { groupQuestionThreads, sqliteToIso } from './threads';

const q = (id: string, note_id: string, asked_at: string, question = 'q') => ({ id, note_id, question, answer: 'a', asked_at });

describe('groupQuestionThreads', () => {
  it('joins questions on one card within the gap and splits across cards', () => {
    const rows = [
      q('a', 'n1', '2026-09-25T10:00:00Z', 'first'),
      q('b', 'n1', '2026-09-25T10:05:00Z', 'second'),
      q('c', 'n2', '2026-09-25T10:06:00Z', 'other card'),
      q('d', 'n1', '2026-09-25T12:00:00Z', 'much later'),
    ];
    const threads = groupQuestionThreads(rows);
    expect(threads.map(t => t.id)).toEqual(['d', 'c', 'a']);
    expect(threads[2].questions.map(x => x.question)).toEqual(['first', 'second']);
    expect(threads[2].started_at).toBe('2026-09-25T10:00:00Z');
    expect(threads[2].last_at).toBe('2026-09-25T10:05:00Z');
    expect(threads[0].questions).toHaveLength(1);
  });

  it('does not care about input order and keeps questions oldest-first inside a thread', () => {
    const rows = [q('b', 'n1', '2026-09-25T10:05:00Z'), q('a', 'n1', '2026-09-25T10:00:00Z')];
    const [thread] = groupQuestionThreads(rows);
    expect(thread.id).toBe('a');
    expect(thread.questions.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('interleaved cards each keep their own open thread', () => {
    const rows = [
      q('a', 'n1', '2026-09-25T10:00:00Z'),
      q('b', 'n2', '2026-09-25T10:01:00Z'),
      q('c', 'n1', '2026-09-25T10:02:00Z'),
    ];
    const threads = groupQuestionThreads(rows);
    expect(threads).toHaveLength(2);
    expect(threads.find(t => t.note_id === 'n1')!.questions.map(x => x.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for no rows', () => {
    expect(groupQuestionThreads([])).toEqual([]);
  });
});

describe('sqliteToIso', () => {
  it('converts the datetime(now) format and leaves ISO alone', () => {
    expect(sqliteToIso('2026-09-25 10:01:02')).toBe('2026-09-25T10:01:02Z');
    expect(sqliteToIso('2026-09-25T10:01:02.000Z')).toBe('2026-09-25T10:01:02.000Z');
  });
});
