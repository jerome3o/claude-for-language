/**
 * Group classes (EXPERIMENTAL): groups are built only from the tutor's ACTIVE
 * students, membership is re-checked through the relationship, one live class
 * per group, and only members / the tutor may see a session.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { GroupError, createGroup, listCandidateStudents, listGroups, markSessionEnded, requireSessionAccess, startSession, updateGroup } from '../group-classes';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

const T = 'tutor-1';

function seed(db: SqliteD1) {
  for (const [id, name] of [[T, '王老师'], ['s1', 'Anna'], ['s2', 'Ben'], ['s3', 'Chen'], ['other-tutor', 'X'], ['s4', 'Dee']]) {
    exec(db, 'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', id, `${id}@test.e2e`, name, 'student');
  }
  // The tutor asked (requester_role tutor) / the student asked (requester_role student): both are her students.
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r1', ?, 's1', 'tutor', 'active')", T);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r2', 's2', ?, 'student', 'active')", T);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r3', ?, 's3', 'tutor', 'active')", T);
  // Pending, and someone else's student.
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r4', ?, 's4', 'tutor', 'pending')", T);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r5', 'other-tutor', 's4', 'tutor', 'active')");
}

describe('group classes service', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('offers only her active students', async () => {
    expect((await listCandidateStudents(db, T)).map((s) => s.user_id)).toEqual(['s1', 's2', 's3']);
  });

  it('creates a group of active students and refuses anyone else', async () => {
    await expect(createGroup(db, T, { name: 'Tue', student_ids: ['s1', 's4'] })).rejects.toBeInstanceOf(GroupError);
    await expect(createGroup(db, T, { name: '', student_ids: ['s1', 's2'] })).rejects.toThrow(/name/);
    await expect(createGroup(db, T, { name: 'Tue', student_ids: ['s1'] })).rejects.toThrow(/at least 2/);
    const g = await createGroup(db, T, { name: ' Tuesday  HSK 3 ', student_ids: ['s1', 's2'] });
    expect(g).toMatchObject({ name: 'Tuesday HSK 3', tutor_name: '王老师', live_session: null });
    expect(g.members.map((m) => [m.user_id, m.relationship_id])).toEqual([['s1', 'r1'], ['s2', 'r2']]);
    const updated = await updateGroup(db, g.id, T, { student_ids: ['s1', 's2', 's3'] });
    expect(updated.members).toHaveLength(3);
    await expect(updateGroup(db, g.id, 's1', { name: 'mine' })).rejects.toThrow(/not found/);
  });

  it('one live class per group; members and the tutor may open it, nobody else; an ended relationship drops the member', async () => {
    const g = await createGroup(db, T, { name: 'Tue', student_ids: ['s1', 's2'] });
    await expect(startSession(db, g.id, 's1')).rejects.toThrow(/not found/);
    const first = await startSession(db, g.id, T, 1000);
    const again = await startSession(db, g.id, T, 2000);
    expect(again).toMatchObject({ reused: true, session: { id: first.session.id } });
    expect((await requireSessionAccess(db, first.session.id, T)).role).toBe('tutor');
    expect((await requireSessionAccess(db, first.session.id, 's2')).role).toBe('student');
    await expect(requireSessionAccess(db, first.session.id, 's3')).rejects.toThrow(/not found/);
    const mine = await listGroups(db, 's1');
    expect(mine.member_of.map((x) => x.live_session?.id)).toEqual([first.session.id]);
    exec(db, "UPDATE tutor_relationships SET status = 'removed' WHERE id = 'r1'");
    await expect(requireSessionAccess(db, first.session.id, 's1')).rejects.toThrow(/not found/);
    expect((await listGroups(db, 's1')).member_of).toEqual([]);
    await markSessionEnded(db, first.session.id, 5000, 3);
    expect((await startSession(db, g.id, T, 6000)).reused).toBe(false);
  });
});
