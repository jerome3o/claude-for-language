import { describe, expect, it } from 'vitest';
import { continuesLesson, groupCallsByLesson, groupIntoLessons, LESSON_GAP_MS, lessonOpen } from './lessons';

const t = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00Z`);

describe('lessons: calls within 20 minutes of each other are one lesson', () => {
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

  it('a gap over 20 minutes starts a new lesson; exactly 20 still continues; a live call keeps it open', () => {
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
    expect(continuesLesson(t('12:00'), t('12:20'))).toBe(true);
    expect(continuesLesson(t('12:00'), t('12:20') + 1)).toBe(false);
    expect(lessonOpen(t('12:00'), false, t('12:19'))).toBe(true);
    expect(lessonOpen(t('12:00'), false, t('12:21'))).toBe(false);
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
});
