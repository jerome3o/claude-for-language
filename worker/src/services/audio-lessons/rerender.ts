/**
 * Re-render a READY story lesson in the current story layout (docs/AUDIO_LESSONS.md "Story" →
 * "Re-rendering"): Oct 2026 every chunk went from "×3, its English" to "×3, its English, ×2 more"
 * (`STORY_LAYOUT` 2). The new script is compiled from the plan the lesson already stores, and every
 * clip it needs is CUT OUT OF THE LESSON'S OWN MP3 — the old script + its timeline say where each
 * clip starts, the pauses between say where it ends — so nothing is translated or spoken again
 * (the per-clip parts are deleted once a lesson is rendered, and MiniMax may be out of credit).
 *
 * The lesson keeps its id, title, plan, companion mini lesson, listened_at, created / finished
 * dates; its file gets a NEW version (`audio_key` …-<version>.mp3), which the podcast feed's
 * enclosure URL / guid and both apps' offline copies are keyed by, so they fetch the new file.
 * The row switches in ONE conditional UPDATE (still ready, still the old file) — until then the
 * old file plays; nothing is ever left half done. Idempotent: a lesson already in the current
 * layout is `up_to_date`. A lesson whose clips can't all be cut out (or made, when `speak` is
 * given) is left exactly as it was.
 *
 * Runs on audio-lesson-queue (`{ lessonId, rerender: true }`), queued by the admin endpoint
 * (POST /api/admin/audio-lessons/rerender) and once by the cron after the deploy that brought the
 * layout (`queueStoryRerendersOnce`).
 */
import {
  buildTimeline,
  compileStoryLesson,
  estimateScriptMs,
  speechKey,
  STORY_LAYOUT,
  uniqueSpeech,
  type AudioLessonScript,
  type AudioLessonTranscriptLine,
  type SpeechSegment,
  type StoryPlan,
} from '@shared/audio-lesson';
import type { Env } from '../../types';
import * as q from '../../db/audio-lesson-queries';
import { assembleMp3, frameMs, framesForMs, parseMp3Frames, type AssemblyPart } from './mp3';
import { speakClip, type ClipOutcome, type ClipRequest } from './synth';
import { loadTtsConfig } from '../tts/config';
import type { TtsProviderId } from '@shared/tts';

export type RerenderOutcome = 'rerendered' | 'up_to_date' | 'not_found' | 'not_story' | 'not_ready' | 'failed';

export interface RerenderResult {
  id: string;
  outcome: RerenderOutcome;
  reason?: string;
  duration_ms_before?: number | null;
  duration_ms_after?: number;
  /** Clips cut out of the old file / made again. */
  clips_cut?: number;
  clips_made?: number;
  version?: string;
}

/** The layout of a stored script (absent = 1). */
export function scriptLayout(script: Pick<AudioLessonScript, 'layout'> | null | undefined): number {
  return typeof script?.layout === 'number' ? script.layout : 1;
}

/** SQL: ready story lessons whose script is in an older layout (the candidates). */
const STALE_STORY_SQL = `format = 'story' AND status = 'ready' AND audio_key IS NOT NULL AND plan_json IS NOT NULL
  AND COALESCE(json_extract(script_json, '$.layout'), 1) < ?`;

export interface StaleStoryRow {
  id: string;
  user_id: string;
  title: string;
  duration_ms: number | null;
  plan_json: string;
  script_json: string;
}

export async function staleStoryLessons(db: D1Database, limit = 500): Promise<StaleStoryRow[]> {
  const res = await db
    .prepare(`SELECT id, user_id, title, duration_ms, plan_json, script_json FROM audio_lessons WHERE ${STALE_STORY_SQL} ORDER BY created_at LIMIT ?`)
    .bind(STORY_LAYOUT, limit)
    .all<StaleStoryRow>();
  return res.results ?? [];
}

