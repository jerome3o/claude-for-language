/**
 * 🎬 Clips jobs on `clip-queue` (docs/CLIPS.md):
 *   { kind: 'generate', clipId } — the clip writer (writer.ts) fills a generating row;
 *   { kind: 'audio', clipId }    — every line the players will ask `/api/practice/tts` for is made
 *                                  ahead into R2 `tts-cache/` (the lesson-audio pattern: ~40 s a
 *                                  delivery, then it sends itself again; a rate limit puts it back);
 *   { kind: 'lesson', clipId }   — "Learn more → ✨ Mini lesson" (lesson.ts).
 * Pictures go through the lesson-images pipeline (one per prompt hash, image-generation-queue).
 * Without the queue binding (tests) or under E2E_TEST_MODE the work runs inline (in waitUntil).
 */
import Anthropic from '@anthropic-ai/sdk';
import { CLIP_TTS_SPEED, clipAudioClips, clipImagePrompts, validateClipSpec, type ClipRecord, type ClipSpec, type ClipWord } from '@shared/clips';
import type { Env } from '../../types';
import { ensureLessonImages } from '../lesson-images';
import { ensurePracticeClip, type PracticeClipStatus } from '../tts-cache';
import { fixSpecPinyin, logPinyinFixes, pinyinSources } from '../pinyin-check';
import { trackServer } from '../analytics/server-events';
import type { CreateMessage } from '../companion-lesson';
import { getClip, getClipRow, insertReadyClip, learnerContext, type LearnerContext } from './store';
import { fakeClipSpec, writeClipSpec, type ClipBrief } from './writer';

export type ClipQueueMessage =
  | { kind: 'generate'; clipId: string }
  | { kind: 'audio'; clipId: string; attempt?: number }
  | { kind: 'lesson'; clipId: string };

/** Clips asked for in one request. */
export const MAX_CLIPS_PER_REQUEST = 3;
/** Clips being written at once per account. */
export const MAX_GENERATING_CLIPS = 6;
export const CLIP_AUDIO_TICK_MS = 40_000;
export const CLIP_AUDIO_MAX_ATTEMPTS = 20;
const SLOT_WAIT_MS = 15_000;

type Wait = (p: Promise<unknown>) => void;

/** The stand-in writes clips under E2E_TEST_MODE and when no key is set (dev). */
export function clipsUseFake(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return env.E2E_TEST_MODE === 'true' || !env.ANTHROPIC_API_KEY;
}

function useQueue(env: Env): boolean {
  return !!env.CLIP_QUEUE && env.E2E_TEST_MODE !== 'true';
}

/** Send a job, or run it inline (tests, E2E). */
export async function dispatchClipJob(env: Env, msg: ClipQueueMessage, waitUntil?: Wait): Promise<void> {
  if (useQueue(env)) {
    await env.CLIP_QUEUE!.send(msg);
    return;
  }
  if (msg.kind === 'audio' && env.E2E_TEST_MODE === 'true') return; // no TTS in E2E
  const run = handleClipMessage(env, msg).then((o) => console.log('[clips] inline', msg.kind, msg.clipId, o));
  if (waitUntil) waitUntil(run);
  else await run;
}

export async function handleClipMessage(env: Env, msg: ClipQueueMessage, deps: { create?: CreateMessage; ensure?: EnsureClipAudio } = {}): Promise<string> {
  if (msg.kind === 'generate') return runClipGeneration(env, msg.clipId, deps);
  if (msg.kind === 'audio') return (await runClipAudioJob(env, msg, deps)).next;
  const { runClipLessonJob } = await import('./lesson');
  return runClipLessonJob(env, msg.clipId, deps);
}

// ---------- Import / pictures / audio ----------

