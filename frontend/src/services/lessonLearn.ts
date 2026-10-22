/**
 * Mini lessons revise until right first time, on the device (shared/study/lessonRevision.ts):
 * each lesson row caches its state — new / a revision (when, which exercises) / done forever —
 * computed from its completion events (each run's outcome: from the server, or from the attempt
 * of a run made here) and the old "Done for good" / "Bring back" marks (revisit_events, before
 * Oct 2026: a retire = done forever). Recomputed after every finish and every sync; never stored
 * on its own. The old "revisit later" ratings and settings are gone (an older app still sends
 * them; the server keeps accepting them).
 */
import { type CustomLessonSpec } from '@shared/lesson';
import {
  computeLessonLearnState,
  isRevisionDue,
  revisionDaysAway,
  revisionKeys,
  runOutcome,
  NEW_LESSON_STATE,
  type LessonLearnState,
  type LessonMarkRecord,
  type LessonRunRecord,
} from '@shared/study/lessonRevision';
import { lessonSteps } from '@shared/study/lessonRun';
import { lessonSizeLabel, revisionSizeLabel, type HomeLesson } from '@shared/homework';
import { lessonLockStatus } from '@shared/lesson';
import { db, type LocalCustomLesson, type LocalCustomLessonCompletionEvent, type LocalRevisitEvent } from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';

/** A completion event as the rule sees it. */
export function runRecord(e: LocalCustomLessonCompletionEvent): LessonRunRecord {
  return { id: e.id, at: e.completed_at, rating: e.rating ?? null, outcome: e.outcome ?? runOutcome(e.attempt) };
}

function markRecord(m: LocalRevisitEvent): LessonMarkRecord {
  return { id: m.id, at: m.created_at, action: m.action };
}

/** A lesson's state from its whole history. */
export async function computeLessonLearn(lessonId: string): Promise<LessonLearnState> {
  const [events, marks] = await Promise.all([
    db.customLessonCompletionEvents.where('lesson_id').equals(lessonId).toArray(),
    db.revisitEvents.where('item_id').equals(lessonId).toArray(),
  ]);
  return computeLessonLearnState(events.map(runRecord), marks.filter(m => m.item_kind === 'lesson').map(markRecord));
}

/** Recompute one row's cached state. */
export async function refreshLessonLearn(lessonId: string): Promise<LessonLearnState> {
  const learn = await computeLessonLearn(lessonId);
  await db.customLessons.update(lessonId, { learn });
  return learn;
}

/** Recompute every lesson (after a sync). */
export async function recomputeAllLessonLearn(): Promise<void> {
  const [lessons, events, marks] = await Promise.all([
    db.customLessons.toArray(),
    db.customLessonCompletionEvents.toArray(),
    db.revisitEvents.toArray(),
  ]);
  const runs = new Map<string, LessonRunRecord[]>();
  for (const e of events) {
    const list = runs.get(e.lesson_id) ?? [];
    list.push(runRecord(e));
    runs.set(e.lesson_id, list);
  }
  const byLesson = new Map<string, LessonMarkRecord[]>();
  for (const m of marks) {
    if (m.item_kind !== 'lesson') continue;
    const list = byLesson.get(m.item_id) ?? [];
    list.push(markRecord(m));
    byLesson.set(m.item_id, list);
  }
  const rows = lessons.map(l => ({ ...l, learn: computeLessonLearnState(runs.get(l.id) ?? [], byLesson.get(l.id) ?? []) }));
  if (rows.length) await db.customLessons.bulkPut(rows);
}

/** The row's cached state (new until computed). */
export function learnOf(row: Pick<LocalCustomLesson, 'learn'>): LessonLearnState {
  return row.learn ?? NEW_LESSON_STATE;
}

/** The scored exercises of the lesson's next revision (`revisionKeys`), in lesson order. */
export function revisionKeysFor(row: Pick<LocalCustomLesson, 'id' | 'spec' | 'learn'>): string[] {
  return revisionKeys(learnOf(row), lessonSteps(row.spec), row.id);
}

