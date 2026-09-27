/**
 * Lesson illustrations: the picture of a describe_image exercise.
 *
 * One picture per scene description. The R2 key is derived from a hash of the
 * (whitespace-normalised) image_prompt — `lesson-images/<hash>.<ext>` — and the
 * `lesson_images` table (migration 0078) says whether it exists yet. So:
 *
 *   - a tutor's library item, every student's copy of it, a push-update and the
 *     catalogue sample with the same prompt all share ONE generated picture;
 *   - generating is idempotent: `ensureLessonImages` queues a prompt at most once
 *     while it is pending, and a ready picture is simply handed back;
 *   - when a picture is made, `applyLessonImageEverywhere` writes its key into
 *     every custom_lessons row whose describe_image exercise has that prompt and
 *     no picture yet — matched by prompt, never by section/exercise index, so an
 *     edit made while the picture was being drawn can't put it on the wrong
 *     exercise. The client's next lesson sync carries it to the device.
 *
 * Library items never store image_url (lessonToExportSpec strips it); their
 * editor preview asks for the picture by prompt (POST /api/lesson-images/ensure).
 */

import type { CustomLessonSpec } from '@shared/lesson';
import { normalizeImagePrompt, describeImagePrompts, applyImageToSpec } from '@shared/lesson/images';
import { SAMPLE_LESSONS } from '@shared/lesson/samples';
import type { Env } from '../types';

export { normalizeImagePrompt, describeImagePrompts, applyImageToSpec };

export const LESSON_IMAGE_PREFIX = 'lesson-images';
/** Generation attempts before a prompt is marked failed. */
export const MAX_IMAGE_ATTEMPTS = 3;
/** A pending row older than this is taken as lost (queue message dropped) and re-queued. */
export const PENDING_STALE_MS = 15 * 60 * 1000;
/** A failed prompt is tried again (attempts reset) after this long. */
export const FAILED_RETRY_MS = 24 * 60 * 60 * 1000;
/** Longest prompt the ensure endpoint accepts (the lesson validator's own cap is lower). */
export const MAX_PROMPT_CHARS = 2000;

/** missing = not drawn and not queued (only from a lookup with queue: false). */
export type LessonImageStatus = 'ready' | 'pending' | 'failed' | 'unavailable' | 'missing';

