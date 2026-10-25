/**
 * Mini lessons revise until right first time (shared/study/lessonRevision.ts) — the server side:
 * each completion's OUTCOME (custom_lesson_completions.outcome, migration 0133) and the revision
 * state the tutor's views show ("Revision 2 due 29 Oct · 3 to get right" / Completed).
 *
 * Outcomes come from the device with the completion; one that didn't (an older app) is derived
 * from the run's attempt (custom_lesson_attempts, same id) — on upload, and lazily for older rows
 * (`backfillCompletionOutcomes`, before the lesson list is read). A completion with no attempt
 * (Sep 2026) keeps NULL: its rating decides (Again / Hard → a whole-lesson revision, else done).
 */
import {
  computeLessonLearnState,
  outcomeWithout,
  parseRunOutcome,
  runOutcome,
  type LessonLearnState,
  type LessonRunOutcome,
  type LessonRunRecord,
  type LessonMarkRecord,
} from '@shared/study/lessonRevision';
import { lessonSteps } from '@shared/study/lessonRun';
import { revisionProgressLabel, type LessonRevisionSummary } from '@shared/homework/library';
import { handwritingKeys, type CustomLessonSpec } from '@shared/lesson';

/** The outcome to store for an uploaded completion: the device's, else derived from its attempt. */
export function outcomeForUpload(sent: unknown, attempt: { exercises: unknown[] } | null): LessonRunOutcome | null {
  return parseRunOutcome(sent) ?? (attempt ? runOutcome(attempt as Parameters<typeof runOutcome>[0]) : null);
}

/** Write the outcome on a completion that has none yet (idempotent). */
export async function setCompletionOutcome(db: D1Database, userId: string, completionId: string, outcome: LessonRunOutcome): Promise<void> {
  await db
    .prepare('UPDATE custom_lesson_completions SET outcome = ? WHERE id = ? AND user_id = ? AND outcome IS NULL')
    .bind(JSON.stringify(outcome), completionId, userId)
    .run();
}

/**
 * Older completions with an attempt but no outcome: derive and store it (a few hundred at a
 * time). Cheap once done — the query only finds rows still missing one.
 */
