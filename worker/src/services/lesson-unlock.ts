/**
 * Unlockable mini lessons, server side (shared/lesson/unlock.ts; docs/STUDY_SESSION.md
 * "Unlockable lessons"):
 *
 * - `applyLessonUnlocks`: the devices' unlock events (offline-first, idempotent — the earliest
 *   `unlocked_at` wins, a lesson without a condition is left alone).
 * - `recordAudioListened`: a listen reached the end of an audio lesson (any device) → its
 *   `listened_at` (earliest wins) and every LOCKED lesson waiting on it is unlocked (`auto`).
 * - `validateUnlockForUser`: an unlock condition from an API body, its audio lesson the caller's.
 * - `companionsFor`: each audio lesson's companion (being written / failed / locked / unlocked).
 */
import {
  lessonUnlockFromRow,
  pickLessonUnlock,
  LESSON_UNLOCK_VIAS,
  type LessonUnlock,
  type LessonUnlockVia,
} from '@shared/lesson';
import type { AudioLessonCompanion as Companion } from '@shared/audio-lesson/types';

export const MAX_UNLOCK_EVENTS = 200;
/** A companion still "generating" after this long was lost (a crashed delivery): reported as failed. */
export const COMPANION_STALE_MS = 20 * 60 * 1000;

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  // Never in the future (a device clock ahead): clamp to now.
  return new Date(Math.min(t, Date.now())).toISOString();
}

/** What GET /api/custom-lessons carries per lesson. */
export function lessonUnlockFields(row: {
  unlock_kind?: string | null; unlock_ref?: string | null; unlock_prompt?: string | null;
  unlocked_at?: string | null; unlocked_via?: string | null; companion_of?: string | null;
}): { unlock: LessonUnlock | null; unlocked_at: string | null; unlocked_via: string | null; companion_of: string | null } {
  const unlock = lessonUnlockFromRow(row);
  return {
    unlock,
    unlocked_at: unlock ? row.unlocked_at ?? null : null,
    unlocked_via: unlock ? row.unlocked_via ?? null : null,
    companion_of: row.companion_of ?? null,
  };
}

/** An unlock condition from an API body; an audio lesson must be the caller's. */
export async function validateUnlockForUser(
  db: D1Database,
  userId: string,
  raw: unknown,
): Promise<{ unlock: LessonUnlock | null; problems: string[] }> {
  const picked = pickLessonUnlock(raw);
  if (picked.problems.length || !picked.unlock) return picked;
  if (picked.unlock.kind === 'audio_lesson') {
    const row = await db
      .prepare('SELECT id FROM audio_lessons WHERE id = ? AND user_id = ? AND format IS NOT NULL')
      .bind(picked.unlock.audio_lesson_id, userId)
      .first<{ id: string }>();
    if (!row) return { unlock: null, problems: ['unlock.audio_lesson_id is not one of your audio lessons'] };
  }
  return picked;
}

export interface UnlockEventInput { lesson_id?: unknown; unlocked_at?: unknown; via?: unknown }

/**
 * Unlock lessons (idempotent). `unlocked` = the time was written (a first unlock, or an earlier
 * one than stored); `already` = it was already unlocked at that time or earlier; `not_found` =
 * not the caller's lesson, or a lesson without a condition.
 */
