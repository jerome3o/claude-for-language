/**
 * 📺 Watch — one YouTube video's transcript (docs/WATCH.md), on audio-lesson-queue (message
 * `{ kind: 'video_transcript', videoId }`) in resumable stages; the row is the checkpoint, every
 * delivery does what is left and re-enqueues itself:
 *
 * 1. transcribing — Gemini reads the video window by window (~5 min each, transcribe.ts); each
 *                   window's raw lines are saved as it finishes, and the tidied lines (with
 *                   automatic pinyin) are rebuilt, so the player shows them while the rest is read.
 *                   A window that fails WATCH_CHUNK_ATTEMPTS times is skipped (a gap the player
 *                   names); a model that refuses clipping offsets → one whole-video read.
 * 2. translating  — the English, TRANSLATE_BATCH lines a call (the podcasts' translator with a
 *                   TV-drama prompt), written after every batch.
 *
 * ONE transcript per video id for everyone; Retry resumes from where it failed.
 */
import type { Env } from '../../types';
import { planWatchChunks, tidyWatchLines, type WatchLine } from '@shared/watch';
import { trackServer } from '../analytics/server-events';
import { pinyinLine } from '../podcasts/segments';
import { anthropicSegmentTranslate, fakeSegmentTranslate, TRANSLATE_BATCH, translateCostUsd, type SegmentTranslate } from '../podcasts/translate';
import { getVideo, parseChunks, parseLines, updateVideo, type WatchChunkState, type WatchVideoRow } from './store';
import { ClipOffsetsUnsupported, WATCH_GEMINI_PRICE, WATCH_WHOLE_MAX_MS, fakeWatchTranscriber, geminiWatchTranscriber, type WatchTranscriber } from './transcribe';

export interface WatchTranscriptMessage {
  kind: 'video_transcript';
  videoId: string;
}

export type WatchJobOutcome = 'done' | 'continue' | 'waiting' | 'failed' | 'skipped';

/** Tries per window before it is skipped. */
export const WATCH_CHUNK_ATTEMPTS = 3;
/** Translation failures before the video is `failed` (Retry resumes). */
export const WATCH_TRANSLATE_ATTEMPTS = 3;
/** Wall clock per delivery before the job re-enqueues itself (a window read can take ~1–2 min). */
export const WATCH_SOFT_DEADLINE_MS = 3 * 60 * 1000;

export const WATCH_TRANSLATE_SYSTEM = `You translate the dialogue of a Chinese TV drama, line by line, for an English-speaking learner who watches one line at a time and then checks your English.

The lines come from the episode's subtitles (or, without subtitles, from speech recognition): punctuation may be missing and a line can be half a sentence that the next line finishes. For every line give "english": a natural, faithful English translation of exactly that line as it is said — one or two plain sentences, in the register of the scene (family, office, friends). Don't add, explain, summarise or correct. Keep names as names (pinyin spelling is fine for Chinese names). No Chinese characters and no pinyin in the English.
Translate every line you are given, by its number. The lines before are context only.`;

export interface WatchJobDeps {
  transcriber?: WatchTranscriber;
  translate?: SegmentTranslate | null;
  requeue?: (msg: WatchTranscriptMessage, delaySeconds: number) => Promise<void>;
  now?: () => number;
}

export function isWatchFakeMode(env: Pick<Env, 'E2E_TEST_MODE'>): boolean {
  return env.E2E_TEST_MODE === 'true';
}

/** Can transcripts be made on this deployment? */
export function watchTranscriptAvailable(env: Pick<Env, 'GEMINI_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return isWatchFakeMode(env) || !!(env.GEMINI_API_KEY || '').trim();
}

interface WatchUsage {
  gemini_input: number;
  gemini_output: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
}

function parseUsage(raw: string | null): WatchUsage {
  try {
    const u = raw ? (JSON.parse(raw) as Partial<WatchUsage>) : {};
    return { gemini_input: u.gemini_input ?? 0, gemini_output: u.gemini_output ?? 0, input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 };
  } catch {
    return { gemini_input: 0, gemini_output: 0, input_tokens: 0, output_tokens: 0 };
  }
}

export function watchCostUsd(u: WatchUsage): number {
  return (u.gemini_input * WATCH_GEMINI_PRICE.input + u.gemini_output * WATCH_GEMINI_PRICE.output) / 1_000_000 + translateCostUsd(u);
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300) || 'unknown error';
}

/**
 * Every finished window's lines → the player's lines: tidied, with pinyin, and with the English of
 * an existing line kept (matched by start + text) so a rebuild never loses a translation.
 */
export function buildLines(chunks: readonly WatchChunkState[], previous: readonly WatchLine[] = []): WatchLine[] {
  const raw = chunks.filter((c) => c.status === 'done').flatMap((c) => c.lines);
  const known = new Map(previous.map((l) => [`${l.start_ms}|${l.zh}`, l]));
  return tidyWatchLines(raw).map((l) => {
    const old = known.get(`${l.start_ms}|${l.zh}`);
    return { i: l.i, start_ms: l.start_ms, end_ms: l.end_ms, zh: l.zh, pinyin: old?.pinyin ?? pinyinLine(l.zh), english: old?.english ?? null, speaker: l.speaker };
  });
}