export async function backfillCompletionOutcomes(db: D1Database, userId: string, limit = 200): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT c.id, a.data FROM custom_lesson_completions c
       JOIN custom_lesson_attempts a ON a.id = c.id
       WHERE c.user_id = ? AND c.outcome IS NULL LIMIT ?`
    )
    .bind(userId, limit)
    .all<{ id: string; data: string }>();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows.results ?? []) {
    let data: unknown = null;
    try { data = JSON.parse(r.data); } catch { /* unreadable: leave it */ }
    const outcome = data && typeof data === 'object' ? runOutcome(data as Parameters<typeof runOutcome>[0]) : null;
    if (!outcome) continue;
    stmts.push(db.prepare('UPDATE custom_lesson_completions SET outcome = ? WHERE id = ? AND outcome IS NULL').bind(JSON.stringify(outcome), r.id));
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

/** The student's calendar day of a moment, in their time zone (UTC when unknown). */
export function dayIn(ms: number, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export interface LessonRevisionInfo extends LessonRevisionSummary {
  /** For older apps: when it comes back (ISO) — the revision's due time. */
  next_revisit_at: string | null;
  /** For older apps: "done for good" = done forever. */
  retired: boolean;
  /** "Revision 2 due 29 Oct · 3 to get right" / "all right first time" / null before the first run. */
  revision_label: string | null;
}

/** A lesson's state from its completions (+ the old Done for good marks). */
export function learnStateOf(
  completions: Array<{ id: string; completed_at: string; rating: number | null; outcome: string | null }>,
  marks: LessonMarkRecord[] = [],
  /** Exercise keys that no longer count (handwriting, with the student's "Skip handwriting exercises" on). */
  ignore: readonly string[] = [],
): LessonLearnState {
  const runs: LessonRunRecord[] = completions.map(c => ({ id: c.id, at: c.completed_at, rating: c.rating, outcome: parseRunOutcome(c.outcome) }));
  return computeLessonLearnState(runs, marks, ignore);
}

/**
 * The revision state of some of a student's lessons, as their tutor sees it. `today` = the
 * student's calendar day (for "due today").
 */
export async function lessonRevisionSummaries(db: D1Database, studentId: string, lessonIds: string[], nowMs = Date.now()): Promise<Map<string, LessonRevisionInfo>> {
  const out = new Map<string, LessonRevisionInfo>();
  const ids = [...new Set(lessonIds)];
  if (ids.length === 0) return out;
  await backfillCompletionOutcomes(db, studentId).catch(() => 0);
  const user = await db.prepare('SELECT time_zone, skip_handwriting FROM users WHERE id = ?').bind(studentId)
    .first<{ time_zone: string | null; skip_handwriting: number | null }>().catch(() => null);
  const tz = user?.time_zone ?? null;
  // "Skip handwriting exercises" (shared/lesson/handwriting.ts): earlier handwriting misses stop counting.
  const skipHandwriting = Number(user?.skip_handwriting) === 1;
  const today = dayIn(nowMs, tz);
  const completions = new Map<string, Array<{ id: string; completed_at: string; rating: number | null; outcome: string | null; correct: number; total: number }>>();
  const specs = new Map<string, string>();
  const marks = new Map<string, LessonMarkRecord[]>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const q = chunk.map(() => '?').join(',');
    const [c, l, m] = await Promise.all([
      db.prepare(`SELECT id, lesson_id, completed_at, rating, outcome, correct, total FROM custom_lesson_completions WHERE lesson_id IN (${q})`)
        .bind(...chunk).all<{ id: string; lesson_id: string; completed_at: string; rating: number | null; outcome: string | null; correct: number; total: number }>(),
      db.prepare(`SELECT id, spec FROM custom_lessons WHERE id IN (${q})`).bind(...chunk).all<{ id: string; spec: string }>(),
      db.prepare(`SELECT id, item_id, action, created_at FROM revisit_events WHERE user_id = ? AND item_kind = 'lesson' AND item_id IN (${q})`)
        .bind(studentId, ...chunk).all<{ id: string; item_id: string; action: 'retire' | 'restore'; created_at: string }>()
        .catch(() => ({ results: [] as Array<{ id: string; item_id: string; action: 'retire' | 'restore'; created_at: string }> })),
    ]);
    for (const r of c.results ?? []) {
      const list = completions.get(r.lesson_id) ?? [];
      list.push(r);
      completions.set(r.lesson_id, list);
    }
    for (const r of l.results ?? []) specs.set(r.id, r.spec);
    for (const r of m.results ?? []) {
      const list = marks.get(r.item_id) ?? [];
      list.push({ id: r.id, at: r.created_at, action: r.action });
      marks.set(r.item_id, list);
    }
  }
  for (const id of ids) {
    const runs = completions.get(id) ?? [];
    let spec: CustomLessonSpec | null = null;
    try {
      spec = JSON.parse(specs.get(id) ?? '{"sections":[]}') as CustomLessonSpec;
    } catch { /* unreadable spec */ }
    const ignore = skipHandwriting && spec ? handwritingKeys(spec) : [];
    const state = learnStateOf(runs, marks.get(id) ?? [], ignore);
    let scored = 0;
    try {
      if (spec) scored = lessonSteps(spec, null, { skipHandwriting }).filter(s => s.scored).length;
    } catch { /* unreadable spec */ }
    const latest = [...runs].sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0];
    const parsed = latest ? parseRunOutcome(latest.outcome) : null;
    const outcome = parsed && ignore.length ? outcomeWithout(parsed, new Set(ignore)) : parsed;
    const percent = outcome
      ? (outcome.keys.length ? Math.round(((outcome.keys.length - outcome.missed.length) * 100) / outcome.keys.length) : 100)
      : latest && latest.total > 0 ? Math.round((latest.correct * 100) / latest.total) : 0;
    const summary: LessonRevisionSummary = {
      status: state.status,
      revision: state.revision,
      due_date: state.status === 'revision' && state.due_ms !== null ? dayIn(state.due_ms, tz) : null,
      to_get_right: state.status !== 'revision' ? 0 : state.full || state.missed.length === 0 ? scored : state.missed.length,
      percent,
    };
    out.set(id, {
      ...summary,
      next_revisit_at: state.status === 'revision' && state.due_ms !== null ? new Date(state.due_ms).toISOString() : null,
      retired: state.status === 'done',
      revision_label: state.status === 'new' ? null : revisionProgressLabel(summary, today),
    });
  }
  return out;
}