/** The dry run's line per lesson: how long it is now, and about how long after (scaled by the scripts' estimates). */
export function rerenderPreview(row: StaleStoryRow): { id: string; user_id: string; title: string; chunks: number; duration_ms: number | null; estimated_ms_after: number | null } {
  const plan = JSON.parse(row.plan_json) as StoryPlan;
  const before = estimateScriptMs(JSON.parse(row.script_json) as AudioLessonScript);
  const after = estimateScriptMs(compileStoryLesson(plan));
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    chunks: plan.chunks?.length ?? 0,
    duration_ms: row.duration_ms,
    estimated_ms_after: row.duration_ms && before > 0 ? Math.round((row.duration_ms * after) / before) : null,
  };
}

/**
 * Cut every distinct clip out of a rendered lesson file. `script` + `transcript` are what the file
 * was rendered from (the transcript has one line per speech segment, timed in whole frames after
 * `leadFrames` — the Xing frame, which `parseMp3Frames` drops); a pause is `framesForMs(ms)` frames
 * of silence, exactly as `assembleMp3` wrote it. A clip ends where the pauses before the next clip
 * begin. Every check that could catch a file that doesn't match its script is made — any mismatch
 * → an error, never a guess.
 */
export function cutClips(
  script: AudioLessonScript,
  transcript: AudioLessonTranscriptLine[],
  file: Uint8Array,
  /** The file's stored length (`duration_ms`): its frame count must match. */
  durationMs: number | null,
  leadFrames = 1,
): { clips: Map<string, Uint8Array[]> } | { error: string } {
  const ms = frameMs();
  const frames = parseMp3Frames(file).frames;
  if (durationMs !== null && Math.round(durationMs / ms) - leadFrames !== frames.length) return { error: `the file has ${frames.length} frames, its lesson says ${Math.round(durationMs / ms) - leadFrames}` };
  const segs = script.segments;
  const speech = segs.filter((s) => s.kind === 'speech') as SpeechSegment[];
  if (speech.length !== transcript.length) return { error: `the timeline has ${transcript.length} lines for ${speech.length} clips` };
  const starts = transcript.map((l) => l.start_ms / ms - leadFrames);
  if (starts.some((s) => !Number.isInteger(s) || s < 0)) return { error: 'the timeline is not in whole frames' };

  const clips = new Map<string, Uint8Array[]>();
  let pos = 0;
  let k = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === 'pause') {
      pos += framesForMs(s.ms);
      continue;
    }
    if (starts[k] !== pos) return { error: `clip ${k + 1} starts at frame ${starts[k]}, expected ${pos}` };
    if ((transcript[k].text ?? '') !== (s.display ?? s.text)) return { error: `clip ${k + 1} is not "${s.text.slice(0, 20)}"` };
    // Where it ends: the next clip's start less the pauses in between, or the file's end less the trailing pauses.
    let gap = 0;
    let j = i + 1;
    for (; j < segs.length && segs[j].kind === 'pause'; j++) gap += framesForMs((segs[j] as { ms: number }).ms);
    const end = (k + 1 < starts.length ? starts[k + 1] : frames.length) - gap;
    const len = end - pos;
    if (len <= 0 || end > frames.length) return { error: `clip ${k + 1} has no frames` };
    const key = speechKey(s);
    const have = clips.get(key);
    if (have && have.length !== len) return { error: `"${s.text.slice(0, 20)}" is ${have.length} frames in one place and ${len} in another` };
    if (!have) clips.set(key, frames.slice(pos, end));
    pos = end;
    k++;
  }
  if (pos !== frames.length) return { error: `the file has ${frames.length} frames, the script ${pos}` };
  return { clips };
}

export interface RerenderDeps {
  /**
   * Make a clip that can't be cut out of the file (default: the lesson pipeline's `speakClip`, the
   * lesson's pinned Chinese provider, batch priority, one try). A clip that can't be made leaves the
   * lesson as it was — e.g. while the pinned provider is paused for its account.
   */
  speak?: (clip: ClipRequest, pinned: TtsProviderId | null) => Promise<ClipOutcome>;
  version?: () => string;
}