function untranslated(lines: readonly WatchLine[]): number[] {
  return lines.filter((l) => l.english === null || l.english === undefined).map((l) => l.i);
}

/** Run what is left of one video's transcript. Never throws for a job failure (written to the row). */
export async function runWatchTranscriptJob(env: Env, videoId: string, deps: WatchJobDeps = {}): Promise<WatchJobOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const fake = isWatchFakeMode(env) && deps.transcriber === undefined;
  const requeue = deps.requeue ?? (async (msg, delaySeconds) => {
    await env.AUDIO_LESSON_QUEUE.send(msg as never, delaySeconds > 0 ? { delaySeconds } : undefined);
  });
  const again = async (delaySeconds: number): Promise<WatchJobOutcome> => {
    await requeue({ kind: 'video_transcript', videoId }, delaySeconds);
    return delaySeconds > 0 ? 'waiting' : 'continue';
  };
  let row = await getVideo(env.DB, videoId);
  if (!row || row.status === 'ready' || row.status === 'failed') return 'skipped';

  const failVideo = async (stage: string, reason: string): Promise<WatchJobOutcome> => {
    console.error(`[watch] ${stage} failed for ${videoId}:`, reason);
    await updateVideo(env.DB, videoId, { status: 'failed', error: reason, progress: null });
    void trackServer('server.watch_transcribed', { ok: false, stage, minutes: Math.round((row!.duration_ms ?? 0) / 60000), lines: 0, chunks: row!.chunks_total ?? 0, skipped: 0 }, { env, userId: row!.requested_by });
    return 'failed';
  };

  // ---- 1. transcribe, window by window
  if (row.status === 'queued' || row.status === 'transcribing') {
    const transcriber = deps.transcriber ?? (fake ? fakeWatchTranscriber() : (env.GEMINI_API_KEY || '').trim() ? geminiWatchTranscriber(env.GEMINI_API_KEY.trim()) : null);
    if (!transcriber) return failVideo('transcribe', 'Transcripts are not set up on the server (no Gemini key)');
    let chunks = parseChunks(row.chunks_json);
    if (!chunks.length) {
      const plan = planWatchChunks(row.duration_ms ?? 0);
      if (!plan.length) return failVideo('transcribe', "The video's length is unknown — open it again so the player can tell us");
      chunks = plan.map((c) => ({ ...c, status: 'pending', attempts: 0, error: null, lines: [] }));
    }
    const usage = parseUsage(row.usage_json);
    const save = async (extra: Partial<WatchVideoRow> = {}) => {
      const lines = buildLines(chunks, parseLines(row!.lines_json));
      const done = chunks.filter((c) => c.status !== 'pending').length;
      await updateVideo(env.DB, videoId, {
        status: 'transcribing',
        chunks_json: JSON.stringify(chunks),
        lines_json: JSON.stringify(lines),
        chunks_done: done,
        chunks_total: chunks.length,
        progress: `Reading part ${Math.min(chunks.length, done + 1)} of ${chunks.length}`,
        usage_json: JSON.stringify(usage),
        ...extra,
      });
      row = (await getVideo(env.DB, videoId))!;
    };
    if (row.status === 'queued') await save({ attempts: 0, error: null });

    for (const chunk of chunks) {
      if (chunk.status !== 'pending') continue;
      if (now() - started > WATCH_SOFT_DEADLINE_MS) return again(0);
      try {
        const out = await transcriber({ videoId, title: row.title, window: { start_ms: chunk.start_ms, end_ms: chunk.end_ms }, whole: chunk.whole });
        chunk.status = 'done';
        chunk.lines = out.lines;
        chunk.error = null;
        if (out.usage) {
          usage.gemini_input += out.usage.input_tokens;
          usage.gemini_output += out.usage.output_tokens;
        }
        await save({ provider: 'gemini', model: out.model, error: null });
      } catch (err) {
        if (err instanceof ClipOffsetsUnsupported) {
          // The model can't clip: read the whole video in one call (docs/WATCH.md).
          const duration = row.duration_ms ?? 0;
          if (duration > WATCH_WHOLE_MAX_MS) return failVideo('transcribe', `Gemini couldn't read this video in parts, and at ${Math.round(duration / 60000)} minutes it is too long to read in one go`);
          console.warn(`[watch] ${videoId}: clipping refused (${message(err)}); reading the whole video`);
          chunks = [{ i: 0, start_ms: 0, end_ms: duration, status: 'pending', attempts: 0, error: null, lines: [], whole: true }];
          await save();
          return again(0);
        }
        chunk.attempts += 1;
        chunk.error = message(err);
        console.error(`[watch] ${videoId} part ${chunk.i + 1} failed (attempt ${chunk.attempts}):`, chunk.error);
        if (chunk.attempts >= WATCH_CHUNK_ATTEMPTS) chunk.status = 'skipped';
        await save({ error: chunk.error });
        return again(chunk.status === 'skipped' ? 0 : 30 * chunk.attempts);
      }
    }

    const lines = buildLines(chunks, parseLines(row.lines_json));
    const skipped = chunks.filter((c) => c.status === 'skipped');
    if (!lines.length) {
      return failVideo('transcribe', skipped.length ? `Gemini couldn't read this video (${skipped[0].error ?? 'unknown error'})` : 'No Chinese dialogue was found in this video');
    }
    await updateVideo(env.DB, videoId, {
      status: 'translating',
      chunks_json: JSON.stringify(chunks),
      lines_json: JSON.stringify(lines),
      chunks_done: chunks.length,
      chunks_total: chunks.length,
      progress: 'Translating…',
      progress_done: lines.length - untranslated(lines).length,
      progress_total: lines.length,
      attempts: 0,
      error: null,
      usage_json: JSON.stringify(usage),
    });
    row = (await getVideo(env.DB, videoId))!;
  }

  // ---- 2. translate
  if (row.status === 'translating') {
    const translate =
      deps.translate !== undefined
        ? deps.translate
        : fake
          ? fakeSegmentTranslate()
          : env.ANTHROPIC_API_KEY
            ? anthropicSegmentTranslate(env.ANTHROPIC_API_KEY, { system: WATCH_TRANSLATE_SYSTEM })
            : null;
    const lines = parseLines(row.lines_json);
    const usage = parseUsage(row.usage_json);
    if (translate) {
      while (untranslated(lines).length) {
        if (now() - started > WATCH_SOFT_DEADLINE_MS) return again(0);
        const todo = untranslated(lines).slice(0, TRANSLATE_BATCH);
        const first = todo[0];
        try {
          const out = await translate({
            segments: todo.map((i) => ({ i, text: lines[i].zh, speaker: lines[i].speaker })),
            before: lines.slice(Math.max(0, first - 3), first).map((l) => l.zh),
            podcastTitle: row.channel,
            episodeTitle: row.title,
            label: `TV drama on YouTube: ${row.title || 'untitled'}${row.channel ? ` (channel ${row.channel})` : ''}`,
          });
          for (const it of out.items) if (lines[it.i]) lines[it.i].english = it.english;
          if (out.usage) {
            usage.input_tokens += out.usage.input_tokens;
            usage.output_tokens += out.usage.output_tokens;
          }
        } catch (err) {
          const attempts = (row.attempts ?? 0) + 1;
          await updateVideo(env.DB, videoId, { lines_json: JSON.stringify(lines), usage_json: JSON.stringify(usage), attempts, error: message(err) });
          if (attempts >= WATCH_TRANSLATE_ATTEMPTS) return failVideo('translate', message(err));
          return again(60 * attempts);
        }
        const done = lines.length - untranslated(lines).length;
        await updateVideo(env.DB, videoId, {
          lines_json: JSON.stringify(lines),
          usage_json: JSON.stringify(usage),
          progress: `Translating ${done} / ${lines.length}`,
          progress_done: done,
          progress_total: lines.length,
          attempts: 0,
          error: null,
        });
      }
    }
    // No Claude key: the transcript is still useful (hanzi + pinyin), the English stays empty.
    const chunks = parseChunks(row.chunks_json);
    await updateVideo(env.DB, videoId, {
      status: 'ready',
      progress: null,
      progress_done: lines.length,
      progress_total: lines.length,
      error: null,
      lines_json: JSON.stringify(lines),
      usage_json: JSON.stringify({ ...usage, cost_usd: Number(watchCostUsd(usage).toFixed(4)) }),
      finished_at: new Date(now()).toISOString(),
    });
    void trackServer(
      'server.watch_transcribed',
      { ok: true, stage: 'done', minutes: Math.round((row.duration_ms ?? 0) / 60000), lines: lines.length, chunks: chunks.length, skipped: chunks.filter((c) => c.status === 'skipped').length },
      { env, userId: row.requested_by },
    );
    return 'done';
  }
  return 'skipped';
}

/** Retry a failed transcript from where it stopped (skipped windows are tried again). */
export async function resetFailedVideo(db: D1Database, row: WatchVideoRow): Promise<void> {
  const chunks = parseChunks(row.chunks_json).map((c) => (c.status === 'skipped' ? { ...c, status: 'pending' as const, attempts: 0 } : c));
  const allRead = chunks.length > 0 && chunks.every((c) => c.status === 'done');
  await updateVideo(db, row.id, {
    status: allRead && row.lines_json ? 'translating' : chunks.length ? 'transcribing' : 'queued',
    chunks_json: chunks.length ? JSON.stringify(chunks) : null,
    error: null,
    attempts: 0,
    progress: 'Waiting to start…',
  });
}
