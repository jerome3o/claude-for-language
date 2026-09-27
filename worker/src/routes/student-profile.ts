/**
 * The tutor's private profile of a student (shared/students/profile.ts).
 * TUTOR ONLY — the student of the relationship never reads it; mounted under
 * /api after the auth middleware.
 *
 *   GET /relationships/:relId/student-profile   → { profile | null }
 *   PUT /relationships/:relId/student-profile   { body, level?, handwriting?, words_per_lesson? } → { profile | null }
 *        (replaces the whole profile; an empty one is deleted → { profile: null }; 400 + problems when invalid)
 *
 * 404 when the relationship does not exist or is not active; 403 for anyone
 * but its tutor (the student included).
 */
import { Hono } from 'hono';
import type { Env, TutorRelationship } from '../types';
import { getMyRole, getOtherUserId } from '../services/relationships';
import { isStudentProfileEmpty, parseStudentProfileInput } from '@shared/students';
import * as q from '../db/student-profile-queries';

const studentProfile = new Hono<{ Bindings: Env }>();

type Guard = { ok: true; rel: TutorRelationship; studentId: string } | { ok: false; status: 403 | 404; error: string };

/** Only the tutor of an active relationship. */
export async function guardTutorOf(db: D1Database, relId: string, userId: string): Promise<Guard> {
  const rel = await db
    .prepare(`SELECT * FROM tutor_relationships WHERE id = ? AND status = 'active'`)
    .bind(relId)
    .first<TutorRelationship>();
  if (!rel) return { ok: false, status: 404, error: 'Relationship not found or not active' };
  const member = rel.requester_id === userId || rel.recipient_id === userId;
  if (!member || getMyRole(rel, userId) !== 'tutor') {
    return { ok: false, status: 403, error: 'Only the tutor of this student can see their profile' };
  }
  return { ok: true, rel, studentId: getOtherUserId(rel, userId) };
}

studentProfile.get('/relationships/:relId/student-profile', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const profile = await q.getStudentProfile(c.env.DB, g.rel.id, userId);
  return c.json({ profile: profile && !isStudentProfileEmpty(profile) ? profile : null });
});

studentProfile.put('/relationships/:relId/student-profile', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const raw = await c.req.json().catch(() => null);
  const { value, problems } = parseStudentProfileInput(raw);
  if (!value) return c.json({ error: problems[0] ?? 'Invalid profile', problems }, 400);
  if (isStudentProfileEmpty(value)) {
    await q.deleteStudentProfile(c.env.DB, g.rel.id, userId);
    return c.json({ profile: null });
  }
  const profile = await q.upsertStudentProfile(c.env.DB, { relationshipId: g.rel.id, tutorId: userId, studentId: g.studentId }, value);
  return c.json({ profile });
});

export default studentProfile;