export interface LessonImageRow {
  prompt_hash: string;
  prompt: string;
  status: 'pending' | 'ready' | 'failed';
  image_key: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonImageResult {
  prompt: string;
  status: LessonImageStatus;
  /** The R2 key (served by GET /api/audio/<key>) when status is ready. */
  image_url: string | null;
}

/** Queue message on image-generation-queue (alongside reader-page messages). */
export interface LessonImageMessage {
  kind: 'lesson_image';
  hash: string;
  prompt: string;
}

// ============ Pure helpers ============

/** Stable id of a scene description: first 32 hex chars of SHA-256 of the normalised prompt. */
export async function lessonImageHash(prompt: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeImagePrompt(prompt));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** What to do for a prompt given its row: hand back, wait, (re)queue, or report failure. */
export function decideEnsure(row: Pick<LessonImageRow, 'status' | 'image_key' | 'updated_at'> | null, nowMs: number): 'ready' | 'pending' | 'queue' | 'failed' {
  if (!row) return 'queue';
  const age = nowMs - parseDbTime(row.updated_at);
  if (row.status === 'ready' && row.image_key) return 'ready';
  if (row.status === 'pending') return age > PENDING_STALE_MS ? 'queue' : 'pending';
  if (row.status === 'failed') return age > FAILED_RETRY_MS ? 'queue' : 'failed';
  return 'queue';
}

/** D1's datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC. */
export function parseDbTime(value: string): number {
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Every describe_image prompt of the bundled catalogue samples. */
export function sampleImagePrompts(): string[] {
  return SAMPLE_LESSONS.flatMap(s => describeImagePrompts(s.spec));
}

// ============ Store ============

async function getRows(db: D1Database, hashes: string[]): Promise<Map<string, LessonImageRow>> {
  const out = new Map<string, LessonImageRow>();
  for (let i = 0; i < hashes.length; i += 50) {
    const chunk = hashes.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT * FROM lesson_images WHERE prompt_hash IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<LessonImageRow>();
    for (const r of results ?? []) out.set(r.prompt_hash, r);
  }
  return out;
}

async function markPending(db: D1Database, hash: string, prompt: string): Promise<void> {
  await db.prepare(`
    INSERT INTO lesson_images (prompt_hash, prompt, status, attempts, updated_at)
    VALUES (?, ?, 'pending', 0, datetime('now'))
    ON CONFLICT(prompt_hash) DO UPDATE SET
      status = 'pending',
      error = NULL,
      attempts = CASE WHEN lesson_images.status = 'failed' THEN 0 ELSE lesson_images.attempts END,
      updated_at = datetime('now')
  `).bind(hash, normalizeImagePrompt(prompt)).run();
}

// ============ Ensure (the one entry point) ============

type ImageEnv = Pick<Env, 'DB' | 'IMAGE_QUEUE' | 'GEMINI_API_KEY'>;

/**
 * For each prompt: its picture if ready, else make sure it is being drawn.
 * Queues only prompts with no row, a lost pending row or a day-old failure.
 * Without an image generator configured, anything not already drawn is
 * 'unavailable' (the exercise falls back to the scene text).
 */
export async function ensureLessonImages(
  env: ImageEnv,
  prompts: string[],
  opts: { queue?: boolean; nowMs?: number } = {},
): Promise<LessonImageResult[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const mayQueue = opts.queue !== false;
  const cleaned = prompts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map(p => p.slice(0, MAX_PROMPT_CHARS));
  if (cleaned.length === 0) return [];
  const hashes = await Promise.all(cleaned.map(lessonImageHash));
  const rows = await getRows(env.DB, [...new Set(hashes)]);
  const canGenerate = Boolean(env.GEMINI_API_KEY && env.IMAGE_QUEUE);
  const queuedNow = new Set<string>();
  const results: LessonImageResult[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const prompt = cleaned[i];
    const hash = hashes[i];
    const row = rows.get(hash) ?? null;
    const decision = queuedNow.has(hash) ? 'pending' : decideEnsure(row, nowMs);
    if (decision === 'ready') {
      results.push({ prompt, status: 'ready', image_url: row!.image_key });
    } else if (!canGenerate) {
      results.push({ prompt, status: 'unavailable', image_url: null });
    } else if (decision === 'queue' && !mayQueue) {
      results.push({ prompt, status: row?.status === 'failed' ? 'failed' : 'missing', image_url: null });
    } else if (decision === 'queue') {
      await markPending(env.DB, hash, prompt);
      await env.IMAGE_QUEUE.send({ kind: 'lesson_image', hash, prompt: normalizeImagePrompt(prompt) });
      queuedNow.add(hash);
      results.push({ prompt, status: 'pending', image_url: null });
    } else {
      results.push({ prompt, status: decision, image_url: null });
    }
  }
  return results;
}

// ============ Writing pictures into lessons ============

async function applyToLessonRow(db: D1Database, id: string, spec: string, prompt: string, key: string): Promise<boolean> {
  let parsed: CustomLessonSpec;
  try {
    parsed = JSON.parse(spec) as CustomLessonSpec;
  } catch {
    return false;
  }
  if (applyImageToSpec(parsed, prompt, key) === 0) return false;
  // Compare-and-set on the spec text: a concurrent edit wins, and the next
  // ensure / top-up applies the picture to the edited spec.
  const res = await db
    .prepare(`UPDATE custom_lessons SET spec = ?, updated_at = datetime('now') WHERE id = ? AND spec = ?`)
    .bind(JSON.stringify(parsed), id, spec)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Write a ready picture into one lesson (just created / assigned / pushed). */
export async function applyLessonImageToLesson(db: D1Database, lessonId: string, prompt: string, key: string): Promise<boolean> {
  const row = await db.prepare('SELECT id, spec FROM custom_lessons WHERE id = ?').bind(lessonId).first<{ id: string; spec: string }>();
  return row ? applyToLessonRow(db, row.id, row.spec, prompt, key) : false;
}

/** Write a ready picture into every lesson (any user) still waiting for it. Returns rows updated. */
export async function applyLessonImageEverywhere(db: D1Database, prompt: string, key: string): Promise<number> {
  const { results } = await db
    .prepare(`SELECT id, spec FROM custom_lessons WHERE instr(spec, '"describe_image"') > 0 AND instr(spec, '"image_prompt"') > 0`)
    .all<{ id: string; spec: string }>();
  let updated = 0;
  for (const row of results ?? []) {
    if (await applyToLessonRow(db, row.id, row.spec, prompt, key)) updated++;
  }
  return updated;
}

/**
 * The lesson-side entry point every create / assign / update / push path
 * calls after writing the row: pictures that already exist go straight in,
 * the rest are queued. Returns how many are still being drawn.
 */
export async function queueLessonImages(env: ImageEnv, lessonId: string, spec: CustomLessonSpec): Promise<number> {
  const prompts = describeImagePrompts(spec, true);
  if (prompts.length === 0) return 0;
  const results = await ensureLessonImages(env, prompts);
  let pending = 0;
  for (const r of results) {
    if (r.status === 'ready' && r.image_url) await applyLessonImageToLesson(env.DB, lessonId, r.prompt, r.image_url);
    else if (r.status === 'pending') pending++;
  }
  return pending;
}

/**
 * Start drawing a library item's pictures (it never stores image_url itself):
 * the tutor's preview and every copy assigned later find them ready. Never
 * throws — a library save must not fail over a picture.
 */
export async function prewarmLessonImages(env: ImageEnv, spec: CustomLessonSpec): Promise<void> {
  try {
    const prompts = describeImagePrompts(spec);
    if (prompts.length > 0) await ensureLessonImages(env, prompts);
  } catch (err) {
    console.warn('[lesson-images] prewarm failed:', err);
  }
}

// ============ Queue consumer ============

export type GenerateImage = (prompt: string, fileId: string) => Promise<string | null>;

export type LessonImageOutcome =
  | { action: 'ack'; status: 'ready' | 'failed'; key?: string; applied?: number }
  | { action: 'retry'; delaySeconds: number };

/**
 * Draw one picture. Already drawn (a duplicate message) → just apply it.
 * A failed attempt is retried with a growing delay; after MAX_IMAGE_ATTEMPTS
 * the row is 'failed' (the client shows "couldn't draw") and ensure tries
 * again after a day.
 */
export async function handleLessonImageMessage(
  env: Pick<Env, 'DB'>,
  msg: LessonImageMessage,
  generate: GenerateImage,
): Promise<LessonImageOutcome> {
  const existing = await env.DB.prepare('SELECT * FROM lesson_images WHERE prompt_hash = ?').bind(msg.hash).first<LessonImageRow>();
  if (existing?.status === 'ready' && existing.image_key) {
    const applied = await applyLessonImageEverywhere(env.DB, existing.prompt, existing.image_key);
    return { action: 'ack', status: 'ready', key: existing.image_key, applied };
  }

  let key: string | null = null;
  let error = 'The image generator returned no picture';
  try {
    key = await generate(msg.prompt, msg.hash);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (key) {
    await env.DB.prepare(`
      INSERT INTO lesson_images (prompt_hash, prompt, status, image_key, attempts, updated_at)
      VALUES (?, ?, 'ready', ?, 1, datetime('now'))
      ON CONFLICT(prompt_hash) DO UPDATE SET status = 'ready', image_key = excluded.image_key, error = NULL,
        attempts = lesson_images.attempts + 1, updated_at = datetime('now')
    `).bind(msg.hash, msg.prompt, key).run();
    const applied = await applyLessonImageEverywhere(env.DB, msg.prompt, key);
    return { action: 'ack', status: 'ready', key, applied };
  }

  const attempts = (existing?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_IMAGE_ATTEMPTS;
  await env.DB.prepare(`
    INSERT INTO lesson_images (prompt_hash, prompt, status, attempts, error, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(prompt_hash) DO UPDATE SET status = excluded.status, attempts = excluded.attempts,
      error = excluded.error, updated_at = datetime('now')
  `).bind(msg.hash, msg.prompt, failed ? 'failed' : 'pending', attempts, error.slice(0, 500)).run();
  return failed ? { action: 'ack', status: 'failed' } : { action: 'retry', delaySeconds: 60 * attempts };
}

// ============ Backfill / top-up ============

export interface TopUpResult {
  lessons_checked: number;
  prompts: number;
  applied: number;
  pending: number;
  failed: number;
  unavailable: number;
}

/**
 * Bring pictures up to date: every describe_image exercise without a picture
 * (the user's lessons, or everyone's when userId is null) gets its ready
 * picture written in or its generation queued, and the user's library items
 * and the catalogue samples are pre-drawn so previews show a picture. Safe to
 * call repeatedly — the sync calls it (throttled) and the admin backfill
 * calls it for everyone.
 */
export async function topUpLessonImages(env: ImageEnv, userId: string | null): Promise<TopUpResult> {
  const lessonRows = userId
    ? (await env.DB.prepare(`SELECT id, spec FROM custom_lessons WHERE user_id = ? AND instr(spec, '"describe_image"') > 0`).bind(userId).all<{ id: string; spec: string }>()).results ?? []
    : (await env.DB.prepare(`SELECT id, spec FROM custom_lessons WHERE instr(spec, '"describe_image"') > 0`).all<{ id: string; spec: string }>()).results ?? [];
  const libraryRows = userId
    ? (await env.DB.prepare(`SELECT spec FROM lesson_library WHERE owner_id = ? AND archived_at IS NULL AND instr(spec, '"describe_image"') > 0`).bind(userId).all<{ spec: string }>()).results ?? []
    : (await env.DB.prepare(`SELECT spec FROM lesson_library WHERE archived_at IS NULL AND instr(spec, '"describe_image"') > 0`).all<{ spec: string }>()).results ?? [];

  const byNorm = new Map<string, string>();
  const add = (p: string) => { const n = normalizeImagePrompt(p); if (!byNorm.has(n)) byNorm.set(n, p); };
  const lessonsMissing: Array<{ id: string; prompts: string[] }> = [];
  for (const row of lessonRows) {
    try {
      const prompts = describeImagePrompts(JSON.parse(row.spec) as CustomLessonSpec, true);
      if (prompts.length > 0) {
        lessonsMissing.push({ id: row.id, prompts });
        prompts.forEach(add);
      }
    } catch { /* unparseable spec: nothing to draw */ }
  }
  for (const row of libraryRows) {
    try { describeImagePrompts(JSON.parse(row.spec) as CustomLessonSpec).forEach(add); } catch { /* skip */ }
  }
  sampleImagePrompts().forEach(add);

  const results = await ensureLessonImages(env, [...byNorm.values()]);
  const out: TopUpResult = { lessons_checked: lessonRows.length, prompts: results.length, applied: 0, pending: 0, failed: 0, unavailable: 0 };
  const readyByNorm = new Map<string, string>();
  for (const r of results) {
    if (r.status === 'ready' && r.image_url) readyByNorm.set(normalizeImagePrompt(r.prompt), r.image_url);
    else if (r.status === 'pending') out.pending++;
    else if (r.status === 'failed') out.failed++;
    else if (r.status === 'unavailable') out.unavailable++;
  }
  for (const lesson of lessonsMissing) {
    for (const prompt of lesson.prompts) {
      const key = readyByNorm.get(normalizeImagePrompt(prompt));
      if (key && await applyLessonImageToLesson(env.DB, lesson.id, prompt, key)) out.applied++;
    }
  }
  return out;
}