/** "18 exercises · ~12 min" */
export function lessonSize(spec: Pick<CustomLessonSpec, 'sections'>): string {
  return lessonSizeLabel(lessonSteps(spec).map(s => s.type));
}

/** "5 questions · ~4 min" — the revision as it would be played now. */
export function revisionSize(row: Pick<LocalCustomLesson, 'id' | 'spec' | 'learn'>): string {
  const keys = revisionKeysFor(row);
  return revisionSizeLabel(keys.length, lessonSteps(row.spec, keys).map(s => s.type));
}

/** A lesson as Home's card sees it (shared/homework/home.ts). */
export function homeLessonOf(row: LocalCustomLesson, cutoffMs: number, tutorName: string | null = null): HomeLesson {
  const learn = learnOf(row);
  const due = isRevisionDue(learn, cutoffMs);
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    status: learn.status,
    locked: !!row.unlock && lessonLockStatus(row.unlock, row.unlocked_at ?? null) === 'locked',
    revision_due: due,
    revision: learn.revision,
    due_ms: learn.due_ms,
    size: due ? revisionSize(row) : lessonSize(row.spec),
    tutor_name: tutorName,
  };
}

/** The Mini Lessons page chip: "New" · "🔁 Revision 2 · due today" · "🔁 Revision 1 · in 5 days" · "✓ Done". */
export function learnChip(learn: LessonLearnState, cutoffMs: number): { label: string; cls: 'active' | 'learning' | 'done' | 'retired' } {
  if (learn.status === 'new') return { label: 'New', cls: 'active' };
  if (learn.status === 'done') return { label: '✓ Done', cls: 'retired' };
  const name = learn.revision > 0 ? `Revision ${learn.revision}` : 'Revision';
  if (isRevisionDue(learn, cutoffMs)) return { label: `🔁 ${name} · due today`, cls: 'learning' };
  const days = revisionDaysAway(learn, cutoffMs);
  return { label: `🔁 ${name} · ${days === 1 ? 'tomorrow' : `in ${days} days`}`, cls: 'done' };
}

// ============ The old Done for good / Bring back marks (read only now) ============

/** Upload marks made here before the update (idempotent by id). */
export async function uploadRevisitEvents(): Promise<{ uploaded: number }> {
  const pending = await db.revisitEvents.where('_synced').equals(0).toArray();
  if (pending.length === 0) return { uploaded: 0 };
  const res = await fetch(`${API_BASE}/api/me/revisit-events`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: pending.map(({ id, item_kind, item_id, action, created_at }) => ({ id, item_kind, item_id, action, created_at })),
    }),
  });
  if (!res.ok) throw new Error(`Failed to upload revisit events: ${res.status}`);
  const result = await res.json() as { accepted?: string[]; orphans?: string[] };
  const done = [...(result.accepted ?? []), ...(result.orphans ?? [])];
  if (done.length) await db.revisitEvents.where('id').anyOf(done).modify({ _synced: 1 });
  if (result.orphans?.length) await db.revisitEvents.bulkDelete(result.orphans);
  return { uploaded: result.accepted?.length ?? 0 };
}

interface ServerRevisitEvent { id: string; item_kind: 'lesson' | 'reader'; item_id: string; action: 'retire' | 'restore'; created_at: string }

/** The server's list replaces the synced rows; this device's pending ones stay on top. */
export async function replaceLocalRevisitEvents(server: ServerRevisitEvent[]): Promise<void> {
  await db.transaction('rw', db.revisitEvents, async () => {
    const pending = await db.revisitEvents.where('_synced').equals(0).toArray();
    const pendingIds = new Set(pending.map(p => p.id));
    await db.revisitEvents.clear();
    await db.revisitEvents.bulkPut([
      ...server.filter(e => !pendingIds.has(e.id)).map(e => ({ ...e, _synced: 1 })),
      ...pending,
    ]);
  });
}
