/**
 * prepared_activities / prepared_activity_jobs (migration 0123): the rows and
 * their shapes. See ./run.ts for the job and shared/call-activities/prepared.ts
 * for the rules.
 */

import { validateActivitySpec } from '@shared/call-activities';
import type { ActivitySpec, PrepareJob, PrepareJobStatus, PreparedActivity, PreparedStatus, PrepareTrigger } from '@shared/call-activities';

interface ActivityRow {
  id: string;
  relationship_id: string;
  job_id: string;
  source_lesson_id: string | null;
  source_label: string | null;
  why: string;
  spec_json: string;
  status: string;
  position: number;
  created_at: string;
  used_at: string | null;
  used_in_call_id: string | null;
}

export interface JobRow {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  idem_key: string;
  trigger: string;
  source_lesson_id: string | null;
  count: number;
  status: string;
  error: string | null;
  created_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** "2026-10-03 12:00:00" — D1's datetime('now') shape, so string order = time order. */
export const sqlNow = (ms = Date.now()) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function toActivity(r: ActivityRow): PreparedActivity | null {
  try {
    const spec = JSON.parse(r.spec_json) as ActivitySpec;
    return {
      id: r.id,
      relationship_id: r.relationship_id,
      job_id: r.job_id,
      spec,
      why: r.why,
      status: r.status as PreparedStatus,
      source_lesson_id: r.source_lesson_id,
      source_label: r.source_label,
      position: r.position,
      created_at: r.created_at,
      used_at: r.used_at,
      used_in_call_id: r.used_in_call_id,
    };
  } catch {
    return null;
  }
}

export function toJob(r: JobRow): PrepareJob {
  return {
    id: r.id,
    relationship_id: r.relationship_id,
    trigger: r.trigger as PrepareTrigger,
    status: r.status as PrepareJobStatus,
    source_lesson_id: r.source_lesson_id,
    created_count: r.created_count,
    error: r.error,
    cost_usd: r.cost_usd,
    created_at: r.created_at,
    finished_at: r.finished_at,
  };
}

const ACTIVITY_COLS = 'id, relationship_id, job_id, source_lesson_id, source_label, why, spec_json, status, position, created_at, used_at, used_in_call_id';

/** Ready + used ones (dismissed left out), newest first; the apps order them with `orderPrepared`. */
export async function listPrepared(db: D1Database, relationshipId: string, limit = 40): Promise<PreparedActivity[]> {
  const rows = await db
    .prepare(`SELECT ${ACTIVITY_COLS} FROM prepared_activities WHERE relationship_id = ? AND status IN ('ready', 'used') ORDER BY created_at DESC, position LIMIT ?`)
    .bind(relationshipId, limit)
    .all<ActivityRow>();
  return (rows.results ?? []).map(toActivity).filter((a): a is PreparedActivity => a !== null);
}

export async function getPrepared(db: D1Database, id: string): Promise<(PreparedActivity & { tutor_id: string }) | null> {
  const r = await db.prepare(`SELECT ${ACTIVITY_COLS}, tutor_id FROM prepared_activities WHERE id = ?`).bind(id).first<ActivityRow & { tutor_id: string }>();
  if (!r) return null;
  const a = toActivity(r);
  return a ? { ...a, tutor_id: r.tutor_id } : null;
}

export async function setPreparedStatus(db: D1Database, id: string, status: 'ready' | 'dismissed'): Promise<void> {
  await db.prepare(`UPDATE prepared_activities SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
}

/**
 * The call room starts one: the spec (when it belongs to this relationship and
 * wasn't dismissed) and it is marked used in this call. The spec's id becomes
 * the `prepared:<id>` it was started with, so the lesson's results say so.
 */
export async function takePreparedForCall(db: D1Database, rowId: string, relationshipId: string, callId: string, activityId: string): Promise<ActivitySpec | null> {
  const r = await db
    .prepare(`SELECT ${ACTIVITY_COLS} FROM prepared_activities WHERE id = ? AND relationship_id = ? AND status <> 'dismissed'`)
    .bind(rowId, relationshipId)
    .first<ActivityRow>();
  const a = r ? toActivity(r) : null;
  // A row the engine can't play (shouldn't happen — checked when written) is never started.
  if (!a || validateActivitySpec(a.spec).length > 0) return null;
  await db
    .prepare(`UPDATE prepared_activities SET status = 'used', used_at = COALESCE(used_at, ?), used_in_call_id = COALESCE(used_in_call_id, ?), updated_at = datetime('now') WHERE id = ?`)
    .bind(sqlNow(), callId, rowId)
    .run();
  return { ...a.spec, id: activityId };
}

export async function latestJob(db: D1Database, relationshipId: string): Promise<JobRow | null> {
  return db.prepare(`SELECT * FROM prepared_activity_jobs WHERE relationship_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(relationshipId).first<JobRow>();
}

export async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare(`SELECT * FROM prepared_activity_jobs WHERE id = ?`).bind(id).first<JobRow>();
}

/** Insert unless the idem_key exists; returns the job either way and whether it is new. */
export async function insertJob(
  db: D1Database,
  j: { id: string; relationshipId: string; tutorId: string; studentId: string; idemKey: string; trigger: PrepareTrigger; sourceLessonId: string | null; count: number },
): Promise<{ job: JobRow; created: boolean }> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO prepared_activity_jobs (id, relationship_id, tutor_id, student_id, idem_key, trigger, source_lesson_id, count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .bind(j.id, j.relationshipId, j.tutorId, j.studentId, j.idemKey, j.trigger, j.sourceLessonId, j.count, sqlNow())
    .run();
  const created = (res.meta?.changes ?? 0) > 0;
  const job = await db.prepare(`SELECT * FROM prepared_activity_jobs WHERE idem_key = ?`).bind(j.idemKey).first<JobRow>();
  return { job: job!, created };
}

export async function patchJob(db: D1Database, id: string, p: Partial<Pick<JobRow, 'status' | 'error' | 'created_count' | 'input_tokens' | 'output_tokens' | 'cost_usd' | 'started_at' | 'finished_at'>>): Promise<void> {
  const keys = Object.keys(p) as (keyof typeof p)[];
  if (keys.length === 0) return;
  await db
    .prepare(`UPDATE prepared_activity_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => p[k] ?? null), id)
    .run();
}

/** Store a job's activities (idempotent: ids are `<job>-<n>`). */
export async function insertActivities(
  db: D1Database,
  job: JobRow,
  sourceLabel: string | null,
  list: { spec: ActivitySpec; why: string }[],
  createdAt = sqlNow(),
): Promise<string[]> {
  const ids: string[] = [];
  const stmts = list.map((a, i) => {
    const id = `${job.id}-${i + 1}`;
    ids.push(id);
    return db
      .prepare(
        `INSERT OR IGNORE INTO prepared_activities (id, relationship_id, tutor_id, student_id, job_id, source_lesson_id, source_label, kind, title, why, spec_json, status, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
      )
      .bind(id, job.relationship_id, job.tutor_id, job.student_id, job.id, job.source_lesson_id, sourceLabel, a.spec.kind, a.spec.title, a.why, JSON.stringify(a.spec), i, createdAt, createdAt);
  });
  if (stmts.length) await db.batch(stmts);
  return ids;
}

/**
 * Keep the ready list short: a newer lesson's run replaces the still-ready ones
 * made from the SAME lesson (the report was rewritten after another call joined
 * it), and only the newest `keep` ready ones stay; the rest are dismissed.
 */
export async function tidyReady(db: D1Database, job: JobRow, keep = 15): Promise<void> {
  if (job.trigger === 'lesson' && job.source_lesson_id) {
    await db
      .prepare(`UPDATE prepared_activities SET status = 'dismissed', updated_at = datetime('now') WHERE relationship_id = ? AND source_lesson_id = ? AND status = 'ready' AND job_id <> ?`)
      .bind(job.relationship_id, job.source_lesson_id, job.id)
      .run();
  }
  await db
    .prepare(
      `UPDATE prepared_activities SET status = 'dismissed', updated_at = datetime('now')
        WHERE relationship_id = ?1 AND status = 'ready' AND id NOT IN (
          SELECT id FROM prepared_activities WHERE relationship_id = ?1 AND status = 'ready' ORDER BY created_at DESC, position LIMIT ?2)`,
    )
    .bind(job.relationship_id, keep)
    .run();
}
