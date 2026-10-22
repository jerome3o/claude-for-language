/** Revise until right first time — the server side: outcomes on upload / backfill, the tutor's summaries. Real SQLite, every migration. */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { backfillCompletionOutcomes, dayIn, lessonRevisionSummaries, outcomeForUpload } from '../lesson-revision';
import { applyCustomLessonCompletion, listCustomLessonCompletions } from '../../db/queries';

let db: SqliteD1;
const exec = (sql: string, ...params: (string | number | null)[]) => db.raw.run(sql, params);

const SPEC = JSON.stringify({
  title: 'Tones',
  sections: [{ exercises: [{ type: 'note' }, { type: 'choice' }, { type: 'choice' }, { type: 'translate' }] }],
});
const attempt = (rows: Array<[number, boolean | null, number?]>) => ({
  started_at: '', duration_ms: 1,
  exercises: rows.map(([index, correct, retry]) => ({ section: 0, index, type: 'choice', correct, points: correct ? 1 : 0, max_points: correct === null ? 0 : 1, duration_ms: 1, ...(retry ? { retry } : {}) })),
});

beforeEach(async () => {
  db = await createSqliteD1();
  exec("INSERT INTO users (id, email, name, time_zone) VALUES ('u1', 'u1@example.com', 'u1', 'Europe/London')");
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l1', 'u1', 'Tones', ?)", SPEC);
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l2', 'u1', 'Perfect', ?)", SPEC);
  exec("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l3', 'u1', 'Legacy', ?)", SPEC);
});

describe('outcomes', () => {
  it('the device sends one, else it comes from the attempt (main-pass rows only)', () => {
    expect(outcomeForUpload({ keys: ['s0e1'], missed: [] }, null)).toEqual({ keys: ['s0e1'], missed: [] });
    expect(outcomeForUpload(undefined, attempt([[0, null], [1, false], [2, true], [1, true, 1]]))).toEqual({ keys: ['s0e1', 's0e2'], missed: ['s0e1'] });
    expect(outcomeForUpload(undefined, null)).toBeNull();
  });

  it('stored with the completion, listed, and backfilled for older rows from their attempts', async () => {
    await applyCustomLessonCompletion(db, 'u1', { id: 'c1', lesson_id: 'l1', correct: 1, total: 2, completed_at: '2026-10-01T09:00:00.000Z' }, { keys: ['s0e1', 's0e2'], missed: ['s0e2'] });
    exec("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at, rating) VALUES ('c2', 'u1', 'l2', 2, 2, '2026-10-02T09:00:00.000Z', 1)");
    exec("INSERT INTO custom_lesson_attempts (id, user_id, lesson_id, completed_at, duration_ms, spec, data) VALUES ('c2', 'u1', 'l2', '2026-10-02T09:00:00.000Z', 1, '{}', ?)", JSON.stringify(attempt([[1, true], [2, true]])));
    expect(await backfillCompletionOutcomes(db, 'u1')).toBe(1);
    expect(await backfillCompletionOutcomes(db, 'u1')).toBe(0);
    const rows = await listCustomLessonCompletions(db, 'u1');
    expect(Object.fromEntries(rows.map(r => [r.id, r.outcome]))).toEqual({
      c1: '{"keys":["s0e1","s0e2"],"missed":["s0e2"]}',
      c2: '{"keys":["s0e1","s0e2"],"missed":[]}',
    });
  });
});

describe('the tutor\'s summaries', () => {
  it('revision with a due day in the student\'s time zone; all right first time = done; legacy ratings', async () => {
    await applyCustomLessonCompletion(db, 'u1', { id: 'c1', lesson_id: 'l1', correct: 1, total: 3, completed_at: '2026-10-01T23:30:00.000Z' }, { keys: ['s0e1', 's0e2', 's0e3'], missed: ['s0e2', 's0e3'] });
    await applyCustomLessonCompletion(db, 'u1', { id: 'c2', lesson_id: 'l2', correct: 3, total: 3, completed_at: '2026-10-01T09:00:00.000Z' }, { keys: ['s0e1', 's0e2', 's0e3'], missed: [] });
    exec("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at, rating) VALUES ('c3', 'u1', 'l3', 2, 3, '2026-10-01T09:00:00.000Z', 0)");
    const now = Date.parse('2026-10-05T12:00:00.000Z');
    const s = await lessonRevisionSummaries(db, 'u1', ['l1', 'l2', 'l3'], now);
    // 23:30 UTC on 1 Oct is 00:30 on 2 Oct in London (BST) → due 9 Oct there.
    expect(s.get('l1')).toMatchObject({ status: 'revision', revision: 1, due_date: '2026-10-09', to_get_right: 2, percent: 33, retired: false, revision_label: 'Revision 1 due 9 Oct · 2 to get right' });
    expect(s.get('l2')).toMatchObject({ status: 'done', retired: true, next_revisit_at: null, revision_label: 'all right first time', percent: 100 });
    // Again without answers kept → a revision of the whole lesson (3 scored exercises).
    expect(s.get('l3')).toMatchObject({ status: 'revision', to_get_right: 3, revision_label: 'Revision 1 due 8 Oct · 3 to get right' });
  });

  it('dayIn falls back to UTC for an unknown zone', () => {
    expect(dayIn(Date.parse('2026-10-01T23:30:00.000Z'), 'Not/AZone')).toBe('2026-10-01');
    expect(dayIn(Date.parse('2026-10-01T23:30:00.000Z'), 'Asia/Shanghai')).toBe('2026-10-02');
  });
});
