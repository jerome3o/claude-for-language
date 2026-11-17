/**
 * The grammar structures a learner has met in his mini lessons, cached per user (D1 `learner_structures`,
 * migration 0151; rules in shared/lesson/learnerStructures.ts; docs/STUDY_SESSION.md "Listen in context").
 *
 * Why a lazily rebuilt row: the list only changes when a lesson is done or edited, and the one reader (the
 * sentence generator, in a queue job) can afford one aggregate query. So every read first takes a cheap
 * fingerprint of his lessons — how many completions, the newest, the newest lesson edit — and rebuilds the
 * JSON only when that fingerprint changed. No cron, no hook in every lesson write path, never stale.
 */
import {
  learnerStructuresFromLessons,
  type LearnerStructure,
} from '../../../shared/lesson/learnerStructures';

/** Bump when the builder's rules change: every row rebuilds on its next read. */
export const LEARNER_STRUCTURES_VERSION = 1;

function chunks<T>(xs: T[], n = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** The fingerprint of his done lessons. */
export async function learnerStructuresStamp(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(c.completed_at) AS last, MAX(l.updated_at) AS edited
         FROM custom_lesson_completions c JOIN custom_lessons l ON l.id = c.lesson_id
        WHERE c.user_id = ? AND l.user_id = ?`,
    )
    .bind(userId, userId)
    .first<{ n: number; last: string | null; edited: string | null }>();
  return `v${LEARNER_STRUCTURES_VERSION}:${row?.n ?? 0}:${row?.last ?? ''}:${row?.edited ?? ''}`;
}

/** Build the list from his done lessons (no cache). */
export async function buildLearnerStructures(db: D1Database, userId: string): Promise<LearnerStructure[]> {
  const done = await db
    .prepare(
      `SELECT c.lesson_id, c.completed_at FROM custom_lesson_completions c
        WHERE c.user_id = ? ORDER BY c.completed_at ASC LIMIT 5000`,
    )
    .bind(userId)
    .all<{ lesson_id: string; completed_at: string }>();
  const completions = new Map<string, string[]>();
  for (const r of done.results ?? []) {
    if (!r.completed_at) continue;
    const list = completions.get(r.lesson_id) ?? [];
    list.push(r.completed_at);
    completions.set(r.lesson_id, list);
  }
  const lessons: Array<{ id: string; spec: string; completions: string[] }> = [];
  for (const part of chunks([...completions.keys()])) {
    const res = await db
      .prepare(`SELECT id, spec FROM custom_lessons WHERE user_id = ? AND id IN (${part.map(() => '?').join(',')})`)
      .bind(userId, ...part)
      .all<{ id: string; spec: string }>();
    for (const l of res.results ?? []) lessons.push({ id: l.id, spec: l.spec, completions: completions.get(l.id) ?? [] });
  }
  return learnerStructuresFromLessons(lessons);
}

/** The cached list, rebuilt when his lessons changed. Empty on any failure (never in the way of a sentence). */
export async function getLearnerStructures(db: D1Database, userId: string): Promise<LearnerStructure[]> {
  try {
    const stamp = await learnerStructuresStamp(db, userId);
    const cached = await db
      .prepare(`SELECT structures, stamp FROM learner_structures WHERE user_id = ?`)
      .bind(userId)
      .first<{ structures: string; stamp: string }>();
    if (cached && cached.stamp === stamp) {
      try {
        const list = JSON.parse(cached.structures);
        if (Array.isArray(list)) return list as LearnerStructure[];
      } catch {
        /* rebuilt below */
      }
    }
    const list = await buildLearnerStructures(db, userId);
    await db
      .prepare(
        `INSERT INTO learner_structures (user_id, structures, stamp, built_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET structures = excluded.structures, stamp = excluded.stamp, built_at = excluded.built_at`,
      )
      .bind(userId, JSON.stringify(list), stamp, new Date().toISOString())
      .run();
    return list;
  } catch (err) {
    console.error('[learner-structures] failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
