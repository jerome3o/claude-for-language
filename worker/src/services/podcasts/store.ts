/**
 * D1 access for podcasts (docs/PODCASTS.md; migration 0125): subscriptions, the shared feed
 * cache, the shared episode transcriptions and who asked for which episode.
 */
import type { PodcastFeed, PodcastEpisodeInfo } from './rss';
import type { PodcastSegment } from './segments';

export const PODCAST_AUDIO_PREFIX = 'podcast-episodes/';
/** A cached feed is fresh for this long. */
export const FEED_FRESH_MS = 30 * 60 * 1000;

export type EpisodeStatus = 'queued' | 'downloading' | 'transcribing' | 'translating' | 'ready' | 'failed';

export interface EpisodeRow {
  id: string;
  feed_url: string;
  guid: string | null;
  enclosure_url: string;
  title: string;
  podcast_title: string | null;
  published_at: string | null;
  image_url: string | null;
  status: EpisodeStatus;
  progress: string | null;
  progress_done: number | null;
  progress_total: number | null;
  error: string | null;
  attempts: number;
  audio_key: string | null;
  audio_bytes: number | null;
  audio_mime: string | null;
  duration_ms: number | null;
  stt_job_id: string | null;
  stt_started_at: string | null;
  api_origin: string | null;
  segments_json: string | null;
  provider: string | null;
  usage_json: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  feed_url: string;
  title: string;
  author: string | null;
  image_url: string | null;
  description: string | null;
  created_at: string;
}

export interface EpisodeUserRow {
  user_id: string;
  episode_id: string;
  created_at: string;
  lesson_status: string | null;
  lesson_id: string | null;
  lesson_error: string | null;
  lesson_from: number | null;
  lesson_started_at: string | null;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The episode's id: the same for everyone (feed + guid), so a transcription is shared. */
export async function episodeIdFor(feedUrl: string, guid: string): Promise<string> {
  return `pe_${(await sha256Hex(`${feedUrl.trim()}\n${guid.trim()}`)).slice(0, 24)}`;
}

export function audioKeyFor(id: string, mime: string | null): string {
  const ext = /mp4|m4a|aac/i.test(mime ?? '') ? 'm4a' : /ogg|opus/i.test(mime ?? '') ? 'ogg' : 'mp3';
  return `${PODCAST_AUDIO_PREFIX}${id}.${ext}`;
}

export function parseSegments(raw: string | null): PodcastSegment[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as PodcastSegment[]) : [];
  } catch {
    return [];
  }
}

// ---------------- subscriptions

export async function listSubscriptions(db: D1Database, userId: string): Promise<SubscriptionRow[]> {
  const { results } = await db.prepare('SELECT * FROM podcast_subscriptions WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all<SubscriptionRow>();
  return results ?? [];
}

export async function upsertSubscription(db: D1Database, userId: string, feed: PodcastFeed): Promise<SubscriptionRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO podcast_subscriptions (id, user_id, feed_url, title, author, image_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, feed_url) DO UPDATE SET title = excluded.title, author = excluded.author, image_url = excluded.image_url, description = excluded.description`,
    )
    .bind(id, userId, feed.feed_url, feed.title, feed.author, feed.image_url, feed.description.slice(0, 600))
    .run();
  return (await db.prepare('SELECT * FROM podcast_subscriptions WHERE user_id = ? AND feed_url = ?').bind(userId, feed.feed_url).first<SubscriptionRow>())!;
}

export async function deleteSubscription(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM podcast_subscriptions WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

// ---------------- feed cache

export async function cachedFeed(db: D1Database, feedUrl: string): Promise<{ feed: PodcastFeed; fetched_at: string } | null> {
  const row = await db.prepare('SELECT feed_json, fetched_at FROM podcast_feed_cache WHERE feed_url = ?').bind(feedUrl).first<{ feed_json: string; fetched_at: string }>();
  if (!row) return null;
  try {
    return { feed: JSON.parse(row.feed_json) as PodcastFeed, fetched_at: row.fetched_at };
  } catch {
    return null;
  }
}

export async function storeFeed(db: D1Database, feed: PodcastFeed, now = new Date()): Promise<void> {
  await db
    .prepare('INSERT INTO podcast_feed_cache (feed_url, feed_json, fetched_at) VALUES (?, ?, ?) ON CONFLICT (feed_url) DO UPDATE SET feed_json = excluded.feed_json, fetched_at = excluded.fetched_at')
    .bind(feed.feed_url, JSON.stringify(feed), now.toISOString())
    .run();
}

// ---------------- episodes

export async function getEpisode(db: D1Database, id: string): Promise<EpisodeRow | null> {
  return (await db.prepare('SELECT * FROM podcast_episodes WHERE id = ?').bind(id).first<EpisodeRow>()) ?? null;
}

/** Status of these episode ids (the feed view's per-episode button). D1 caps bound params, so in chunks. */
export async function episodeStatuses(db: D1Database, ids: string[]): Promise<Map<string, Pick<EpisodeRow, 'id' | 'status' | 'progress' | 'progress_done' | 'progress_total' | 'error' | 'duration_ms'>>> {
  const out = new Map<string, Pick<EpisodeRow, 'id' | 'status' | 'progress' | 'progress_done' | 'progress_total' | 'error' | 'duration_ms'>>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await db
      .prepare(`SELECT id, status, progress, progress_done, progress_total, error, duration_ms FROM podcast_episodes WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<Pick<EpisodeRow, 'id' | 'status' | 'progress' | 'progress_done' | 'progress_total' | 'error' | 'duration_ms'>>();
    for (const r of results ?? []) out.set(r.id, r);
  }
  return out;
}

