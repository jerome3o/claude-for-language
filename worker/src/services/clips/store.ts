/**
 * 🎬 Clips (experimental, docs/CLIPS.md): the `clips` / `clip_events` rows, the feed and the
 * learner context the feed ranking and the generator read. Every query is scoped to the owner.
 */
import {
  CLIP_EVENT_KINDS,
  clipImagePrompts,
  likedTagsOf,
  parseStoredClipSpec,
  rankClipFeed,
  type ClipEventKind,
  type ClipLessonState,
  type ClipRecord,
  type ClipSource,
  type ClipSpec,
  type ClipStatus,
  type ClipTheme,
  type ClipUserState,
} from '@shared/clips';
import { lessonImageHash } from '../lesson-images';

export interface ClipRow {
  id: string;
  user_id: string;
  status: string;
  source: string;
  title: string | null;
  topic: string | null;
  theme: string | null;
  spec: string | null;
  request: string | null;
  progress: string | null;
  error: string | null;
  attempts: number;
  lesson_status: string | null;
  lesson_id: string | null;
  lesson_error: string | null;
  lesson_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A generating clip not touched for this long is reported failed. */
export const CLIP_STALE_MINUTES = 15;
/** The feed returns at most this many clips. */
export const CLIP_FEED_LIMIT = 80;
/** Events per upload. */
export const MAX_CLIP_EVENTS = 200;

const EMPTY_STATE: ClipUserState = { viewed: false, completed: false, liked: false, saved: false, skips: 0 };

export async function sweepStaleClips(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE clips SET status = 'failed', error = 'Writing this clip stopped — try again.', updated_at = datetime('now') WHERE user_id = ? AND status = 'generating' AND updated_at < datetime('now', '-${CLIP_STALE_MINUTES} minutes')`)
    .bind(userId)
    .run();
  await db
    .prepare(`UPDATE clips SET lesson_status = 'failed', lesson_error = 'Writing the lesson stopped — try again.' WHERE user_id = ? AND lesson_status = 'generating' AND lesson_updated_at < datetime('now', '-${CLIP_STALE_MINUTES} minutes')`)
    .bind(userId)
    .run();
}

/** The learner's state per clip, from their events (latest like/unlike and save/unsave win). */
export async function clipStates(db: D1Database, userId: string, clipIds?: string[]): Promise<Map<string, ClipUserState>> {
  const where = clipIds?.length ? ` AND clip_id IN (${clipIds.map(() => '?').join(',')})` : '';
  const rows = await db
    .prepare(`SELECT clip_id, kind, created_at, id FROM clip_events WHERE user_id = ?${where} AND kind IN ('view','complete','like','unlike','save','unsave','skip') ORDER BY created_at, id`)
    .bind(userId, ...(clipIds ?? []))
    .all<{ clip_id: string; kind: string }>();
  const out = new Map<string, ClipUserState>();
  for (const r of rows.results ?? []) {
    const s = out.get(r.clip_id) ?? { ...EMPTY_STATE };
    if (r.kind === 'view') s.viewed = true;
    else if (r.kind === 'complete') s.viewed = s.completed = true;
    else if (r.kind === 'like') s.liked = true;
    else if (r.kind === 'unlike') s.liked = false;
    else if (r.kind === 'save') s.saved = true;
    else if (r.kind === 'unsave') s.saved = false;
    else if (r.kind === 'skip') s.skips++;
    out.set(r.clip_id, s);
  }
  return out;
}

/** Ready pictures of these prompts (lesson_images rows), prompt → R2 key. */
export async function readyImages(db: D1Database, prompts: string[]): Promise<Record<string, string>> {
  if (prompts.length === 0) return {};
  const hashes = await Promise.all(prompts.map((p) => lessonImageHash(p)));
  const rows = await db
    .prepare(`SELECT prompt_hash, image_key FROM lesson_images WHERE status = 'ready' AND image_key IS NOT NULL AND prompt_hash IN (${hashes.map(() => '?').join(',')})`)
    .bind(...hashes)
    .all<{ prompt_hash: string; image_key: string }>();
  const byHash = new Map((rows.results ?? []).map((r) => [r.prompt_hash, r.image_key]));
  const out: Record<string, string> = {};
  prompts.forEach((p, i) => {
    const key = byHash.get(hashes[i]);
    if (key) out[p] = key;
  });
  return out;
}

function lessonOf(row: ClipRow): ClipLessonState | null {
  if (!row.lesson_status) return null;
  return { status: row.lesson_status as ClipLessonState['status'], lesson_id: row.lesson_id, error: row.lesson_status === 'failed' ? row.lesson_error || 'The lesson couldn’t be written.' : null };
}

export function rowToClip(row: ClipRow, state: ClipUserState | undefined, images: Record<string, string>): ClipRecord {
  const spec = row.status === 'ready' ? parseStoredClipSpec(row.spec) : null;
  const status = (row.status === 'ready' && !spec ? 'failed' : row.status) as ClipStatus;
  return {
    id: row.id,
    status,
    source: row.source as ClipSource,
    title: spec?.title ?? row.title,
    topic: row.topic,
    theme: (spec?.style.theme ?? row.theme) as ClipTheme | null,
    spec,
    images,
    progress: status === 'generating' ? row.progress : null,
    error: status === 'failed' ? row.error || 'This clip couldn’t be made.' : null,
    created_at: row.created_at,
    state: state ?? { ...EMPTY_STATE },
    lesson: lessonOf(row),
  };
}

async function imagesFor(db: D1Database, rows: ClipRow[]): Promise<Map<string, Record<string, string>>> {
  const prompts = new Map<string, string[]>();
  for (const r of rows) {
    const spec = r.status === 'ready' ? parseStoredClipSpec(r.spec) : null;
    if (spec) prompts.set(r.id, clipImagePrompts(spec));
  }
  const all = [...new Set([...prompts.values()].flat())];
  const found: Record<string, string> = {};
  for (let i = 0; i < all.length; i += 50) Object.assign(found, await readyImages(db, all.slice(i, i + 50)));
  const out = new Map<string, Record<string, string>>();
  for (const [id, ps] of prompts) out.set(id, Object.fromEntries(ps.filter((p) => found[p]).map((p) => [p, found[p]])));
  return out;
}

/** What the learner is studying / struggling with lately (feed ranking + the generator's brief). */
export interface LearnerContext {
  studying: Array<{ hanzi: string; pinyin: string; english: string }>;
  struggling: Array<{ hanzi: string; pinyin: string; english: string }>;
  decks: string[];
}

export async function learnerContext(db: D1Database, userId: string, nowMs = Date.now()): Promise<LearnerContext> {
  const since = new Date(nowMs - 14 * 86_400_000).toISOString();
  const recent = await db
    .prepare(
      `SELECT n.hanzi, n.pinyin, n.english, MAX(re.reviewed_at) AS last, SUM(CASE WHEN re.rating <= 1 THEN 1 ELSE 0 END) AS misses
         FROM review_events re JOIN cards c ON c.id = re.card_id JOIN notes n ON n.id = c.note_id
        WHERE re.user_id = ? AND re.reviewed_at >= ?
        GROUP BY n.id ORDER BY last DESC LIMIT 120`,
    )
    .bind(userId, since)
    .all<{ hanzi: string; pinyin: string; english: string; misses: number }>();
  const rows = recent.results ?? [];
  const decks = await db
    .prepare(`SELECT name FROM decks WHERE user_id = ? ORDER BY created_at DESC LIMIT 4`)
    .bind(userId)
    .all<{ name: string }>();
  const pick = (r: { hanzi: string; pinyin: string; english: string }) => ({ hanzi: r.hanzi, pinyin: r.pinyin, english: r.english });
  return {
    studying: rows.map(pick),
    struggling: rows.filter((r) => Number(r.misses) > 0).sort((a, b) => Number(b.misses) - Number(a.misses)).slice(0, 20).map(pick),
    decks: (decks.results ?? []).map((d) => d.name),
  };
}

/** The feed: the owner's clips (ready ones ranked; generating / failed ones first so they show their state). */
export async function listClipFeed(db: D1Database, userId: string, opts: { context?: LearnerContext } = {}): Promise<ClipRecord[]> {
  await sweepStaleClips(db, userId);
  const rows = (await db.prepare(`SELECT * FROM clips WHERE user_id = ? ORDER BY created_at DESC, id LIMIT ?`).bind(userId, CLIP_FEED_LIMIT).all<ClipRow>()).results ?? [];
  const [states, images] = await Promise.all([clipStates(db, userId), imagesFor(db, rows)]);
  const records = rows.map((r) => rowToClip(r, states.get(r.id), images.get(r.id) ?? {}));
  const ready = records.filter((r) => r.status === 'ready' && r.spec);
  const other = records.filter((r) => !(r.status === 'ready' && r.spec));
  const ctx = opts.context ?? (await learnerContext(db, userId));
  const rankable = ready.map((r) => ({ ...r, words: r.spec!.words.map((w) => w.hanzi), tags: r.spec!.tags ?? [], topic: r.topic ?? r.spec!.topic ?? null }));
  const ranked = rankClipFeed(rankable, {
    studying: new Set(ctx.studying.map((w) => w.hanzi)),
    struggling: new Set(ctx.struggling.map((w) => w.hanzi)),
    likedTags: likedTagsOf(rankable),
  });
  return [...other, ...ranked.map(({ words: _w, tags: _t, ...r }) => r as ClipRecord)];
}

export async function getClipRow(db: D1Database, userId: string, id: string): Promise<ClipRow | null> {
  return db.prepare('SELECT * FROM clips WHERE id = ? AND user_id = ?').bind(id, userId).first<ClipRow>();
}

export async function getClip(db: D1Database, userId: string, id: string): Promise<ClipRecord | null> {
  await sweepStaleClips(db, userId);
  const row = await getClipRow(db, userId, id);
  if (!row) return null;
  const [states, images] = await Promise.all([clipStates(db, userId, [id]), imagesFor(db, [row])]);
  return rowToClip(row, states.get(id), images.get(id) ?? {});
}

/** Store a validated spec as a ready clip. */
export async function insertReadyClip(db: D1Database, userId: string, spec: ClipSpec, source: ClipSource, id: string = crypto.randomUUID()): Promise<string> {
  await db
    .prepare(`INSERT INTO clips (id, user_id, status, source, title, topic, theme, spec) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?)`)
    .bind(id, userId, source, spec.title, spec.topic ?? null, spec.style.theme, JSON.stringify(spec))
    .run();
  return id;
}

export async function deleteClip(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM clips WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if ((res.meta?.changes ?? 0) === 0) return false;
  await db.prepare('DELETE FROM clip_events WHERE clip_id = ? AND user_id = ?').bind(id, userId).run();
  return true;
}

export interface RecordEventsResult {
  accepted: number;
  stored: number;
  rejected: number;
}

/** Store a device's events (idempotent by id; only the caller's own clips). */
export async function recordClipEvents(db: D1Database, userId: string, events: unknown[]): Promise<RecordEventsResult> {
  const out: RecordEventsResult = { accepted: 0, stored: 0, rejected: 0 };
  const clean: Array<{ id: string; clip_id: string; kind: ClipEventKind; value: number | null; created_at: string }> = [];
  for (const raw of events) {
    const e = raw as Record<string, unknown>;
    const id = typeof e?.id === 'string' ? e.id.slice(0, 80) : '';
    const clipId = typeof e?.clip_id === 'string' ? e.clip_id : '';
    const kind = e?.kind as ClipEventKind;
    if (!id || !clipId || !(CLIP_EVENT_KINDS as readonly string[]).includes(kind)) {
      out.rejected++;
      continue;
    }
    const created = typeof e.created_at === 'string' && !Number.isNaN(Date.parse(e.created_at)) ? new Date(e.created_at).toISOString() : new Date().toISOString();
    const value = typeof e.value === 'number' && Number.isFinite(e.value) ? Math.round(e.value) : null;
    clean.push({ id, clip_id: clipId, kind, value, created_at: created });
  }
  if (clean.length === 0) return out;
  const ids = [...new Set(clean.map((c) => c.clip_id))];
  const owned = new Set(
    ((await db.prepare(`SELECT id FROM clips WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(userId, ...ids).all<{ id: string }>()).results ?? []).map((r) => r.id),
  );
  const stmts: D1PreparedStatement[] = [];
  for (const c of clean) {
    if (!owned.has(c.clip_id)) {
      out.rejected++;
      continue;
    }
    out.accepted++;
    stmts.push(db.prepare(`INSERT OR IGNORE INTO clip_events (id, user_id, clip_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(c.id, userId, c.clip_id, c.kind, c.value, c.created_at));
  }
  if (stmts.length) {
    const res = await db.batch(stmts);
    out.stored = res.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0);
  }
  return out;
}
