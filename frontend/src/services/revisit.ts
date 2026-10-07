/**
 * "Revisit later" on the device (shared/study/revisit.ts): when finished mini
 * lessons come back, and how many new ones a day join the session. (Graded
 * readers are read once, never repeated — services/reader-study.ts; their old
 * retire / restore marks are ignored.)
 *
 * - The account's gaps (Settings → "Lessons & readers") are mirrored in
 *   localStorage like the study budget, so the schedule works offline; the
 *   server copy rides on /api/auth/me and /api/sync/changes (`revisit_settings`).
 * - "Done for good" / "Bring back" are events (IndexedDB `revisitEvents`):
 *   written at once, uploaded straight away when online (POST
 *   /api/me/revisit-events, idempotent by id), else in the next sync; every
 *   sync replaces the server's rows whole, keeping this device's pending ones.
 * - Each lesson row caches the state derived from its history (completion
 *   events + these), recomputed whenever any of them changes — never stored
 *   on its own.
 */
import {
  computeRevisitState,
  DEFAULT_REVISIT_SETTINGS,
  parseRevisitSettings,
  revisitGapLabel,
  revisitPreviews,
  revisitSettingsInfo,
  type RevisitEvent,
  type RevisitSettings,
  type RevisitSettingsInfo,
  type RevisitState,
} from '@shared/study/revisit';
import { db, type LocalCustomLesson, type LocalRevisitEvent } from '../db/database';
import { CardQueue, type IntervalPreview, type Rating } from '../types';
import { API_BASE, getAuthHeaders } from '../api/client';
import { track } from './analytics';

/** What the schedule covers. ('reader' marks from before Oct 2026 stay in the table but are ignored.) */
export type RevisitKind = 'lesson';

// ============ Settings mirror ============

const KEY = 'revisitSettings';
/** Fired on window when the mirror changed (Settings re-reads, lists recompute). */
export const REVISIT_SETTINGS_CHANGED = 'revisit-settings-changed';

export function readRevisitSettings(): RevisitSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseRevisitSettings(raw);
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_REVISIT_SETTINGS };
}

export function readRevisitSettingsInfo(): RevisitSettingsInfo {
  return revisitSettingsInfo(readRevisitSettings());
}

/** Store the server's settings (RevisitSettingsInfo, or a user carrying `revisit_settings`). Returns whether they changed. */
export function writeRevisitSettings(src: (Partial<RevisitSettings> & { revisit_settings?: unknown }) | null | undefined): boolean {
  if (!src) return false;
  const raw = 'revisit_settings' in src ? src.revisit_settings : src;
  if (!raw || typeof raw !== 'object') return false;
  const next = parseRevisitSettings(raw);
  let changed = false;
  try {
    const nextRaw = JSON.stringify(next);
    changed = localStorage.getItem(KEY) !== nextRaw;
    localStorage.setItem(KEY, nextRaw);
  } catch { /* storage unavailable */ }
  if (changed) {
    void recomputeAllRevisitStates().catch(() => {});
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent(REVISIT_SETTINGS_CHANGED, { detail: next })); } catch { /* no window events */ }
    }
  }
  return changed;
}