/** Re-render one ready story lesson in the current layout. Never throws; never changes a lesson it can't finish. */
export async function rerenderStoryLesson(env: Env, lessonId: string, deps: RerenderDeps = {}): Promise<RerenderResult> {
  const row = await q.getAudioLesson(env.DB, lessonId);
  if (!row) return { id: lessonId, outcome: 'not_found' };
  if (row.format !== 'story') return { id: lessonId, outcome: 'not_story' };
  if (row.status !== 'ready' || !row.audio_key || !row.plan_json || !row.script_json || !row.timeline_json) return { id: lessonId, outcome: 'not_ready' };
  const failed = (reason: string): RerenderResult => {
    console.error('[audio-lesson] re-render left as it was', lessonId, reason);
    return { id: lessonId, outcome: 'failed', reason, duration_ms_before: row.duration_ms };
  };
  try {
    const oldScript = JSON.parse(row.script_json) as AudioLessonScript;
    if (scriptLayout(oldScript) >= STORY_LAYOUT) return { id: lessonId, outcome: 'up_to_date', duration_ms_before: row.duration_ms };
    const plan = JSON.parse(row.plan_json) as StoryPlan;
    const script = compileStoryLesson(plan);
    // The lesson's own title stays (the list shows it; compile takes the plan's).
    script.title = oldScript.title || script.title;
    const transcript = (JSON.parse(row.timeline_json) as { transcript?: AudioLessonTranscriptLine[] }).transcript ?? [];

    const obj = await env.AUDIO_BUCKET.get(row.audio_key);
    if (!obj) return failed('the lesson file is missing');
    const cut = cutClips(oldScript, transcript, new Uint8Array(await obj.arrayBuffer()), row.duration_ms);
    if ('error' in cut) return failed(`couldn't cut the clips out of the file: ${cut.error}`);

    const clips = new Map<string, Uint8Array[]>();
    let made = 0;
    for (const u of uniqueSpeech(script)) {
      const have = cut.clips.get(u.key);
      if (have) {
        clips.set(u.key, have);
        continue;
      }
      const speak =
        deps.speak ??
        (async (clip: ClipRequest, pin: TtsProviderId | null) => speakClip(env, await loadTtsConfig(env), clip, script.speakers, pin, { priority: 'batch', maxWaitMs: 30_000 }));
      const res = await speak({ lang: u.lang, voice: u.voice as ClipRequest['voice'], rate: u.rate, text: u.text }, (row.zh_provider as TtsProviderId | null) ?? null);
      if (!res.ok) return failed(`couldn't make "${u.text.slice(0, 30)}": ${res.reason}`);
      clips.set(u.key, parseMp3Frames(res.bytes).frames);
      made++;
    }

    const parts: AssemblyPart[] = script.segments.map((s) => (s.kind === 'pause' ? { kind: 'silence', ms: s.ms } : { kind: 'frames', frames: clips.get(speechKey(s))! }));
    const assembled = assembleMp3(parts);
    const timeline = buildTimeline(script, new Map([...clips.entries()].map(([key, f]) => [key, f.length])), frameMs(), 1);
    const version = (deps.version ?? (() => crypto.randomUUID().split('-')[0]))();
    const fileKey = q.audioLessonFileKey(row.user_id, lessonId, version);
    await env.AUDIO_BUCKET.put(fileKey, assembled.bytes, { httpMetadata: { contentType: 'audio/mpeg' } });

    // One switch, only while nothing else changed the lesson (deleted, rebuilt, re-rendered by a twin message).
    const res = await env.DB
      .prepare(
        `UPDATE audio_lessons SET script_json = ?, timeline_json = ?, audio_key = ?, duration_ms = ?, size_bytes = ?, updated_at = ?
          WHERE id = ? AND status = 'ready' AND audio_key = ?`,
      )
      .bind(
        JSON.stringify(script),
        JSON.stringify({ chapters: timeline.chapters, transcript: timeline.transcript }),
        fileKey,
        timeline.duration_ms,
        assembled.bytes.length,
        new Date().toISOString(),
        lessonId,
        row.audio_key,
      )
      .run();
    if (!res.meta?.changes) {
      await env.AUDIO_BUCKET.delete(fileKey).catch(() => {});
      const now = await q.getAudioLesson(env.DB, lessonId);
      return { id: lessonId, outcome: now ? 'up_to_date' : 'not_found', reason: 'the lesson changed meanwhile' };
    }
    await env.AUDIO_BUCKET.delete(row.audio_key).catch(() => {});
    console.log(JSON.stringify({ type: 'audio_lesson_rerender', id: lessonId, before_ms: row.duration_ms, after_ms: timeline.duration_ms, cut: clips.size - made, made }));
    return { id: lessonId, outcome: 'rerendered', duration_ms_before: row.duration_ms, duration_ms_after: timeline.duration_ms, clips_cut: clips.size - made, clips_made: made, version };
  } catch (error) {
    return failed(error instanceof Error ? error.message.slice(0, 300) : 'Something went wrong');
  }
}