export async function applyLessonUnlocks(
  db: D1Database,
  userId: string,
  events: UnlockEventInput[],
): Promise<{ unlocked: string[]; already: string[]; not_found: string[]; invalid: number }> {
  const out = { unlocked: [] as string[], already: [] as string[], not_found: [] as string[], invalid: 0 };
  for (const e of events.slice(0, MAX_UNLOCK_EVENTS)) {
    const id = typeof e.lesson_id === 'string' && e.lesson_id ? e.lesson_id : null;
    const at = isoOrNull(e.unlocked_at) ?? (e.unlocked_at === undefined ? new Date().toISOString() : null);
    const via: LessonUnlockVia = (LESSON_UNLOCK_VIAS as readonly unknown[]).includes(e.via) ? (e.via as LessonUnlockVia) : 'manual';
    if (!id || !at) { out.invalid++; continue; }
    const row = await db
      .prepare('SELECT unlock_kind, unlocked_at FROM custom_lessons WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<{ unlock_kind: string | null; unlocked_at: string | null }>();
    if (!row || !row.unlock_kind) { out.not_found.push(id); continue; }
    if (row.unlocked_at && Date.parse(row.unlocked_at) <= Date.parse(at)) { out.already.push(id); continue; }
    await db
      .prepare(`UPDATE custom_lessons SET unlocked_at = ?, unlocked_via = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .bind(at, via, id, userId)
      .run();
    out.unlocked.push(id);
  }
  return out;
}

export interface ListenedEventInput { audio_lesson_id?: unknown; listened_at?: unknown }

/**
 * A listen reached the end of these audio lessons: `listened_at` (earliest wins) and the locked
 * lessons waiting on each are unlocked (`auto`, at the listen's time). Returns the audio lessons
 * recorded and the lessons it unlocked.
 */
export async function recordAudioListened(
  db: D1Database,
  userId: string,
  events: ListenedEventInput[],
): Promise<{ listened: string[]; not_found: string[]; unlocked_lessons: string[] }> {
  const out = { listened: [] as string[], not_found: [] as string[], unlocked_lessons: [] as string[] };
  for (const e of events.slice(0, MAX_UNLOCK_EVENTS)) {
    const id = typeof e.audio_lesson_id === 'string' && e.audio_lesson_id ? e.audio_lesson_id : null;
    const at = isoOrNull(e.listened_at) ?? new Date().toISOString();
    if (!id) continue;
    const row = await db
      .prepare('SELECT id, listened_at FROM audio_lessons WHERE id = ? AND user_id = ? AND format IS NOT NULL')
      .bind(id, userId)
      .first<{ id: string; listened_at: string | null }>();
    if (!row) { out.not_found.push(id); continue; }
    if (!row.listened_at || Date.parse(at) < Date.parse(row.listened_at)) {
      await db.prepare('UPDATE audio_lessons SET listened_at = ? WHERE id = ? AND user_id = ?').bind(at, id, userId).run();
    }
    out.listened.push(id);
    const waiting = await db
      .prepare(`SELECT id FROM custom_lessons WHERE user_id = ? AND unlock_kind = 'audio_lesson' AND unlock_ref = ? AND unlocked_at IS NULL`)
      .bind(userId, id)
      .all<{ id: string }>();
    for (const w of waiting.results ?? []) {
      await db
        .prepare(`UPDATE custom_lessons SET unlocked_at = ?, unlocked_via = 'auto', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND unlocked_at IS NULL`)
        .bind(at, w.id, userId)
        .run();
      out.unlocked_lessons.push(w.id);
    }
  }
  return out;
}

interface CompanionLessonRow {
  id: string;
  title: string;
  companion_of: string;
  unlock_kind: string | null;
  unlocked_at: string | null;
  finishes: number;
  created_at: string;
}

/** The companion lessons of these audio lessons (newest per audio lesson). */
export async function companionLessonRows(db: D1Database, userId: string, audioIds: string[]): Promise<Map<string, CompanionLessonRow>> {
  const out = new Map<string, CompanionLessonRow>();
  for (let i = 0; i < audioIds.length; i += 90) {
    const chunk = audioIds.slice(i, i + 90);
    if (!chunk.length) continue;
    const rows = await db
      .prepare(
        `SELECT l.id, l.title, l.companion_of, l.unlock_kind, l.unlocked_at, l.created_at,
           (SELECT COUNT(*) FROM custom_lesson_completions c WHERE c.lesson_id = l.id AND c.user_id = l.user_id) AS finishes
         FROM custom_lessons l
         WHERE l.user_id = ? AND l.companion_of IN (${chunk.map(() => '?').join(',')})
         ORDER BY l.created_at`,
      )
      .bind(userId, ...chunk)
      .all<CompanionLessonRow>();
    for (const r of rows.results ?? []) out.set(r.companion_of, r);
  }
  return out;
}

/** Each audio lesson's companion for the list / player / MCP. */
export async function companionsFor(
  db: D1Database,
  userId: string,
  audio: Array<{ id: string; companion_status?: string | null; companion_error?: string | null; companion_started_at?: string | null }>,
  nowMs = Date.now(),
): Promise<Map<string, Companion | null>> {
  const lessons = await companionLessonRows(db, userId, audio.map(a => a.id));
  const out = new Map<string, Companion | null>();
  for (const a of audio) {
    const l = lessons.get(a.id);
    const started = Date.parse(a.companion_started_at ?? '');
    const stale = a.companion_status === 'generating' && Number.isFinite(started) && nowMs - started > COMPANION_STALE_MS;
    if (a.companion_status === 'generating' && !stale) {
      out.set(a.id, { status: 'generating', lesson_id: l?.id ?? null, title: l?.title ?? null, started: (l?.finishes ?? 0) > 0 });
    } else if (a.companion_status === 'failed' || stale) {
      out.set(a.id, { status: 'failed', lesson_id: l?.id ?? null, title: l?.title ?? null, error: stale ? 'It took too long — try again' : a.companion_error ?? null, started: (l?.finishes ?? 0) > 0 });
    } else if (l) {
      const status = !l.unlock_kind || l.unlocked_at ? 'unlocked' : 'locked';
      out.set(a.id, { status, lesson_id: l.id, title: l.title, started: l.finishes > 0 });
    } else {
      out.set(a.id, null);
    }
  }
  return out;
}


/**
 * `listened_at` + the companion of each of a user's audio lessons (all of them, or `ids`), for
 * the audio lesson list / detail: `{ listened_at, companion }` per id.
 */
export async function audioLessonUnlockInfo(
  db: D1Database,
  userId: string,
  ids?: string[],
): Promise<Map<string, { listened_at: string | null; companion: Companion | null }>> {
  const rows = ids
    ? (await Promise.all(
        ids.map(id =>
          db
            .prepare('SELECT id, listened_at, companion_status, companion_error, companion_started_at FROM audio_lessons WHERE id = ? AND user_id = ?')
            .bind(id, userId)
            .first<{ id: string; listened_at: string | null; companion_status: string | null; companion_error: string | null; companion_started_at: string | null }>(),
        ),
      )).filter((r): r is NonNullable<typeof r> => !!r)
    : ((await db
        .prepare('SELECT id, listened_at, companion_status, companion_error, companion_started_at FROM audio_lessons WHERE user_id = ? AND format IS NOT NULL')
        .bind(userId)
        .all<{ id: string; listened_at: string | null; companion_status: string | null; companion_error: string | null; companion_started_at: string | null }>()).results ?? []);
  const companions = await companionsFor(db, userId, rows);
  const out = new Map<string, { listened_at: string | null; companion: Companion | null }>();
  for (const r of rows) out.set(r.id, { listened_at: r.listened_at, companion: companions.get(r.id) ?? null });
  return out;
}
