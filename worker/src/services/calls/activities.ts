/**
 * In-call activities' results (shared/call-activities): the CallRoom upserts one
 * row per session in `call_activities` (migration 0094); the review page and the
 * homework agent read them per lesson.
 */

import { activitySummary, type ActivitySession, type ActivitySummary } from '@shared/call-activities';

export interface CallActivityResult {
  id: string;
  call_id: string;
  activity_id: string;
  kind: string;
  title: string;
  started_by: string | null;
  started_at: number;
  updated_at: number;
  summary: ActivitySummary;
}

/** Keep (or update) a session's summary. Nothing is written for a session nobody played yet. */
export async function saveActivityResult(
  db: D1Database,
  session: ActivitySession,
  where: { callId: string; lessonId: string | null; relationshipId: string | null; startedBy: string | null },
): Promise<boolean> {
  const summary = activitySummary(session);
  if (summary.played === 0 && !summary.finished) return false;
  await db
    .prepare(
      `INSERT INTO call_activities (id, call_id, lesson_id, relationship_id, activity_id, kind, title, started_by, started_at, updated_at, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, summary_json = excluded.summary_json`,
    )
    .bind(session.session_id, where.callId, where.lessonId, where.relationshipId, session.spec.id, session.spec.kind, session.spec.title, where.startedBy, session.started_at, session.updated_at, JSON.stringify(summary))
    .run();
  return true;
}

/** Every activity played in these calls, oldest first. */
export async function listCallActivities(db: D1Database, callIds: string[]): Promise<CallActivityResult[]> {
  if (callIds.length === 0) return [];
  const marks = callIds.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT id, call_id, activity_id, kind, title, started_by, started_at, updated_at, summary_json FROM call_activities WHERE call_id IN (${marks}) ORDER BY started_at`)
    .bind(...callIds)
    .all<Omit<CallActivityResult, 'summary'> & { summary_json: string }>();
  const out: CallActivityResult[] = [];
  for (const { summary_json, ...r } of rows.results ?? []) {
    try {
      out.push({ ...r, summary: JSON.parse(summary_json) as ActivitySummary });
    } catch {
      /* a broken row is skipped */
    }
  }
  return out;
}

/** The tutor of a relationship (null for a solo call / unknown). */
export async function relationshipTutor(db: D1Database, relationshipId: string | null): Promise<string | null> {
  if (!relationshipId) return null;
  const rel = await db
    .prepare('SELECT requester_id, recipient_id, requester_role FROM tutor_relationships WHERE id = ?')
    .bind(relationshipId)
    .first<{ requester_id: string; recipient_id: string; requester_role: string }>();
  if (!rel) return null;
  return rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
}

/** The activities as text for the homework agent's notes ("IN-CALL ACTIVITIES"). */
export function activitiesNotes(results: Pick<CallActivityResult, 'summary'>[], max = 6000): string {
  const parts: string[] = [];
  for (const { summary: s } of results) {
    const score = s.scored > 0 ? ` — ${s.correct}/${s.scored} right` : '';
    parts.push(`"${s.title}" (${s.kind}; ${s.played} of ${s.total_rounds} rounds played${score}${s.finished ? '' : ', not finished'})`);
    parts.push(`Roles: ${s.roles.join('; ')}`);
    for (const l of s.lines) parts.push(`- ${l}`);
  }
  const text = parts.join('\n');
  return text.length > max ? `${text.slice(0, max)}\n[… cut for length …]` : text;
}
