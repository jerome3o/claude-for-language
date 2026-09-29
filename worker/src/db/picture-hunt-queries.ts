/**
 * SQL for picture hunts (migration 0082). Rows are per user; `objects` is the
 * HuntObject[] JSON (shared/picture-hunt/types.ts).
 */
import type { HuntObject, PictureHunt, PictureHuntPlay, PictureHuntSource, PictureHuntSummary } from '@shared/picture-hunt';

export interface PictureHuntRow {
  id: string;
  user_id: string;
  title: string;
  source: PictureHuntSource;
  prompt: string | null;
  deck_ids: string | null;
  image_key: string | null;
  image_width: number | null;
  image_height: number | null;
  status: 'generating' | 'ready' | 'error';
  progress: string | null;
  error: string | null;
  objects: string | null;
  object_count: number;
  best_found: number | null;
  play_count: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PICTURE_HUNT_PREFIX = 'picture-hunts/';

export function pictureHuntImageKey(id: string, ext: 'jpg' | 'png' | 'webp'): string {
  return `${PICTURE_HUNT_PREFIX}${id}.${ext}`;
}

export function huntSummary(row: PictureHuntRow): PictureHuntSummary {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    prompt: row.prompt,
    status: row.status,
    progress: row.progress,
    error: row.error,
    object_count: row.object_count,
    image_width: row.image_width,
    image_height: row.image_height,
    best_found: row.best_found,
    play_count: row.play_count,
    last_played_at: row.last_played_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function parseHuntObjects(json: string | null): HuntObject[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as HuntObject[]) : [];
  } catch {
    return [];
  }
}

export function huntWithObjects(row: PictureHuntRow): PictureHunt {
  return { ...huntSummary(row), objects: parseHuntObjects(row.objects) };
}

export async function createPictureHunt(
  db: D1Database,
  params: { id?: string; userId: string; title: string; source: PictureHuntSource; prompt: string | null; deckIds: string[] | null },
): Promise<string> {
  const id = params.id ?? crypto.randomUUID();
  await db.prepare(`
    INSERT INTO picture_hunts (id, user_id, title, source, prompt, deck_ids, status, progress)
    VALUES (?, ?, ?, ?, ?, ?, 'generating', 'queued')
  `).bind(id, params.userId, params.title, params.source, params.prompt, params.deckIds ? JSON.stringify(params.deckIds) : null).run();
  return id;
}

export async function getPictureHunt(db: D1Database, id: string, userId: string): Promise<PictureHuntRow | null> {
  return (await db.prepare('SELECT * FROM picture_hunts WHERE id = ? AND user_id = ?').bind(id, userId).first<PictureHuntRow>()) ?? null;
}

/** Consumer-side lookup: the queue message has no user context. */
export async function getPictureHuntUnscoped(db: D1Database, id: string): Promise<PictureHuntRow | null> {
  return (await db.prepare('SELECT * FROM picture_hunts WHERE id = ?').bind(id).first<PictureHuntRow>()) ?? null;
}

export async function listPictureHunts(db: D1Database, userId: string, limit = 100): Promise<PictureHuntRow[]> {
  const result = await db.prepare('SELECT * FROM picture_hunts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(userId, limit)
    .all<PictureHuntRow>();
  return result.results;
}

export async function setPictureHuntProgress(db: D1Database, id: string, progress: string): Promise<void> {
  await db.prepare(`UPDATE picture_hunts SET progress = ?, updated_at = datetime('now') WHERE id = ?`).bind(progress.slice(0, 200), id).run();
}

export async function setPictureHuntImage(db: D1Database, id: string, key: string, width: number | null, height: number | null): Promise<void> {
  await db.prepare(`UPDATE picture_hunts SET image_key = ?, image_width = ?, image_height = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(key, width, height, id)
    .run();
}

export async function setPictureHuntReady(db: D1Database, id: string, title: string, objects: HuntObject[]): Promise<void> {
  await db.prepare(`
    UPDATE picture_hunts
    SET status = 'ready', title = ?, objects = ?, object_count = ?, error = NULL, progress = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).bind(title.slice(0, 120), JSON.stringify(objects), objects.length, id).run();
}

export async function setPictureHuntError(db: D1Database, id: string, error: string): Promise<void> {
  await db.prepare(`UPDATE picture_hunts SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(error.slice(0, 500), id)
    .run();
}

/** Put a failed hunt back in the queue's hands (the picture, if any, is kept). */
export async function resetPictureHuntForRetry(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare(`
    UPDATE picture_hunts
    SET status = 'generating', error = NULL, progress = 'queued', created_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(id, userId).run();
}

export async function deletePictureHunt(db: D1Database, id: string, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM picture_hunt_plays WHERE hunt_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM picture_hunts WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
}

/** A build that never came back (worker died mid-flight) shows as failed. */
export async function markStalePictureHunts(db: D1Database, userId: string, maxAgeSeconds = 1200): Promise<void> {
  await db.prepare(`
    UPDATE picture_hunts
    SET status = 'error',
        error = 'Timed out — ' || COALESCE('stopped at: ' || progress, 'it never started') || '. Tap retry.'
    WHERE user_id = ?
      AND status = 'generating'
      AND created_at <= datetime('now', '-' || ? || ' seconds')
  `).bind(userId, maxAgeSeconds).run();
}

/** Insert plays (idempotent by id) and recompute each touched hunt's best / count. */
export async function recordPictureHuntPlays(db: D1Database, userId: string, plays: PictureHuntPlay[]): Promise<number> {
  if (plays.length === 0) return 0;
  const inserts = plays.map((p) => db.prepare(`
    INSERT OR IGNORE INTO picture_hunt_plays (id, hunt_id, user_id, found_ids, found_count, total, hints_used, gave_up, duration_ms, played_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(p.id, p.hunt_id, userId, JSON.stringify(p.found_ids), p.found_ids.length, p.total, p.hints_used, p.gave_up ? 1 : 0, p.duration_ms, p.played_at));
  const results = await db.batch(inserts);
  const accepted = results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  const huntIds = Array.from(new Set(plays.map((p) => p.hunt_id)));
  await db.batch(huntIds.map((huntId) => db.prepare(`
    UPDATE picture_hunts SET
      best_found = (SELECT MAX(found_count) FROM picture_hunt_plays WHERE hunt_id = ?1 AND user_id = ?2),
      play_count = (SELECT COUNT(*) FROM picture_hunt_plays WHERE hunt_id = ?1 AND user_id = ?2),
      last_played_at = (SELECT MAX(played_at) FROM picture_hunt_plays WHERE hunt_id = ?1 AND user_id = ?2)
    WHERE id = ?1 AND user_id = ?2
  `).bind(huntId, userId)));
  return accepted;
}

/** The caller's hunts that exist, among these ids (plays for other hunts are dropped). */
export async function ownedHuntObjectIds(db: D1Database, userId: string, huntIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const id of huntIds) {
    const row = await db.prepare('SELECT objects FROM picture_hunts WHERE id = ? AND user_id = ?').bind(id, userId).first<{ objects: string | null }>();
    if (row) out.set(id, new Set(parseHuntObjects(row.objects).map((o) => o.id)));
  }
  return out;
}
