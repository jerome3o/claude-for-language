/**
 * The tutor's private student profile: only the tutor of the relationship can
 * read or write it — the student gets 403, another tutor 403, a missing or
 * inactive relationship 404. Real SQLite with every migration applied.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../types';
import studentProfile from '../student-profile';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { hasStudentProfile, getStudentProfile } from '../../db/student-profile-queries';

const TUTOR = 'tutor-mh';
const STUDENT = 'student-j';
const OTHER_TUTOR = 'tutor-other';

let db: SqliteD1;

function exec(sql: string, ...params: Array<string | number | null>) {
  db.raw.run(sql, params);
}

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', studentProfile);
  const env = { DB: db } as unknown as Env;
  return (path: string, init?: RequestInit) => a.request(path, init, env);
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  db = await createSqliteD1();
  for (const [id, email] of [[TUTOR, 'mh@example.com'], [STUDENT, 'j@example.com'], [OTHER_TUTOR, 'o@example.com']]) {
    exec('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, email, id);
  }
  // The student asked the tutor (requester = student): roles resolve from either side.
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  // Another tutor with their own relationship to the same student.
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', ?, ?, 'tutor', 'active')", OTHER_TUTOR, STUDENT);
  exec("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-old', ?, ?, 'tutor', 'removed')", TUTOR, STUDENT);
});

describe('student profile routes', () => {
  it('the tutor writes, reads and clears it', async () => {
    const tutor = app(TUTOR);
    expect(await (await tutor('/api/relationships/rel-1/student-profile')).json()).toEqual({ profile: null });

    const res = await tutor('/api/relationships/rel-1/student-profile', put({ body: 'Adult beginner.\r\nNo handwriting.', level: 'beginner', handwriting: false, words_per_lesson: 15 }));
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { profile: Record<string, unknown> };
    expect(saved.profile).toMatchObject({ relationship_id: 'rel-1', body: 'Adult beginner.\nNo handwriting.', level: 'beginner', handwriting: false, words_per_lesson: 15 });

    const got = (await (await tutor('/api/relationships/rel-1/student-profile')).json()) as { profile: Record<string, unknown> };
    expect(got.profile).toMatchObject({ body: 'Adult beginner.\nNo handwriting.', level: 'beginner', handwriting: false, words_per_lesson: 15 });
    expect(typeof got.profile.updated_at).toBe('string');
    expect(db.rows('SELECT tutor_id, student_id FROM student_profiles')).toEqual([{ tutor_id: TUTOR, student_id: STUDENT }]);
    expect(await hasStudentProfile(db, 'rel-1', TUTOR)).toBe(true);

    // A second PUT replaces the whole profile.
    await tutor('/api/relationships/rel-1/student-profile', put({ body: 'Now writes characters.', handwriting: true }));
    expect(await getStudentProfile(db, 'rel-1', TUTOR)).toMatchObject({ body: 'Now writes characters.', level: null, handwriting: true, words_per_lesson: null });

    // Empty = deleted.
    const cleared = await tutor('/api/relationships/rel-1/student-profile', put({ body: '   ' }));
    expect(await cleared.json()).toEqual({ profile: null });
    expect(db.rows('SELECT COUNT(*) AS n FROM student_profiles')[0]).toEqual({ n: 0 });
    expect(await hasStudentProfile(db, 'rel-1', TUTOR)).toBe(false);
  });

  it('the student can neither read nor write it', async () => {
    await app(TUTOR)('/api/relationships/rel-1/student-profile', put({ body: 'Private note about J' }));
    const student = app(STUDENT);
    const read = await student('/api/relationships/rel-1/student-profile');
    expect(read.status).toBe(403);
    expect(JSON.stringify(await read.json())).not.toContain('Private note');
    expect((await student('/api/relationships/rel-1/student-profile', put({ body: 'overwrite' }))).status).toBe(403);
    // And the student-side lookup (their id as "tutor") finds nothing.
    expect(await getStudentProfile(db, 'rel-1', STUDENT)).toBeNull();
    expect(await getStudentProfile(db, 'rel-1', TUTOR)).toMatchObject({ body: 'Private note about J' });
  });

  it('another tutor gets 403, even the student\'s other tutor', async () => {
    await app(TUTOR)('/api/relationships/rel-1/student-profile', put({ body: 'Private note about J' }));
    const other = app(OTHER_TUTOR);
    const read = await other('/api/relationships/rel-1/student-profile');
    expect(read.status).toBe(403);
    expect(JSON.stringify(await read.json())).not.toContain('Private note');
    expect((await other('/api/relationships/rel-1/student-profile', put({ body: 'x' }))).status).toBe(403);
    // Their own relationship with the student has no profile — nothing leaks across.
    expect(await (await other('/api/relationships/rel-2/student-profile')).json()).toEqual({ profile: null });
  });

  it('404 for a missing or inactive relationship', async () => {
    expect((await app(TUTOR)('/api/relationships/nope/student-profile')).status).toBe(404);
    expect((await app(TUTOR)('/api/relationships/rel-old/student-profile', put({ body: 'x' }))).status).toBe(404);
  });

  it('400 with the problems for an invalid profile', async () => {
    const res = await app(TUTOR)('/api/relationships/rel-1/student-profile', put({ body: 'x'.repeat(8001), level: 'expert' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { problems: string[] };
    expect(body.problems).toHaveLength(2);
    expect(db.rows('SELECT COUNT(*) AS n FROM student_profiles')[0]).toEqual({ n: 0 });
  });
});