/** Pictures (lesson-images, by prompt hash) and the voice lines (clip-queue audio) made ahead. Never throws. */
export async function prepareClipMedia(env: Env, clipId: string, spec: ClipSpec, waitUntil?: Wait): Promise<void> {
  try {
    const prompts = clipImagePrompts(spec);
    if (prompts.length) await ensureLessonImages(env, prompts);
  } catch (err) {
    console.warn('[clips] pictures not queued:', clipId, err instanceof Error ? err.message : err);
  }
  try {
    if (clipAudioClips(spec).length) await dispatchClipJob(env, { kind: 'audio', clipId }, waitUntil);
  } catch (err) {
    console.warn('[clips] audio not queued:', clipId, err instanceof Error ? err.message : err);
  }
}

export interface ImportResult {
  ok: boolean;
  problems?: string[];
  clip?: ClipRecord;
  pinyin_fixes?: Awaited<ReturnType<typeof fixSpecPinyin>>;
}

/** Validate → impossible pinyin corrected → stored ready → pictures + audio queued. */
export async function importClip(env: Env, userId: string, input: unknown, source: 'agent' | 'manual', waitUntil?: Wait): Promise<ImportResult> {
  const problems = validateClipSpec(input);
  if (problems.length) return { ok: false, problems };
  const spec = JSON.parse(JSON.stringify(input)) as ClipSpec;
  const fixes = await fixSpecPinyin(spec, pinyinSources(env));
  logPinyinFixes('clip import', fixes);
  const id = await insertReadyClip(env.DB, userId, spec, source);
  await prepareClipMedia(env, id, spec, waitUntil);
  void trackServer('server.content_created', { kind: 'clip', count: 1, via: source === 'agent' ? 'mcp' : 'api' }, { env, userId });
  return { ok: true, clip: (await getClip(env.DB, userId, id))!, pinyin_fixes: fixes };
}

export type EnsureClipAudio = (env: Env, clip: { text: string; voice_id: string | null }) => Promise<PracticeClipStatus>;

const defaultEnsure: EnsureClipAudio = (env, clip) =>
  ensurePracticeClip(env, clip.text, { voiceId: clip.voice_id ?? undefined, speed: CLIP_TTS_SPEED, maxWaitMs: SLOT_WAIT_MS });

export interface ClipAudioRun {
  clips: number;
  made: number;
  cached: number;
  failed: number;
  next: 'done' | 'continue' | 'rate_limited' | 'gave_up' | 'gone';
}

export async function runClipAudioJob(
  env: Env,
  msg: { clipId: string; attempt?: number },
  deps: { ensure?: EnsureClipAudio; now?: () => number } = {},
): Promise<ClipAudioRun> {
  const ensure = deps.ensure ?? defaultEnsure;
  const now = deps.now ?? (() => Date.now());
  const run: ClipAudioRun = { clips: 0, made: 0, cached: 0, failed: 0, next: 'done' };
  const row = await env.DB.prepare(`SELECT spec FROM clips WHERE id = ? AND status = 'ready'`).bind(msg.clipId).first<{ spec: string | null }>();
  if (!row?.spec) return { ...run, next: 'gone' };
  let spec: ClipSpec;
  try {
    spec = JSON.parse(row.spec) as ClipSpec;
  } catch {
    return { ...run, next: 'gone' };
  }
  const clips = clipAudioClips(spec);
  run.clips = clips.length;
  const started = now();
  for (const clip of clips) {
    if (now() - started > CLIP_AUDIO_TICK_MS && env.CLIP_QUEUE) {
      await env.CLIP_QUEUE.send({ kind: 'audio', clipId: msg.clipId, attempt: msg.attempt });
      return { ...run, next: 'continue' };
    }
    const out = await ensure(env, clip).catch((err): PracticeClipStatus => ({ status: 'failed', reason: err instanceof Error ? err.message : String(err) }));
    if (out.status === 'cached') run.cached++;
    else if (out.status === 'made') run.made++;
    else if (out.status === 'failed') run.failed++;
    else if (out.status === 'rate_limited') {
      const attempt = (msg.attempt ?? 0) + 1;
      if (attempt > CLIP_AUDIO_MAX_ATTEMPTS || !env.CLIP_QUEUE) return { ...run, next: 'gave_up' };
      await env.CLIP_QUEUE.send({ kind: 'audio', clipId: msg.clipId, attempt }, { delaySeconds: Math.min(300, Math.max(60, Math.ceil(out.retryAfterMs / 1000))) });
      return { ...run, next: 'rate_limited' };
    }
  }
  return run;
}