/** PUT /api/profile/revisit-settings; `{ reset: true }` = all defaults. Throws with `problems` on a 400. */
export async function saveRevisitSettings(body: Partial<RevisitSettings> | { reset: true }): Promise<RevisitSettingsInfo> {
  const res = await fetch(`${API_BASE}/api/profile/revisit-settings`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as RevisitSettingsInfo & { error?: string; problems?: string[] };
  if (!res.ok) {
    const err = new Error(data.error || `Couldn't save (${res.status})`) as Error & { problems?: string[] };
    err.problems = data.problems;
    throw err;
  }
  writeRevisitSettings(data);
  return data;
}

// ============ History → state ============

async function revisitEventsFor(kind: RevisitKind, itemId: string): Promise<LocalRevisitEvent[]> {
  return (await db.revisitEvents.where('item_id').equals(itemId).toArray()).filter(e => e.item_kind === kind);
}

/** An item's whole history in the shared shape. */
export async function revisitHistory(kind: RevisitKind, itemId: string): Promise<RevisitEvent[]> {
  const finishes: RevisitEvent[] = (await db.customLessonCompletionEvents.where('lesson_id').equals(itemId).toArray())
    .map(e => ({ id: e.id, at: e.completed_at, kind: 'rating' as const, rating: e.rating ?? null }));
  const marks: RevisitEvent[] = (await revisitEventsFor(kind, itemId)).map(e => ({ id: e.id, at: e.created_at, kind: e.action }));
  return [...finishes, ...marks];
}

export async function computeItemRevisitState(kind: RevisitKind, itemId: string, settings = readRevisitSettings()): Promise<RevisitState> {
  return computeRevisitState(await revisitHistory(kind, itemId), settings);
}

type SchedulingFields = Pick<
  LocalCustomLesson,
  'queue' | 'stability' | 'difficulty' | 'lapses' | 'interval' | 'repetitions' |
  'next_review_at' | 'due_timestamp' | 'last_reviewed_at' | 'retired'
>;

/**
 * The row fields for a state: NEW = never finished; REVIEW = comes back at
 * next_review_at / due_timestamp; `retired` = Done for good (no due date).
 * stability / difficulty / lapses are FSRS leftovers, kept at 0.
 */
export function revisitRowFields(state: RevisitState): SchedulingFields {
  const due = state.status === 'scheduled' ? state.due_ms : null;
  return {
    queue: state.status === 'new' ? CardQueue.NEW : CardQueue.REVIEW,
    stability: 0,
    difficulty: 0,
    lapses: 0,
    interval: state.gap_days,
    repetitions: state.finishes,
    next_review_at: due !== null ? new Date(due).toISOString() : null,
    due_timestamp: due,
    last_reviewed_at: state.last_ms !== null ? new Date(state.last_ms).toISOString() : null,
    retired: state.status === 'retired',
  };
}

/** When a cached row is due (ms): due_timestamp, else next_review_at, else now-ish (0). */
export function rowDueMs(row: { due_timestamp?: number | null; next_review_at?: string | null }): number {
  if (typeof row.due_timestamp === 'number') return row.due_timestamp;
  const t = row.next_review_at ? Date.parse(row.next_review_at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** The row's own state back (no event read): for previews on a cached row. */
export function rowRevisitState(row: Pick<LocalCustomLesson, 'queue' | 'interval' | 'repetitions' | 'due_timestamp' | 'next_review_at' | 'last_reviewed_at'> & { retired?: boolean }): RevisitState {
  if (row.retired) return { status: 'retired', due_ms: null, gap_days: row.interval ?? 0, last_ms: null, finishes: row.repetitions ?? 0 };
  if (row.queue === CardQueue.NEW) return { status: 'new', due_ms: null, gap_days: 0, last_ms: null, finishes: 0 };
  return {
    status: 'scheduled',
    due_ms: rowDueMs(row),
    gap_days: row.interval ?? 0,
    last_ms: row.last_reviewed_at ? Date.parse(row.last_reviewed_at) : null,
    finishes: row.repetitions ?? 0,
  };
}

/** Recompute one item's cached fields from its history. */
export async function refreshRevisitRow(kind: RevisitKind, itemId: string): Promise<RevisitState> {
  const state = await computeItemRevisitState(kind, itemId);
  await db.customLessons.update(itemId, revisitRowFields(state));
  return state;
}

/** Recompute every lesson (after a sync, or when the gaps changed). */
export async function recomputeAllRevisitStates(): Promise<void> {
  const settings = readRevisitSettings();
  const [lessons, lessonEvents, marks] = await Promise.all([
    db.customLessons.toArray(),
    db.customLessonCompletionEvents.toArray(),
    db.revisitEvents.toArray(),
  ]);
  const byItem = new Map<string, RevisitEvent[]>();
  const push = (key: string, e: RevisitEvent) => {
    const list = byItem.get(key);
    if (list) list.push(e); else byItem.set(key, [e]);
  };
  for (const e of lessonEvents) push(`lesson:${e.lesson_id}`, { id: e.id, at: e.completed_at, kind: 'rating', rating: e.rating ?? null });
  for (const m of marks) if (m.item_kind === 'lesson') push(`${m.item_kind}:${m.item_id}`, { id: m.id, at: m.created_at, kind: m.action });

  const lessonRows = lessons.map(l => ({ ...l, ...revisitRowFields(computeRevisitState(byItem.get(`lesson:${l.id}`) ?? [], settings)) }));
  if (lessonRows.length) await db.customLessons.bulkPut(lessonRows);
}

/** Rating-button labels ("1 day", "2 wk", "6 wk") for a row as it stands. */
export function revisitButtonPreviews(row: Parameters<typeof rowRevisitState>[0]): Record<Rating, IntervalPreview> {
  const gaps = revisitPreviews(rowRevisitState(row), readRevisitSettings());
  const out = {} as Record<Rating, IntervalPreview>;
  for (const r of [0, 1, 2, 3] as Rating[]) out[r] = { intervalText: revisitGapLabel(gaps[r]), queue: CardQueue.REVIEW };
  return out;
}

/** "Back 20 Oct" / "Due today" / "Done for good" / "New" — the Mini Lessons chip. */
export function revisitChip(state: RevisitState, cutoffMs: number): { label: string; cls: 'active' | 'learning' | 'done' | 'retired' } {
  if (state.status === 'retired') return { label: 'Done for good', cls: 'retired' };
  if (state.status === 'new') return { label: 'New', cls: 'active' };
  if (state.due_ms === null || state.due_ms <= cutoffMs) return { label: 'Due today', cls: 'learning' };
  const d = new Date(state.due_ms);
  return { label: `Next revisit ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, cls: 'done' };
}

// ============ Done for good / Bring back ============

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Write a retire / restore event (local at once, uploaded when online) and refresh the row. */
export async function markRevisit(kind: RevisitKind, itemId: string, action: 'retire' | 'restore', source = 'session'): Promise<void> {
  const event: LocalRevisitEvent = {
    id: crypto.randomUUID(),
    item_kind: kind,
    item_id: itemId,
    action,
    created_at: new Date().toISOString(),
    _synced: 0,
  };
  await db.revisitEvents.put(event);
  if (await db.customLessons.get(itemId)) {
    await refreshRevisitRow(kind, itemId);
  }
  if (action === 'retire') track('study.done_for_good', { kind, source });
  else track('study.bring_back', { kind });
  if (online()) void uploadRevisitEvents().catch(() => {});
}

/** Upload this device's pending events (idempotent by id). Orphans (deleted items) are dropped. */
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

/** Sync step: pending events up, the server's list (+ settings) down, every row recomputed. Never throws. */
export async function syncRevisit(): Promise<void> {
  try {
    await uploadRevisitEvents().catch(err => console.warn('[revisit] upload failed:', err));
    const res = await fetch(`${API_BASE}/api/me/revisit`, { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json() as { settings?: RevisitSettingsInfo; events?: ServerRevisitEvent[] };
      if (data.settings) writeRevisitSettings(data.settings);
      if (Array.isArray(data.events)) await replaceLocalRevisitEvents(data.events);
    }
    await recomputeAllRevisitStates();
  } catch (err) {
    console.warn('[revisit] sync failed:', err);
  }
}
