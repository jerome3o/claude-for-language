/**
 * Undo in the homework pass (docs/HOMEWORK.md §3b) against real SQLite with every migration:
 * an `undo` event (migration 0126) takes an answer back — done_count / status / completed_at
 * are recomputed with the shared `passProgress`, so the tutor's view follows; the undo may
 * arrive before the answer it takes back (offline, two devices), and is idempotent by id.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrationsFrom, createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { recordEvents } from '../homework';
import { listEvents } from '../../db/homework-queries';

let db: SqliteD1;
const STUDENT = 'student-1';

function addAssignment(id: string, items: string[], studentId = STUDENT) {
  db.raw.run(
    `INSERT INTO assignments (id, relationship_id, tutor_id, student_id, batch_id, kind, target_id, source_id, title, mode, due_date, item_ids, item_count, done_count, part_index, part_count, status, created_at)
     VALUES (?, 'rel', 'tutor-1', ?, 'b', 'deck', 'deck-copy', 'src', '餐厅', 'one_off', '2026-10-16', ?, ?, 0, 0, 1, 'active', '2026-10-13T09:00:00Z')`,
    [id, studentId, JSON.stringify(items), items.length],
  );
}

function row(id: string) {
  return db.raw.exec(`SELECT done_count, status, completed_at FROM assignments WHERE id = '${id}'`)[0].values[0];
}

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('student-1', 's@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('tutor-1', 't@x.test', 'Minghui', 'tutor')");
  addAssignment('a1', ['n1', 'n2']);
});

describe('undo in the pass', () => {
  it('taking back the last Got it reopens a finished pass, for the tutor too', async () => {
    let r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'e1', assignment_id: 'a1', item_id: 'n1', result: 'right', created_at: '2026-10-13T10:00:00Z' },
      { id: 'e2', assignment_id: 'a1', item_id: 'n2', result: 'right', created_at: '2026-10-13T10:01:00Z' },
    ]);
    expect(r.assignments[0]).toMatchObject({ done_count: 2, status: 'done', completed_at: '2026-10-13T10:01:00.000Z' });

    r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'u1', assignment_id: 'a1', item_id: 'n2', result: 'undo', undoes: 'e2', created_at: '2026-10-13T10:02:00Z' },
    ]);
    expect(r.accepted).toBe(1);
    expect(r.assignments[0]).toMatchObject({ done_count: 1, status: 'active', completed_at: null });
    expect(row('a1')).toEqual([1, 'active', null]);

    // The events travel back to the devices with the id they undo.
    const events = await listEvents(db as unknown as D1Database, ['a1']);
    expect(events.find((e) => e.id === 'u1')).toMatchObject({ result: 'undo', undoes: 'e2' });

    // Uploading the same undo again changes nothing.
    r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'u1', assignment_id: 'a1', item_id: 'n2', result: 'undo', undoes: 'e2', created_at: '2026-10-13T10:02:00Z' },
    ]);
    expect(r.accepted).toBe(0);
    expect(r.assignments[0]).toMatchObject({ done_count: 1, status: 'active' });
  });

  it('an undo that arrives before its answer still takes it back', async () => {
    await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'u1', assignment_id: 'a1', item_id: 'n1', result: 'undo', undoes: 'e1', created_at: '2026-10-13T10:02:00Z' },
    ]);
    const r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'e1', assignment_id: 'a1', item_id: 'n1', result: 'right', created_at: '2026-10-13T10:00:00Z' },
    ]);
    expect(r.assignments[0]).toMatchObject({ done_count: 0, status: 'active' });
  });

  it('an undo without the id it takes back is dropped', async () => {
    const r = await recordEvents(db as unknown as D1Database, STUDENT, [
      { id: 'e1', assignment_id: 'a1', item_id: 'n1', result: 'right', created_at: '2026-10-13T10:00:00Z' },
      { id: 'u1', assignment_id: 'a1', item_id: 'n1', result: 'undo', created_at: '2026-10-13T10:02:00Z' },
    ]);
    expect(r.accepted).toBe(1);
    expect(r.assignments[0]).toMatchObject({ done_count: 1 });
  });

  it('keeps the events stored before the table was rebuilt (migration 0126)', async () => {
    const old = await createSqliteD1({ stopBefore: '0126_homework_undo.sql' });
    old.raw.run(
      "INSERT INTO assignment_events (id, assignment_id, student_id, item_id, result, created_at, received_at, note) VALUES ('e1', 'a1', 'student-1', 'n1', 'done', '2026-10-01T10:00:00Z', '2026-10-01 10:00:05', 'Watched it twice')",
    );
    applyMigrationsFrom(old, '0126_homework_undo.sql');
    expect(old.rows('SELECT id, result, received_at, note, undoes FROM assignment_events')).toEqual([
      { id: 'e1', result: 'done', received_at: '2026-10-01 10:00:05', note: 'Watched it twice', undoes: null },
    ]);
    old.raw.run("INSERT INTO assignment_events (id, assignment_id, student_id, item_id, result, created_at, undoes) VALUES ('u1', 'a1', 'student-1', 'n1', 'undo', '2026-10-01T10:01:00Z', 'e1')");
    expect(() => old.raw.run("INSERT INTO assignment_events (id, assignment_id, student_id, item_id, result, created_at) VALUES ('x', 'a1', 'student-1', 'n1', 'maybe', '2026-10-01T10:01:00Z')")).toThrow();
  });
});