// ---------- Generation ----------

export interface GenerateRequest {
  topic?: unknown;
  words?: unknown;
  count?: unknown;
}

export function pickGenerateRequest(body: GenerateRequest): { topic: string | null; words: string[]; count: number; problems: string[] } {
  const problems: string[] = [];
  const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim().slice(0, 120) : null;
  const words = Array.isArray(body.words)
    ? [...new Set(body.words.map((w) => (typeof w === 'string' ? w : (w as { hanzi?: unknown })?.hanzi)).filter((w): w is string => typeof w === 'string' && !!w.trim()).map((w) => w.trim().slice(0, 24)))].slice(0, 6)
    : [];
  let count = 1;
  if (body.count !== undefined && body.count !== null) {
    const n = Number(body.count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CLIPS_PER_REQUEST) problems.push(`count must be 1–${MAX_CLIPS_PER_REQUEST}`);
    else count = n;
  }
  if (body.words !== undefined && !Array.isArray(body.words)) problems.push('words must be a list of hanzi');
  return { topic, words, count, problems };
}

/** Insert `count` generating rows and start them. 409 when too many are already being written. */
export async function requestClipGeneration(
  env: Env,
  userId: string,
  req: { topic: string | null; words: string[]; count: number },
  opts: { waitUntil?: Wait; via?: 'app' | 'mcp' | 'more' } = {},
): Promise<{ clips: ClipRecord[] } | { error: string; status: 409 | 503 }> {
  const active = await env.DB.prepare(`SELECT COUNT(*) AS n FROM clips WHERE user_id = ? AND status = 'generating' AND updated_at >= datetime('now', '-15 minutes')`).bind(userId).first<{ n: number }>();
  if (Number(active?.n ?? 0) + req.count > MAX_GENERATING_CLIPS) return { error: `${MAX_GENERATING_CLIPS} clips are already being made — wait for them to finish`, status: 409 };
  const ids: string[] = [];
  for (let i = 0; i < req.count; i++) {
    const id = crypto.randomUUID();
    const brief: ClipBrief = { topic: req.topic, words: req.words, variant: i + 1, of: req.count };
    await env.DB.prepare(`INSERT INTO clips (id, user_id, status, source, title, topic, request, progress) VALUES (?, ?, 'generating', 'generated', ?, ?, ?, 'Writing the clip…')`)
      .bind(id, userId, req.topic ? `${req.topic}` : 'A clip for you', req.topic, JSON.stringify(brief))
      .run();
    ids.push(id);
  }
  void trackServer('clips.generate', { count: req.count, via: opts.via ?? 'app' }, { env, userId });
  for (const id of ids) await dispatchClipJob(env, { kind: 'generate', clipId: id }, opts.waitUntil);
  const clips = await Promise.all(ids.map((id) => getClip(env.DB, userId, id)));
  return { clips: clips.filter((c): c is ClipRecord => !!c) };
}

/** Focus words as ClipWords from the learner's own notes (the stand-in uses them). */
async function wordsFromNotes(db: D1Database, userId: string, hanzi: string[]): Promise<ClipWord[]> {
  if (!hanzi.length) return [];
  const rows = await db
    .prepare(`SELECT n.hanzi, n.pinyin, n.english FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? AND n.hanzi IN (${hanzi.map(() => '?').join(',')})`)
    .bind(userId, ...hanzi)
    .all<ClipWord>();
  const by = new Map((rows.results ?? []).map((r) => [r.hanzi, r]));
  return hanzi.map((h) => by.get(h)).filter((w): w is ClipWord => !!w && !!w.pinyin && !!w.english);
}

