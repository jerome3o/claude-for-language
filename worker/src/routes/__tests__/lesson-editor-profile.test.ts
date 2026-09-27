/**
 * The lesson co-editor reads the tutor's private student profile when a tutor
 * edits a lesson they assigned to that student — and only then (the student
 * editing their own copy never gets it). Real SQLite; the Claude call mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const propose = vi.fn();
vi.mock('../../services/lesson-editor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  proposeLessonRevision: (...args: unknown[]) => propose(...args),
}));

import type { Env } from '../../types';
import lessonEditor from '../lesson-editor';
import { buildLessonCoEditMessage } from '../../services/lesson-editor';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { upsertStudentProfile } from '../../db/student-profile-queries';

const TUTOR = 'tutor-mh';
const STUDENT = 'student-j';
const HEADING = "Tutor's profile of this student";
const spec = { title: '把 sentences', sections: [{ exercises: [{ type: 'translate', english: 'Close the door', reference_hanzi: '把门关上' }] }] };

let db: SqliteD1;

function app(userId: string) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  a.route('/api', lessonEditor);
  const env = { DB: db, ANTHROPIC_API_KEY: 'k' } as unknown as Env;
  return (path: string, init?: RequestInit) => a.request(path, init, env);
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  propose.mockReset();
  propose.mockResolvedValue({ text: 'Done.', proposal: null });
  db = await createSqliteD1();
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?)', [TUTOR, 'mh@example.com', 'Minghui', STUDENT, 'j@example.com', 'Jerome']);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", [STUDENT, TUTOR]);
  db.raw.run(
    "INSERT INTO custom_lessons (id, user_id, title, spec, assigned_by, assigned_relationship_id) VALUES ('lesson-copy', ?, '把 sentences', ?, ?, 'rel-1')",
    [STUDENT, JSON.stringify(spec), TUTOR]
  );
  await upsertStudentProfile(db, { relationshipId: 'rel-1', tutorId: TUTOR, studentId: STUDENT }, {
    body: 'Adult beginner, no handwriting. Loves football.',
    level: 'beginner',
    handwriting: false,
    words_per_lesson: 12,
  });
});

describe('lesson co-editor × student profile', () => {
  it('the tutor editing a lesson they assigned: the profile goes into the prompt', async () => {
    const res = await app(TUTOR)('/api/editor-chat/lesson/lesson-copy/messages', post({ message: 'make it easier', current_spec: spec }));
    expect(res.status).toBe(200);
    const input = propose.mock.calls[0][1] as { studentProfile?: string };
    expect(input.studentProfile).toContain(HEADING);
    expect(input.studentProfile).toContain('about Jerome');
    expect(input.studentProfile).toContain('Loves football');
    expect(buildLessonCoEditMessage({ ...input, spec, authorChanges: [], message: 'make it easier' } as never)).toContain('Loves football');
  });

  it('the student editing their own copy: no profile', async () => {
    const res = await app(STUDENT)('/api/editor-chat/lesson/lesson-copy/messages', post({ message: 'make it easier', current_spec: spec }));
    expect(res.status).toBe(200);
    const input = propose.mock.calls[0][1] as { studentProfile?: string };
    expect(input.studentProfile ?? '').toBe('');
    // Nothing the student's side of the chat stored mentions it either.
    expect(JSON.stringify(db.rows('SELECT content FROM editor_chat_messages'))).not.toContain('football');
  });

  it('no profile written: nothing added', async () => {
    db.raw.run('DELETE FROM student_profiles');
    await app(TUTOR)('/api/editor-chat/lesson/lesson-copy/messages', post({ message: 'x', current_spec: spec }));
    expect((propose.mock.calls[0][1] as { studentProfile?: string }).studentProfile).toBe('');
  });
});

describe('buildLessonCoEditMessage', () => {
  it('puts the profile first when given, and nothing when not', () => {
    const withProfile = buildLessonCoEditMessage({ spec: spec as never, authorChanges: [], message: 'hi', studentProfile: `# ${HEADING}\nLikes cats` });
    expect(withProfile.indexOf('Likes cats')).toBeLessThan(withProfile.indexOf('<current_lesson_spec>'));
    const without = buildLessonCoEditMessage({ spec: spec as never, authorChanges: ['Renamed'], message: 'hi' });
    expect(without.startsWith('<current_lesson_spec>')).toBe(true);
    expect(without).not.toContain(HEADING);
    expect(without).toContain('- Renamed');
  });
});
