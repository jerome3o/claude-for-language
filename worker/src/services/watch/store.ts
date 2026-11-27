/**
 * D1 access for 📺 Watch (docs/WATCH.md; migration 0158): the shared transcript of each YouTube
 * video (`watch_videos`, id = the video id) and who added which (`watch_video_users`, with the
 * resume position).
 */
import type { WatchLine, WatchStatus, WatchVideoDetail, WatchVideoSummary } from '@shared/watch';
import type { RawWatchLine } from '@shared/watch';

export interface WatchVideoRow {
  id: string;
  title: string;
  channel: string | null;
  duration_ms: number | null;
  status: WatchStatus;
  progress: string | null;
  chunks_done: number;
  chunks_total: number;
  progress_done: number | null;
  progress_total: number | null;
  error: string | null;
  attempts: number;
  chunks_json: string | null;
  lines_json: string | null;
  provider: string | null;
  model: string | null;
  usage_json: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface WatchUserRow {
  user_id: string;
  video_id: string;
  position_ms: number;
  created_at: string;
  last_opened_at: string | null;
}

/** One window of the video as the job tracks it (the checkpoint). */
export interface WatchChunkState {
  i: number;
  start_ms: number;
  end_ms: number;
  status: 'pending' | 'done' | 'skipped';
  attempts: number;
  error: string | null;
  lines: RawWatchLine[];
  /** The whole video in one read (the model refused clipping offsets). */
  whole?: boolean;
}

export function parseChunks(raw: string | null): WatchChunkState[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as WatchChunkState[]) : [];
  } catch {
    return [];
  }
}

export function parseLines(raw: string | null): WatchLine[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as WatchLine[]) : [];
  } catch {
    return [];
  }
}

export async function getVideo(db: D1Database, id: string): Promise<WatchVideoRow | null> {
  return (await db.prepare('SELECT * FROM watch_videos WHERE id = ?').bind(id).first<WatchVideoRow>()) ?? null;
}

/** A new transcript row (queued), or false when one exists already. */
export async function insertVideo(
  db: D1Database,
  v: { id: string; title: string; channel: string | null; duration_ms: number; userId: string },
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO watch_videos (id, title, channel, duration_ms, status, progress, requested_by)
       VALUES (?, ?, ?, ?, 'queued', 'Waiting to start…', ?)`,
    )
    .bind(v.id, v.title, v.channel, v.duration_ms, v.userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function updateVideo(db: D1Database, id: string, fields: Partial<Omit<WatchVideoRow, 'id'>>): Promise<void> {
  const keys = Object.keys(fields) as Array<keyof typeof fields>;
  if (!keys.length) return;
  await db
    .prepare(`UPDATE watch_videos SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => (fields[k] === undefined ? null : (fields[k] as unknown))), new Date().toISOString(), id)
    .run();
}

export async function linkVideoUser(db: D1Database, userId: string, videoId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO watch_video_users (user_id, video_id) VALUES (?, ?)').bind(userId, videoId).run();
}

export async function getVideoUser(db: D1Database, userId: string, videoId: string): Promise<WatchUserRow | null> {
  return (await db.prepare('SELECT * FROM watch_video_users WHERE user_id = ? AND video_id = ?').bind(userId, videoId).first<WatchUserRow>()) ?? null;
}

export async function touchVideoUser(db: D1Database, userId: string, videoId: string): Promise<void> {
  await db.prepare('UPDATE watch_video_users SET last_opened_at = ? WHERE user_id = ? AND video_id = ?').bind(new Date().toISOString(), userId, videoId).run();
}

export async function savePosition(db: D1Database, userId: string, videoId: string, positionMs: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE watch_video_users SET position_ms = ?, last_opened_at = ? WHERE user_id = ? AND video_id = ?')
    .bind(Math.max(0, Math.round(positionMs)), new Date().toISOString(), userId, videoId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function unlinkVideoUser(db: D1Database, userId: string, videoId: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM watch_video_users WHERE user_id = ? AND video_id = ?').bind(userId, videoId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** "My videos", most recently opened / added first (no transcripts). */
export async function myVideos(db: D1Database, userId: string, limit = 100): Promise<Array<WatchVideoRow & { position_ms: number; last_opened_at: string | null; added_at: string }>> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.title, v.channel, v.duration_ms, v.status, v.progress, v.chunks_done, v.chunks_total, v.progress_done,
              v.progress_total, v.error, v.attempts, NULL AS chunks_json, NULL AS lines_json, v.provider, v.model, NULL AS usage_json,
              NULL AS requested_by, v.created_at, v.updated_at, v.finished_at,
              u.position_ms, u.last_opened_at, u.created_at AS added_at
       FROM watch_video_users u JOIN watch_videos v ON v.id = u.video_id
       WHERE u.user_id = ? ORDER BY COALESCE(u.last_opened_at, u.created_at) DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<WatchVideoRow & { position_ms: number; last_opened_at: string | null; added_at: string }>();
  return results ?? [];
}

// ---------------- shaping

export function videoSummary(r: WatchVideoRow, link: Pick<WatchUserRow, 'position_ms' | 'last_opened_at' | 'created_at'> | null): WatchVideoSummary {
  return {
    id: r.id,
    title: r.title,
    channel: r.channel,
    duration_ms: r.duration_ms,
    status: r.status,
    progress: r.progress,
    chunks_done: r.chunks_done ?? 0,
    chunks_total: r.chunks_total ?? 0,
    progress_done: r.progress_done,
    progress_total: r.progress_total,
    error: r.error,
    position_ms: link?.position_ms ?? 0,
    last_opened_at: link?.last_opened_at ?? null,
    added_at: link?.created_at ?? r.created_at,
  };
}

export function videoDetail(r: WatchVideoRow, link: WatchUserRow | null): WatchVideoDetail {
  const chunks = parseChunks(r.chunks_json);
  return {
    ...videoSummary(r, link),
    lines: parseLines(r.lines_json),
    gaps: chunks.filter((c) => c.status === 'skipped').map((c) => ({ start_ms: c.start_ms, end_ms: c.end_ms })),
    finished_at: r.finished_at,
  };
}