export async function runClipGeneration(env: Env, clipId: string, deps: { create?: CreateMessage; context?: LearnerContext } = {}): Promise<'ready' | 'failed' | 'skipped'> {
  const row = await env.DB.prepare('SELECT * FROM clips WHERE id = ?').bind(clipId).first<{ user_id: string; status: string; request: string | null; attempts: number }>();
  if (!row || row.status !== 'generating') return 'skipped';
  await env.DB.prepare(`UPDATE clips SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`).bind(clipId).run();
  const fail = async (message: string) => {
    await env.DB.prepare(`UPDATE clips SET status = 'failed', error = ?, progress = NULL, updated_at = datetime('now') WHERE id = ?`).bind(message, clipId).run();
    return 'failed' as const;
  };
  let brief: ClipBrief;
  try {
    brief = JSON.parse(row.request ?? '{}') as ClipBrief;
  } catch {
    return fail('The request was unreadable.');
  }
  brief = { topic: brief.topic ?? null, words: Array.isArray(brief.words) ? brief.words : [], variant: brief.variant || 1, of: brief.of || 1 };
  try {
    const ctx = deps.context ?? (await learnerContext(env.DB, row.user_id));
    const titles = ((await env.DB.prepare(`SELECT title FROM clips WHERE user_id = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 30`).bind(row.user_id).all<{ title: string | null }>()).results ?? [])
      .map((r) => r.title ?? '')
      .filter(Boolean);
    let usage = { input: 0, output: 0 };
    const onUsage = (u: { input: number; output: number }) => (usage = { input: usage.input + u.input, output: usage.output + u.output });
    let spec: ClipSpec;
    if (deps.create) spec = await writeClipSpec(brief, ctx, titles, deps.create, onUsage);
    else if (clipsUseFake(env)) spec = fakeClipSpec(brief, await wordsFromNotes(env.DB, row.user_id, brief.words));
    else {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 4 * 60 * 1000 });
      spec = await writeClipSpec(brief, ctx, titles, (p) => client.messages.create(p), onUsage);
    }
    const fixes = await fixSpecPinyin(spec, pinyinSources(env));
    logPinyinFixes('clip generation', fixes);
    if (validateClipSpec(spec).length) return fail('The clip didn’t pass the checks — try again.');
    const done = await env.DB.prepare(
      `UPDATE clips SET status = 'ready', spec = ?, title = ?, topic = COALESCE(topic, ?), theme = ?, progress = NULL, error = NULL,
         input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, updated_at = datetime('now') WHERE id = ? AND status = 'generating'`,
    )
      .bind(JSON.stringify(spec), spec.title, spec.topic ?? null, spec.style.theme, usage.input, usage.output, clipId)
      .run();
    if ((done.meta?.changes ?? 0) === 0) return 'skipped';
    await prepareClipMedia(env, clipId, spec);
    void trackServer('server.content_created', { kind: 'clip', count: 1, via: 'generated' }, { env, userId: row.user_id });
    return 'ready';
  } catch (error) {
    console.error('[clips] generation failed:', clipId, error instanceof Error ? error.message : error);
    return fail('Claude couldn’t write this clip right now — try again.');
  }
}

/** Retry a failed generated clip in place. */
export async function retryClipGeneration(env: Env, userId: string, clipId: string, waitUntil?: Wait): Promise<{ clip: ClipRecord } | { problem: string; status: 404 | 409 }> {
  const row = await getClipRow(env.DB, userId, clipId);
  if (!row) return { problem: 'Not found', status: 404 };
  if (row.status !== 'failed' || !row.request) return { problem: 'Only a clip that failed to generate can be retried', status: 409 };
  await env.DB.prepare(`UPDATE clips SET status = 'generating', error = NULL, progress = 'Writing the clip…', updated_at = datetime('now') WHERE id = ?`).bind(clipId).run();
  await dispatchClipJob(env, { kind: 'generate', clipId }, waitUntil);
  return { clip: (await getClip(env.DB, userId, clipId))! };
}
