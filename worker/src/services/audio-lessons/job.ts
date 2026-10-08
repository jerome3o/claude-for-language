/**
 * One audio lesson from input to MP3 (docs/AUDIO_LESSONS.md), run on
 * audio-lesson-queue in three phases, each resumable:
 *
 * 1. writing   — the author agent (agent.ts) until submit_lesson is accepted;
 *                the transcript is checkpointed in the row.
 * 2. speaking  — every DISTINCT clip of the script through the TTS providers
 *                (synth.ts), each stored in R2 as it is made (`…/parts/<hash>.mp3`),
 *                so a redelivery or a Retry only makes what is missing. A rate
 *                limit / account pause re-enqueues the job with a delay.
 * 3. rendering — the clips and the pauses joined into ONE MP3 (mp3.ts) with a
 *                Xing seek header; chapters + transcript timed in ms; parts deleted.
 *
 * A delivery that runs past SOFT_DEADLINE_MS re-enqueues itself. Failures are
 * written to the row (status failed + error); Retry resumes from what exists.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  buildTimeline,
  speechChars,
  speechKey,
  uniqueSpeech,
  type AudioLessonInput,
  type AudioLessonScript,
  type AudioLessonUsage,
  type SpeechSegment,
} from '@shared/audio-lesson';
import type { TtsProviderId } from '@shared/tts';
import type { Env } from '../../types';
import * as q from '../../db/audio-lesson-queries';
import { loadTtsConfig } from '../tts/config';
import { trackServer } from '../analytics/server-events';
import { anthropicModelCall, AUDIO_LESSON_MODEL, buildBriefing, claudeCostUsd, runAuthor, type AuthorState, type ModelCall } from './agent';
import { assembleMp3, frameMs, parseMp3Frames, type AssemblyPart } from './mp3';
import { speakClip, type ClipOutcome, type ClipRequest } from './synth';
import { buildVocabIndex } from './vocab';
import { makeCharLinks, type CharLinksFn } from './char-links';
import { assetsShardLoader } from '../char-dict';
import { fakeModelResponse } from './fake';

export interface AudioLessonJobMessage {
  lessonId: string;
}

/** Wall clock per delivery before the job re-enqueues itself. */
export const SOFT_DEADLINE_MS = 4 * 60 * 1000;
/** How long one clip may wait for a limiter slot inside a delivery. */
const SLOT_WAIT_MS = 40_000;
/** A clip that fails (not a rate limit) this many times fails the lesson (Retry starts again). */
const MAX_CLIP_FAILURES = 3;

export type JobOutcome = 'done' | 'continue' | 'waiting' | 'failed' | 'skipped';

export interface JobDeps {
  call?: ModelCall;
  speak?: (clip: ClipRequest, pinned: TtsProviderId | null) => Promise<ClipOutcome>;
  /** Re-enqueue (default: the queue). */
  requeue?: (lessonId: string, delaySeconds: number) => Promise<void>;
  now?: () => number;
}

