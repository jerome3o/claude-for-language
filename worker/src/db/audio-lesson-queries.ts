/**
 * SQL for audio lessons (migrations 0046 + 0111; docs/AUDIO_LESSONS.md). Rows
 * are per user. Rows from the first, removed attempt have `format` NULL and are
 * never listed.
 */
import type {
  AudioLessonChapter,
  AudioLessonDetail,
  AudioLessonFormat,
  AudioLessonInput,
  AudioLessonStatus,
  AudioLessonSummary,
  AudioLessonTranscriptLine,
  AudioLessonUsage,
  AudioLessonScript,
  LessonWord,
  StoryPlan,
} from '@shared/audio-lesson';
import { storyCutNotice } from '@shared/audio-lesson/story';
import { parseVoiceGender } from '@shared/chats/voice';

export interface AudioLessonRow {
  id: string;
  user_id: string;
  title: string;
  format: AudioLessonFormat;
  status: AudioLessonStatus;
  input_json: string | null;
  progress: string | null;
  progress_done: number | null;
  progress_total: number | null;
  error: string | null;
  agent_transcript: string | null;
  rounds: number;
  plan_json: string | null;
  script_json: string | null;
  timeline_json: string | null;
  words_json: string | null;
  audio_key: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  usage_json: string | null;
  zh_provider: string | null;
  for_relationship_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
}

/** R2: `audio-lessons/<user>/<lesson>-<version>.mp3`, parts under `audio-lessons/<user>/<lesson>/parts/`. */
export const AUDIO_LESSON_PREFIX = 'audio-lessons/';

export function audioLessonFileKey(userId: string, lessonId: string, version: string): string {
  return `${AUDIO_LESSON_PREFIX}${userId}/${lessonId}-${version}.mp3`;
}

