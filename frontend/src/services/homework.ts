/**
 * Homework on the student's device (docs/HOMEWORK.md).
 *
 * Offline-first like reviews: the assignments are mirrored into IndexedDB by
 * the sync (`syncHomework`), the one-off pass writes events locally
 * (`recordPassEvent`) and uploads them right away when online, otherwise on
 * the next sync. Progress is always computed from events with the shared
 * `passProgress`, so a pass finished offline shows as done at once.
 */

import {
  localDate,
  oneOffOnlyTargets,
  sortHomeworkItems,
  titleParts,
  toHomeworkItems as toItems,
  KIND_ICON,
  type HomeworkAssignment,
  type HomeworkEvent,
  type HomeworkItemView,
  type HomeworkResult,
} from '@shared/homework';
import { db, type LocalHomeworkAssignment, type LocalHomeworkEvent } from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';
import { isEffectivelyOffline } from './offlineMode';

// ============ Sync ============

async function uploadEvents(): Promise<number> {
  const pending = await db.homeworkEvents.where('_synced').equals(0).toArray();
  if (pending.length === 0) return 0;
  const response = await fetch(`${API_BASE}/api/me/homework/events`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: pending.map(({ id, assignment_id, item_id, result, created_at, note }) => ({ id, assignment_id, item_id, result, created_at, note: note ?? null })),
    }),
  });
  if (!response.ok) throw new Error(`Failed to upload homework progress: ${response.status}`);
  const data = (await response.json()) as { assignments?: HomeworkAssignment[] };
  await db.transaction('rw', [db.homeworkEvents, db.homeworkAssignments], async () => {
    await db.homeworkEvents.bulkPut(pending.map((e) => ({ ...e, _synced: 1 })));
    for (const a of data.assignments ?? []) await db.homeworkAssignments.put({ ...a, _synced_at: Date.now() });
  });
  return pending.length;
}

/** Push local pass events, then mirror the server's assignments (and other devices' events). */
export async function syncHomework(): Promise<{ uploaded: number; assignments: number }> {
  const uploaded = await uploadEvents();
  const response = await fetch(`${API_BASE}/api/me/homework`, { headers: getAuthHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch homework: ${response.status}`);
  const data = (await response.json()) as { assignments: HomeworkAssignment[]; events: HomeworkEvent[] };
  const now = Date.now();
  await db.transaction('rw', [db.homeworkAssignments, db.homeworkEvents], async () => {
    const serverIds = new Set(data.assignments.map((a) => a.id));
    const local = await db.homeworkAssignments.toArray();
    const gone = local.filter((a) => !serverIds.has(a.id)).map((a) => a.id);
    if (gone.length) await db.homeworkAssignments.bulkDelete(gone);
    await db.homeworkAssignments.bulkPut(data.assignments.map((a) => ({ ...a, _synced_at: now })));
    for (const e of data.events) {
      if (!(await db.homeworkEvents.get(e.id))) await db.homeworkEvents.put({ ...e, _synced: 1 });
    }
  });
  return { uploaded, assignments: data.assignments.length };
}

/** Record one pass event locally; upload straight away when online (the sync retries otherwise). */
export async function recordPassEvent(assignmentId: string, itemId: string, result: HomeworkResult, note?: string | null): Promise<LocalHomeworkEvent> {
  const event: LocalHomeworkEvent = {
    id: crypto.randomUUID(),
    assignment_id: assignmentId,
    item_id: itemId,
    result,
    created_at: new Date().toISOString(),
    // A note back to the tutor (link homework, docs/HOMEWORK.md §8).
    note: note ?? null,
    _synced: 0,
  };
  await db.homeworkEvents.put(event);
  if (!isEffectivelyOffline()) {
    uploadEvents().catch((err) => console.warn('[homework] upload deferred to the next sync', err));
  }
  return event;
}

/**
 * A lesson or reader was finished (in the pass or in the study session): mark
 * every open one-off assignment on it done. Never throws — study must not fail
 * because of homework bookkeeping.
 */
export async function recordTargetDone(kind: 'lesson' | 'reader', targetId: string): Promise<void> {
  try {
    const list = await db.homeworkAssignments.where('target_id').equals(targetId).toArray();
    for (const a of list) {
      if (a.kind !== kind || a.status !== 'active' || a.mode === 'fsrs') continue;
      const events = await db.homeworkEvents.where('assignment_id').equals(a.id).toArray();
      if (events.some((e) => e.result === 'done')) continue;
      await recordPassEvent(a.id, targetId, 'done');
    }
  } catch (err) {
    console.warn('[homework] could not record completion', err);
  }
}

/**
 * Lessons / readers assigned one-off only: they stay out of the study
 * session's lesson mix and the daily-reader pick (the pass is where they are
 * done). Any status — a finished or cancelled one-off never joins FSRS.
 */
export async function oneOffOnlyTargetIds(): Promise<Set<string>> {
  try {
    return oneOffOnlyTargets(await db.homeworkAssignments.toArray());
  } catch {
    return new Set();
  }
}

// ============ What the screens show ============

export type HomeworkItem = HomeworkItemView<LocalHomeworkAssignment>;

export function toHomeworkItems(assignments: LocalHomeworkAssignment[], events: LocalHomeworkEvent[], today: string = localDate()): HomeworkItem[] {
  return toItems(assignments, events, today);
}

export { sortHomeworkItems, titleParts, KIND_ICON };

export async function loadHomeworkItems(): Promise<HomeworkItem[]> {
  const [assignments, events] = await Promise.all([db.homeworkAssignments.toArray(), db.homeworkEvents.toArray()]);
  return toHomeworkItems(assignments, events);
}
