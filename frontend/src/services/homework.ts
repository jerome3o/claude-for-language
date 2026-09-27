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
  compareDue,
  dueLabel,
  localDate,
  passItemIds,
  passProgress,
  type HomeworkAssignment,
  type HomeworkEvent,
  type HomeworkResult,
  type DueLabel,
  type PassProgress,
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
      events: pending.map(({ id, assignment_id, item_id, result, created_at }) => ({ id, assignment_id, item_id, result, created_at })),
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
export async function recordPassEvent(assignmentId: string, itemId: string, result: HomeworkResult): Promise<LocalHomeworkEvent> {
  const event: LocalHomeworkEvent = {
    id: crypto.randomUUID(),
    assignment_id: assignmentId,
    item_id: itemId,
    result,
    created_at: new Date().toISOString(),
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
    const list = await db.homeworkAssignments.toArray();
    const fsrs = new Set(list.filter((a) => a.mode !== 'one_off').map((a) => a.target_id));
    return new Set(list.filter((a) => a.mode === 'one_off' && !fsrs.has(a.target_id)).map((a) => a.target_id));
  } catch {
    return new Set();
  }
}

// ============ What the screens show ============

export interface HomeworkItem {
  assignment: LocalHomeworkAssignment;
  progress: PassProgress;
  due: DueLabel;
  /** Done on this device or on the server. */
  done: boolean;
}

export function toHomeworkItems(assignments: LocalHomeworkAssignment[], events: LocalHomeworkEvent[], today: string = localDate()): HomeworkItem[] {
  const byAssignment = new Map<string, LocalHomeworkEvent[]>();
  for (const e of events) {
    const list = byAssignment.get(e.assignment_id) ?? [];
    list.push(e);
    byAssignment.set(e.assignment_id, list);
  }
  return assignments
    .filter((a) => a.mode !== 'fsrs' && a.status !== 'cancelled')
    .map((a) => {
      const progress = passProgress(passItemIds(a), byAssignment.get(a.id) ?? []);
      const done = a.status === 'done' || progress.complete;
      return { assignment: a, progress, due: dueLabel(a.due_date, today), done };
    });
}

/** To do first: overdue, then by due date, then by part; done ones newest first. */
export function sortHomeworkItems(items: HomeworkItem[]): { todo: HomeworkItem[]; done: HomeworkItem[] } {
  const todo = items
    .filter((i) => !i.done)
    .sort((a, b) => compareDue(a.assignment.due_date, b.assignment.due_date) || a.assignment.part_index - b.assignment.part_index || a.assignment.created_at.localeCompare(b.assignment.created_at));
  const done = items
    .filter((i) => i.done)
    .sort((a, b) => (b.assignment.completed_at ?? b.assignment.updated_at).localeCompare(a.assignment.completed_at ?? a.assignment.updated_at));
  return { todo, done };
}

export async function loadHomeworkItems(): Promise<HomeworkItem[]> {
  const [assignments, events] = await Promise.all([db.homeworkAssignments.toArray(), db.homeworkEvents.toArray()]);
  return toHomeworkItems(assignments, events);
}

/** "Restaurant · day 1 of 2" → { base: 'Restaurant', part: 'day 1 of 2' } — the part goes on the meta line. */
export function titleParts(a: Pick<HomeworkAssignment, 'title' | 'part_index' | 'part_count'>): { base: string; part: string | null } {
  if (a.part_count <= 1) return { base: a.title, part: null };
  const part = `day ${a.part_index + 1} of ${a.part_count}`;
  const base = a.title.endsWith(` · ${part}`) ? a.title.slice(0, -` · ${part}`.length) : a.title;
  return { base, part };
}

export const KIND_ICON: Record<string, string> = { deck: '📚', lesson: '🎓', reader: '📖' };