export function audioLessonPartsPrefix(userId: string, lessonId: string): string {
  return `${AUDIO_LESSON_PREFIX}${userId}/${lessonId}/parts/`;
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** The file's version: the part of its key after the lesson id. */
export function audioVersion(row: Pick<AudioLessonRow, 'audio_key' | 'id'>): string | null {
  if (!row.audio_key) return null;
  const m = row.audio_key.match(/-([A-Za-z0-9]+)\.mp3$/);
  return m ? m[1] : row.audio_key;
}

export function lessonSummary(row: AudioLessonRow): AudioLessonSummary {
  const words = parse<LessonWord[]>(row.words_json, []);
  return {
    id: row.id,
    format: row.format,
    title: row.title,
    status: row.status,
    progress: row.progress,
    progress_done: row.progress_done,
    progress_total: row.progress_total,
    error: row.error,
    duration_ms: row.duration_ms,
    size_bytes: row.size_bytes,
    word_count: words.length,
    audio_version: row.status === 'ready' ? audioVersion(row) : null,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

/** A story lesson's "the text was cut" line, from its plan. */
function storyNotice(planJson: string | null): string | null {
  const cut = parse<StoryPlan | null>(planJson, null)?.cut;
  return cut ? storyCutNotice(cut) : null;
}

export function lessonDetail(row: AudioLessonRow): AudioLessonDetail {
  const timeline = parse<{ chapters: AudioLessonChapter[]; transcript: AudioLessonTranscriptLine[] }>(row.timeline_json, { chapters: [], transcript: [] });
  const script = parse<AudioLessonScript | null>(row.script_json, null);
  return {
    ...lessonSummary(row),
    input: parse<AudioLessonInput>(row.input_json, {}),
    words: parse<LessonWord[]>(row.words_json, []),
    chapters: timeline.chapters,
    transcript: timeline.transcript,
    speakers: script?.speakers ?? [],
    usage: parse<AudioLessonUsage | null>(row.usage_json, null),
    for_relationship_id: row.for_relationship_id,
    ...(row.format === 'story' ? { notice: storyNotice(row.plan_json) } : {}),
  };
}

export async function createAudioLesson(
  db: D1Database,
  input: { id?: string; userId: string; format: AudioLessonFormat; title: string; input: AudioLessonInput; forRelationshipId?: string | null },
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO audio_lessons (id, user_id, title, format, status, input_json, progress, rounds, for_relationship_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, 'Waiting to start', 0, ?, ?, ?)`,
    )
    .bind(id, input.userId, input.title, input.format, JSON.stringify(input.input), input.forRelationshipId ?? null, now, now)
    .run();
  return id;
}

const COLUMNS = `id, user_id, title, format, status, input_json, progress, progress_done, progress_total, error, agent_transcript, rounds,
  plan_json, script_json, timeline_json, words_json, audio_key, duration_ms, size_bytes, usage_json, zh_provider, for_relationship_id,
  created_at, started_at, finished_at, updated_at`;

export async function getAudioLesson(db: D1Database, id: string, userId?: string): Promise<AudioLessonRow | null> {
  const row = userId
    ? await db.prepare(`SELECT ${COLUMNS} FROM audio_lessons WHERE id = ? AND user_id = ? AND format IS NOT NULL`).bind(id, userId).first<AudioLessonRow>()
    : await db.prepare(`SELECT ${COLUMNS} FROM audio_lessons WHERE id = ? AND format IS NOT NULL`).bind(id).first<AudioLessonRow>();
  return row ?? null;
}

/** Newest first, without the big JSON columns. */
export async function listAudioLessons(db: D1Database, userId: string, limit = 100): Promise<AudioLessonRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, user_id, title, format, status, NULL AS input_json, progress, progress_done, progress_total, error, NULL AS agent_transcript, rounds,
         NULL AS plan_json, NULL AS script_json, NULL AS timeline_json, words_json, audio_key, duration_ms, size_bytes, NULL AS usage_json, zh_provider,
         for_relationship_id, created_at, started_at, finished_at, updated_at
       FROM audio_lessons WHERE user_id = ? AND format IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<AudioLessonRow>();
  return rows.results ?? [];
}

/** Ready lessons with their file, newest first — the podcast feed's episodes (routes/podcast.ts). */
export async function listReadyAudioLessons(db: D1Database, userId: string, limit = 200): Promise<AudioLessonRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, title, format, status, NULL AS input_json, NULL AS progress, NULL AS progress_done, NULL AS progress_total, NULL AS error,
         NULL AS agent_transcript, rounds, NULL AS plan_json, NULL AS script_json, timeline_json, words_json, audio_key, duration_ms, size_bytes,
         NULL AS usage_json, zh_provider, for_relationship_id, created_at, started_at, finished_at, updated_at
       FROM audio_lessons WHERE user_id = ? AND format IS NOT NULL AND status = 'ready' AND audio_key IS NOT NULL
       ORDER BY COALESCE(finished_at, created_at) DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<AudioLessonRow>();
  return results ?? [];
}

export async function countActiveAudioLessons(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM audio_lessons WHERE user_id = ? AND format IS NOT NULL AND status NOT IN ('ready', 'failed')`)
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export type AudioLessonPatch = Partial<{
  title: string;
  status: AudioLessonStatus;
  progress: string | null;
  progress_done: number | null;
  progress_total: number | null;
  error: string | null;
  agent_transcript: unknown[] | null;
  rounds: number;
  plan_json: unknown;
  script_json: unknown;
  timeline_json: unknown;
  words_json: unknown;
  audio_key: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  usage_json: unknown;
  zh_provider: string | null;
  started_at: string | null;
  finished_at: string | null;
}>;

const JSON_COLUMNS = new Set(['agent_transcript', 'plan_json', 'script_json', 'timeline_json', 'words_json', 'usage_json']);

export async function patchAudioLesson(db: D1Database, id: string, patch: AudioLessonPatch): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    values.push(JSON_COLUMNS.has(k) && v !== null ? JSON.stringify(v) : v);
  }
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  await db.prepare(`UPDATE audio_lessons SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
}

/** Back to the start for a Retry: keeps what was already written (plan / script) so nothing is paid for twice. */
export async function resetAudioLessonForRetry(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE audio_lessons SET status = 'queued', error = NULL, progress = 'Waiting to start', finished_at = NULL,
         rounds = CASE WHEN script_json IS NULL THEN 0 ELSE rounds END,
         agent_transcript = CASE WHEN script_json IS NULL THEN NULL ELSE agent_transcript END,
         updated_at = ? WHERE id = ?`,
    )
    .bind(new Date().toISOString(), id)
    .run();
}

export async function deleteAudioLessonRow(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM audio_lessons WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

/**
 * A build nobody has touched for this long is stuck (a consumer torn down, a
 * message lost): marked failed so Retry is offered. Waiting on a rate limit
 * still touches the row (the job re-enqueues itself and writes progress).
 */
export const STALE_AUDIO_LESSON_MS = 45 * 60 * 1000;

export async function markStaleAudioLessons(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  const cutoff = new Date(now - STALE_AUDIO_LESSON_MS).toISOString();
  await db
    .prepare(
      `UPDATE audio_lessons SET status = 'failed', error = 'Stopped making progress — press Retry to pick up where it left off', finished_at = ?
       WHERE user_id = ? AND format IS NOT NULL AND status NOT IN ('ready', 'failed') AND COALESCE(updated_at, created_at) < ?`,
    )
    .bind(new Date(now).toISOString(), userId, cutoff)
    .run();
}

// ---------- The learner's vocabulary (what the agent knows about them) ----------

export interface VocabRow {
  hanzi: string;
  pinyin: string;
  english: string;
  /** 2 = known (a mature card: Review, stability > 21 d), 1 = learning (reviewed), 0 = in a deck, never reviewed. */
  tier: number;
}

/**
 * The learner's voice gender for a dialogue lesson's own part (Profile → "Your voice when your
 * messages are read aloud", users.voice_gender): male / female; null for other / not set.
 */
export async function learnerVoiceGender(db: D1Database, userId: string): Promise<'male' | 'female' | null> {
  const row = await db.prepare('SELECT voice_gender FROM users WHERE id = ?').bind(userId).first<{ voice_gender: string | null }>();
  const g = parseVoiceGender(row?.voice_gender);
  return g === 'male' || g === 'female' ? g : null;
}

/**
 * Every note of the learner's with its best card's tier — the server's cached
 * card state, as `services/known-counts.ts` reads it (shared/progress/known.ts
 * definitions). Best tier per spelling.
 */
export async function learnerVocabulary(db: D1Database, userId: string): Promise<VocabRow[]> {
  const rows = await db
    .prepare(
      `SELECT n.hanzi AS hanzi, MAX(n.pinyin) AS pinyin, MAX(n.english) AS english,
         MAX(CASE WHEN c.queue = 2 AND c.stability > 21 THEN 2 WHEN c.queue != 0 THEN 1 ELSE 0 END) AS tier
       FROM notes n
       JOIN decks d ON d.id = n.deck_id
       JOIN cards c ON c.note_id = n.id
       WHERE d.user_id = ?
       GROUP BY n.hanzi`,
    )
    .bind(userId)
    .all<VocabRow>();
  return rows.results ?? [];
}