/** A new transcription row (queued), or null when one exists already. */
export async function insertEpisode(
  db: D1Database,
  id: string,
  feed: Pick<PodcastFeed, 'feed_url' | 'title' | 'image_url'>,
  ep: PodcastEpisodeInfo,
  userId: string,
  apiOrigin: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO podcast_episodes (id, feed_url, guid, enclosure_url, title, podcast_title, published_at, image_url, status, progress, api_origin, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'Waiting to start…', ?, ?)`,
    )
    .bind(id, feed.feed_url, ep.guid, ep.enclosure_url, ep.title, feed.title, ep.published_at, ep.image_url ?? feed.image_url, apiOrigin, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function updateEpisode(db: D1Database, id: string, fields: Partial<Omit<EpisodeRow, 'id'>>): Promise<void> {
  const keys = Object.keys(fields) as Array<keyof typeof fields>;
  if (!keys.length) return;
  await db
    .prepare(`UPDATE podcast_episodes SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => (fields[k] === undefined ? null : (fields[k] as unknown))), new Date().toISOString(), id)
    .run();
}

export async function linkEpisodeUser(db: D1Database, userId: string, episodeId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO podcast_episode_users (user_id, episode_id) VALUES (?, ?)').bind(userId, episodeId).run();
}

export async function getEpisodeUser(db: D1Database, userId: string, episodeId: string): Promise<EpisodeUserRow | null> {
  return (await db.prepare('SELECT * FROM podcast_episode_users WHERE user_id = ? AND episode_id = ?').bind(userId, episodeId).first<EpisodeUserRow>()) ?? null;
}

export async function updateEpisodeUser(db: D1Database, userId: string, episodeId: string, fields: Partial<Omit<EpisodeUserRow, 'user_id' | 'episode_id'>>): Promise<void> {
  const keys = Object.keys(fields) as Array<keyof typeof fields>;
  if (!keys.length) return;
  await db
    .prepare(`UPDATE podcast_episode_users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ? AND episode_id = ?`)
    .bind(...keys.map((k) => (fields[k] === undefined ? null : (fields[k] as unknown))), userId, episodeId)
    .run();
}

/** "My episodes": every episode this user asked for, newest first (no segments). */
export async function myEpisodes(db: D1Database, userId: string, limit = 50): Promise<Array<EpisodeRow & { linked_at: string }>> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.feed_url, e.guid, e.enclosure_url, e.title, e.podcast_title, e.published_at, e.image_url, e.status, e.progress,
              e.progress_done, e.progress_total, e.error, e.attempts, e.audio_key, e.audio_bytes, e.audio_mime, e.duration_ms,
              NULL AS stt_job_id, NULL AS stt_started_at, NULL AS api_origin, NULL AS segments_json, e.provider, NULL AS usage_json,
              NULL AS requested_by, e.created_at, e.updated_at, e.finished_at, u.created_at AS linked_at
       FROM podcast_episode_users u JOIN podcast_episodes e ON e.id = u.episode_id
       WHERE u.user_id = ? ORDER BY u.created_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<EpisodeRow & { linked_at: string }>();
  return results ?? [];
}