/** The R2 key of one clip of a lesson. */
export async function partKey(userId: string, lessonId: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${q.audioLessonPartsPrefix(userId, lessonId)}${hex}.mp3`;
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) keys.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function deleteLessonObjects(bucket: R2Bucket, userId: string, lessonId: string, fileKey: string | null): Promise<void> {
  const parts = [...(await listKeys(bucket, q.audioLessonPartsPrefix(userId, lessonId)))];
  for (let i = 0; i < parts.length; i += 500) await bucket.delete(parts.slice(i, i + 500));
  if (fileKey) await bucket.delete(fileKey);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: string } } | undefined;
    const head = error.status === 429 ? 'Claude rate limit' : error.status === 529 ? 'Claude is overloaded' : `Claude API error ${error.status ?? ''}`.trim();
    return body?.error?.message ? `${head}: ${body.error.message.slice(0, 200)}` : head;
  }
  return error instanceof Error ? error.message.slice(0, 300) : 'Something went wrong';
}

function emptyUsage(): AuthorState['usage'] {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

/** Run (or resume) one lesson. Never throws for a lesson problem — it is written to the row. */
export async function runAudioLessonJob(env: Env, lessonId: string, deps: JobDeps = {}): Promise<JobOutcome> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + SOFT_DEADLINE_MS;
  const requeue = deps.requeue ?? (async (id: string, delaySeconds: number) => {
    await env.AUDIO_LESSON_QUEUE.send({ lessonId: id }, delaySeconds > 0 ? { delaySeconds } : undefined);
  });

  let row = await q.getAudioLesson(env.DB, lessonId);
  if (!row || row.status === 'ready' || row.status === 'failed') return 'skipped';
  const input = parseJson<AudioLessonInput>(row.input_json, {});
  const fail = async (reason: string) => {
    await q.patchAudioLesson(env.DB, lessonId, { status: 'failed', error: reason, progress: 'Failed', finished_at: new Date(now()).toISOString() });
    return 'failed' as const;
  };

  try {
    // ---------- 1. writing ----------
    if (!row.script_json) {
      const index = buildVocabIndex(await q.learnerVocabulary(env.DB, row.user_id));
      const charLinks = makeCharLinks(index, env.CHAR_DICT ? assetsShardLoader(env.CHAR_DICT) : null);
      const call = deps.call ?? (env.E2E_TEST_MODE === 'true' ? fakeCall(row.format, charLinks) : env.ANTHROPIC_API_KEY ? anthropicModelCall(env.ANTHROPIC_API_KEY) : null);
      if (!call) return fail('Audio lessons need the Claude key, which is not configured on the server');
      const saved = parseJson<{ messages?: Anthropic.MessageParam[]; usage?: AuthorState['usage'] } | Anthropic.MessageParam[] | null>(row.agent_transcript, null);
      const state: AuthorState = {
        messages: Array.isArray(saved) ? saved : saved?.messages ?? [],
        rounds: row.rounds,
        usage: (!Array.isArray(saved) && saved?.usage) || emptyUsage(),
      };
      if (state.messages.length === 0) {
        state.messages.push({ role: 'user', content: buildBriefing(row.format, input, index, input.title ?? null) });
      }
      await q.patchAudioLesson(env.DB, lessonId, {
        status: 'writing',
        started_at: row.started_at ?? new Date(now()).toISOString(),
        progress: 'Writing the lesson…',
        agent_transcript: { messages: state.messages, usage: state.usage } as unknown as unknown[],
      });
      const out = await runAuthor({
        format: row.format,
        input,
        index,
        state,
        call,
        deadline,
        charLinks,
        checkpoint: (s, progress) => q.patchAudioLesson(env.DB, lessonId, { agent_transcript: { messages: s.messages, usage: s.usage } as unknown as unknown[], rounds: s.rounds, progress }),
      });
      const usage = usageFor(out.state.usage, out.state.rounds, null, null, null);
      if (out.kind === 'failed') {
        await q.patchAudioLesson(env.DB, lessonId, { usage_json: usage });
        return fail(out.reason);
      }
      if (out.kind === 'continue') {
        await requeue(lessonId, 0);
        return 'continue';
      }
      const clips = uniqueSpeech(out.script).length;
      await q.patchAudioLesson(env.DB, lessonId, {
        title: (input.title || out.script.title).slice(0, 120),
        plan_json: out.plan,
        script_json: out.script,
        words_json: out.script.words,
        status: 'speaking',
        progress: `Recording 0 of ${clips} clips…`,
        progress_done: 0,
        progress_total: clips,
        usage_json: usage,
      });
      row = (await q.getAudioLesson(env.DB, lessonId))!;
    }

    const script = JSON.parse(row.script_json!) as AudioLessonScript;
    const priorUsage = parseJson<AudioLessonUsage | null>(row.usage_json, null);

    // ---------- 2. speaking ----------
    const config = await loadTtsConfig(env);
    const unique = uniqueSpeech(script);
    const keys = await Promise.all(unique.map((u) => partKey(row!.user_id, lessonId, u.key)));
    const existing = await listKeys(env.AUDIO_BUCKET, q.audioLessonPartsPrefix(row.user_id, lessonId));
    let done = keys.filter((k) => existing.has(k)).length;
    let pinned = (row.zh_provider as TtsProviderId | null) ?? null;
    let enProvider: TtsProviderId | null = null;
    const speak = deps.speak ?? ((clip: ClipRequest, pin: TtsProviderId | null) => speakClip(env, config, clip, script.speakers, pin, { priority: 'batch', maxWaitMs: SLOT_WAIT_MS }));
    if (row.status !== 'speaking') await q.patchAudioLesson(env.DB, lessonId, { status: 'speaking' });

    for (let i = 0; i < unique.length; i++) {
      if (existing.has(keys[i])) continue;
      const fresh = await q.getAudioLesson(env.DB, lessonId);
      if (!fresh) return 'skipped'; // deleted meanwhile
      if (now() > deadline) {
        await requeue(lessonId, 0);
        return 'continue';
      }
      const u = unique[i];
      let failures = 0;
      for (;;) {
        const res = await speak({ lang: u.lang, voice: u.voice as ClipRequest['voice'], rate: u.rate, text: u.text }, pinned);
        if (res.ok) {
          await env.AUDIO_BUCKET.put(keys[i], res.bytes, { httpMetadata: { contentType: 'audio/mpeg' }, customMetadata: { provider: res.provider, voice: res.voice } });
          done += 1;
          if (u.lang === 'zh' && !pinned) {
            pinned = res.provider;
            await q.patchAudioLesson(env.DB, lessonId, { zh_provider: pinned });
          }
          if (u.lang === 'en') enProvider = res.provider;
          await q.patchAudioLesson(env.DB, lessonId, { progress: `Recording ${done} of ${unique.length} clips…`, progress_done: done });
          break;
        }
        if (res.wait) {
          const delay = Math.min(300, Math.max(10, Math.ceil(res.retryAfterMs / 1000)));
          await q.patchAudioLesson(env.DB, lessonId, { progress: `Recording ${done} of ${unique.length} clips — waiting for the voice service (${res.reason})…` });
          await requeue(lessonId, delay);
          return 'waiting';
        }
        failures += 1;
        if (res.permanent || failures >= MAX_CLIP_FAILURES) return fail(`Couldn't record "${u.text.slice(0, 40)}": ${res.reason}`);
        await new Promise((r) => setTimeout(r, 1500 * failures));
      }
    }

    // ---------- 3. rendering ----------
    await q.patchAudioLesson(env.DB, lessonId, { status: 'rendering', progress: 'Putting the lesson together…', progress_done: unique.length });
    const frames = new Map<string, Uint8Array[]>();
    for (let i = 0; i < unique.length; i++) {
      const obj = await env.AUDIO_BUCKET.get(keys[i]);
      if (!obj) {
        // Lost between speaking and now: go back and make it.
        await requeue(lessonId, 0);
        return 'continue';
      }
      frames.set(unique[i].key, parseMp3Frames(new Uint8Array(await obj.arrayBuffer())).frames);
      if (unique[i].lang === 'en' && !enProvider) enProvider = (obj.customMetadata?.provider as TtsProviderId | undefined) ?? null;
      if (!pinned && unique[i].lang === 'zh') pinned = (obj.customMetadata?.provider as TtsProviderId | undefined) ?? null;
    }
    const parts: AssemblyPart[] = script.segments.map((s) =>
      s.kind === 'pause' ? { kind: 'silence', ms: s.ms } : { kind: 'frames', frames: frames.get(speechKey(s as SpeechSegment))! },
    );
    const assembled = assembleMp3(parts);
    const timeline = buildTimeline(script, new Map([...frames.entries()].map(([k, f]) => [k, f.length])), frameMs(), 1);
    const version = crypto.randomUUID().split('-')[0];
    const fileKey = q.audioLessonFileKey(row.user_id, lessonId, version);
    await env.AUDIO_BUCKET.put(fileKey, assembled.bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
    if (row.audio_key && row.audio_key !== fileKey) await env.AUDIO_BUCKET.delete(row.audio_key).catch(() => {});

    const authorUsage = parseJson<{ usage?: AuthorState['usage'] }>(row.agent_transcript, {}).usage ?? emptyUsage();
    const usage = usageFor(authorUsage, row.rounds, script, pinned, enProvider ?? priorUsage?.en_provider ?? null);
    await q.patchAudioLesson(env.DB, lessonId, {
      status: 'ready',
      progress: 'Ready',
      error: null,
      audio_key: fileKey,
      duration_ms: timeline.duration_ms,
      size_bytes: assembled.bytes.length,
      timeline_json: { chapters: timeline.chapters, transcript: timeline.transcript },
      usage_json: usage,
      finished_at: new Date(now()).toISOString(),
    });
    // The clips are in the file now.
    const partKeys = [...(await listKeys(env.AUDIO_BUCKET, q.audioLessonPartsPrefix(row.user_id, lessonId)))];
    for (let i = 0; i < partKeys.length; i += 500) await env.AUDIO_BUCKET.delete(partKeys.slice(i, i + 500));
    await trackServer('server.audio_lesson_built', { format: row.format, minutes: Math.round(timeline.duration_ms / 60000), clips: unique.length }, { env, userId: row.user_id });
    return 'done';
  } catch (error) {
    console.error('[audio-lesson] job failed', lessonId, error);
    return fail(describeError(error));
  }
}

export function usageFor(author: AuthorState['usage'], rounds: number, script: AudioLessonScript | null, zh: string | null, en: string | null): AudioLessonUsage {
  const chars = script ? speechChars(script) : { zh: 0, en: 0, clips: 0 };
  return {
    model: AUDIO_LESSON_MODEL,
    input_tokens: author.input_tokens + author.cache_creation_input_tokens,
    output_tokens: author.output_tokens,
    cache_read_input_tokens: author.cache_read_input_tokens,
    rounds,
    tts_chars_zh: chars.zh,
    tts_chars_en: chars.en,
    tts_clips: chars.clips,
    zh_provider: zh,
    en_provider: en,
    claude_usd: claudeCostUsd(author),
  };
}

/** E2E: the fake model answers with the sample plan at once. */
function fakeCall(format: 'dialogue' | 'sleep', charLinks: CharLinksFn): ModelCall {
  return async () => (await fakeModelResponse(format, undefined, charLinks)) as unknown as Awaited<ReturnType<ModelCall>>;
}