export interface QueueRerendersResult {
  dry_run: boolean;
  count: number;
  queued: number;
  lessons: ReturnType<typeof rerenderPreview>[];
}

/** Find the ready story lessons in an older layout; queue each (unless a dry run). */
export async function queueStoryRerenders(env: Env, opts: { dryRun: boolean; limit?: number }): Promise<QueueRerendersResult> {
  const rows = await staleStoryLessons(env.DB, opts.limit ?? 500);
  const lessons = rows.map(rerenderPreview);
  let queued = 0;
  if (!opts.dryRun) {
    // A few seconds apart: each message reads and writes one whole MP3.
    for (const [i, r] of rows.entries()) {
      await env.AUDIO_LESSON_QUEUE.send({ lessonId: r.id, rerender: true }, i > 0 ? { delaySeconds: Math.min(600, i * 5) } : undefined);
      queued++;
    }
  }
  return { dry_run: opts.dryRun, count: rows.length, queued, lessons };
}

/** The app_keys row that says the one-time re-render after the layout change was queued. */
export const STORY_RERENDER_FLAG = `story_rerender_layout_${STORY_LAYOUT}`;

/**
 * Once, on the first cron after the deploy that brought STORY_LAYOUT: queue every ready story
 * lesson in an older layout. Claimed by an INSERT OR IGNORE into app_keys, so it runs once however
 * many crons / isolates race; the admin endpoint can always queue again.
 */
export async function queueStoryRerendersOnce(env: Env): Promise<{ ran: false } | ({ ran: true } & Omit<QueueRerendersResult, 'lessons'>)> {
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO app_keys (name, value) VALUES (?, ?)')
    .bind(STORY_RERENDER_FLAG, JSON.stringify({ claimed_at: new Date().toISOString() }))
    .run();
  if (!claim.meta?.changes) return { ran: false };
  let out: QueueRerendersResult;
  try {
    out = await queueStoryRerenders(env, { dryRun: false });
  } catch (err) {
    // Not queued: the next cron tries again (a lesson queued twice is re-rendered once).
    await env.DB.prepare('DELETE FROM app_keys WHERE name = ?').bind(STORY_RERENDER_FLAG).run();
    throw err;
  }
  await env.DB.prepare('UPDATE app_keys SET value = ? WHERE name = ?')
    .bind(JSON.stringify({ claimed_at: new Date().toISOString(), count: out.count, queued: out.queued }), STORY_RERENDER_FLAG)
    .run();
  return { ran: true, dry_run: false, count: out.count, queued: out.queued };
}
