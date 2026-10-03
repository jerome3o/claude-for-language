import { describe, expect, it } from 'vitest';
import { continuesLesson, groupCallsByLesson, groupIntoLessons, LESSON_GAP_MS, lessonOpen } from './lessons';

const t = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00Z`);

describe('lessons: calls within 2 hours of each other are one lesson', () => {
  it('groups 2 Oct 2026: four calls (one 4 s accident) are one lesson', () => {
    const calls = [
      { id: 'a', scope: 'rel', start: t('12:31'), end: t('12:53') },
      { id: 'b', scope: 'rel', start: t('12:54'), end: t('13:11') },
      { id: 'c', scope: 'rel', start: t('13:12'), end: t('13:28') },
      { id: 'd', scope: 'rel', start: t('13:32'), end: t('13:32') + 4000 },
    ];
    const g = groupIntoLessons(calls);
    expect([...g.values()]).toEqual(['a', 'a', 'a', 'a']);
  });

  it('a gap over 2 hours starts a new lesson; exactly 2 hours still continues; a live call keeps it open', () => {
    const calls = [
      { id: 'x1', scope: 'rel', start: t('09:00'), end: t('10:00') },
      { id: 'x2', scope: 'rel', start: t('10:00') + LESSON_GAP_MS, end: t('10:30') },
      { id: 'x3', scope: 'rel', start: t('10:30') + LESSON_GAP_MS + 1, end: null },
      { id: 'x4', scope: 'rel', start: t('13:00'), end: t('13:10') },
    ];
    const g = groupIntoLessons(calls);
    expect(g.get('x2')).toBe('x1');
    expect(g.get('x3')).toBe('x3');
    expect(g.get('x4')).toBe('x3'); // x3 is still live
  });

  it('never mixes different people (scopes)', () => {
    const g = groupIntoLessons([
      { id: 'p', scope: 'rel-1', start: t('12:00'), end: t('12:30') },
      { id: 'q', scope: 'rel-2', start: t('12:31'), end: t('12:40') },
    ]);
    expect(g.get('q')).toBe('q');
  });

  it('continuesLesson / lessonOpen', () => {
    expect(continuesLesson(null, t('12:00'))).toBe(true);
    expect(continuesLesson(t('12:00'), t('14:00'))).toBe(true);
    expect(continuesLesson(t('12:00'), t('14:00') + 1)).toBe(false);
    expect(lessonOpen(t('12:00'), false, t('13:59'))).toBe(true);
    expect(lessonOpen(t('12:00'), false, t('14:01'))).toBe(false);
    expect(lessonOpen(null, true, t('23:00'))).toBe(true);
  });

  it('the Past calls list: one entry per lesson, newest lesson first, calls oldest first inside', () => {
    const rows = [
      { id: 'd', lesson_id: 'a', created_at: '2026-10-02 13:32:16' },
      { id: 'c', lesson_id: 'a', created_at: '2026-10-02 13:12:01' },
      { id: 'z', lesson_id: 'z', created_at: '2026-09-30 08:42:38' },
      { id: 'a', lesson_id: 'a', created_at: '2026-10-02 12:31:12' },
      { id: 'n', lesson_id: null, created_at: '2026-09-01 08:00:00' },
    ];
    const g = groupCallsByLesson(rows);
    expect(g.map((x) => x.lessonId)).toEqual(['a', 'z', 'call:n']);
    expect(g[0].calls.map((c) => c.id)).toEqual(['a', 'c', 'd']);
  });

  it('round 5: the window is 2 hours — a lesson left at 12:00 and rejoined at 13:45 is one lesson, 14:01 is not', () => {
    expect(LESSON_GAP_MS).toBe(2 * 60 * 60 * 1000);
    expect(continuesLesson(t('12:00'), t('13:45'))).toBe(true);
    expect(continuesLesson(t('12:00'), t('14:00'))).toBe(true);
    expect(continuesLesson(t('12:00'), t('14:01'))).toBe(false);
    expect(lessonOpen(t('12:00'), false, t('13:59'))).toBe(true);
    expect(lessonOpen(t('12:00'), false, t('14:00') + 1)).toBe(false);
    const g = groupIntoLessons([
      { id: 'a', scope: 'rel', start: t('11:00'), end: t('11:40') },
      { id: 'b', scope: 'rel', start: t('12:30'), end: t('13:00') }, // interrupted, back after 50 min
      { id: 'c', scope: 'rel', start: t('14:55'), end: t('15:10') }, // 1 h 55 after
      { id: 'd', scope: 'rel', start: t('17:11'), end: null }, // 2 h 1 after
    ]);
    expect([...g.values()]).toEqual(['a', 'a', 'a', 'd']);
  });
});
