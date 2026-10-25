/**
 * "Skip this homework" (docs/HOMEWORK.md §3d) against real SQLite with every migration: a `skip`
 * event (migration 0139) sets the assignment's skipped_at for the tutor; an `undo` takes it back;
 * the tutor's library reads "Skipped by <student>"; nothing is deleted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrationsFrom, createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { recordEvents } from '../homework';
import { buildHomeworkLibrary, libraryStatusText, summarizeOneOffHomework } from '@shared/homework';
import { getAssignmentsByIds } from '../../db/homework-queries';
import { getSkipHandwriting, setSkipHandwriting } from '../skip-handwriting';

let db: SqliteD1;
const STUDENT = 'student-1';

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('student-1', 's@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('tutor-1', 't@x.test', 'Minghui', 'tutor')");
  db.raw.run(
    `INSERT INTO assignments (id, relationship_id, tutor_id, student_id, batch_id, kind, target_id, source_id, title, mode, due_date, item_ids, item_count, done_count, part_index, part_count, status, created_at)
     VALUES ('a1', 'rel', 'tutor-1', 'student-1', 'b', 'lesson', 'lesson-copy', 'src', 'Writing 把', 'one_off', '2026-10-16', NULL, 1, 0, 0, 1, 'active', '2026-10-13T09:00:00Z')`,
  );
});

describe('skip a homework', () => {
  it('skip → skipped_at for the tutor; undo → back; the row is never deleted', async () => {
    let r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'k1', assignment_id: 'a1', item_id: 'lesson-copy', result: 'skip', created_at: '2026-10-14T10:00:00Z' },
    ]);
    expect(r.accepted).toBe(1);
    expect(r.assignments[0]).toMatchObject({ status: 'active', skipped_at: '2026-10-14T10:00:00.000Z', done_count: 0 });
    const [a] = await getAssignmentsByIds(db as unknown as D1Database, ['a1']);
    expect(a.skipped_at).toBe('2026-10-14T10:00:00.000Z');

    const items = buildHomeworkLibrary({
      relationship_id: 'rel', student_id: STUDENT, student_name: 'Jerome', assignments: [a], decks: [], readers: [], today: '2026-10-17',
      lessons: [{ lesson_id: 'lesson-copy', library_item_id: 'src', title: 'Writing 把', created_at: '2026-10-13T09:00:00Z', completions: 0, last_completed_at: null }],
    });
    expect(libraryStatusText(items[0].status, items[0].student_name)).toBe('Skipped by Jerome');
    expect(summarizeOneOffHomework([a], '2026-10-17')).toMatchObject({ open: 0, overdue: 0, skipped: 1 });

    r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'u1', assignment_id: 'a1', item_id: 'lesson-copy', result: 'undo', undoes: 'k1', created_at: '2026-10-14T10:01:00Z' },
    ]);
    expect(r.assignments[0]).toMatchObject({ status: 'active', skipped_at: null });
  });

  it('finishing it anyway clears the skip', async () => {
    await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'k1', assignment_id: 'a1', item_id: 'lesson-copy', result: 'skip', created_at: '2026-10-14T10:00:00Z' },
    ]);
    const r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'd1', assignment_id: 'a1', item_id: 'lesson-copy', result: 'done', created_at: '2026-10-15T10:00:00Z' },
    ]);
    expect(r.assignments[0]).toMatchObject({ status: 'done', skipped_at: null });
  });

  it('keeps the events stored before the table was rebuilt (migration 0139)', async () => {
    const old = await createSqliteD1({ stopBefore: '0139_homework_skip_handwriting.sql' });
    old.raw.run("INSERT INTO assignment_events (id, assignment_id, student_id, item_id, result, created_at, received_at, note, undoes) VALUES ('u1', 'a1', 'student-1', 'n1', 'undo', '2026-10-01T10:00:00Z', '2026-10-01 10:00:05', NULL, 'e0')");
    applyMigrationsFrom(old, '0139_homework_skip_handwriting.sql');
    expect(old.rows('SELECT id, result, received_at, undoes FROM assignment_events')).toEqual([
      { id: 'u1', result: 'undo', received_at: '2026-10-01 10:00:05', undoes: 'e0' },
    ]);
    old.raw.run("INSERT INTO assignment_events (id, assignment_id, student_id, item_id, result, created_at) VALUES ('k', 'a1', 'student-1', 'n1', 'skip', '2026-10-01T10:01:00Z')");
  });
});

describe('Skip handwriting exercises — the account switch', () => {
  it('off by default, on and off again', async () => {
    const d = db as unknown as D1Database;
    expect(await getSkipHandwriting(d, STUDENT)).toBe(false);
    await setSkipHandwriting(d, STUDENT, true);
    expect(await getSkipHandwriting(d, STUDENT)).toBe(true);
    await setSkipHandwriting(d, STUDENT, false);
    expect(await getSkipHandwriting(d, STUDENT)).toBe(false);
  });
});
