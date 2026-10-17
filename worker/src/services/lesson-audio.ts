/**
 * A mini lesson's clips made ahead of time (docs/AUDIO.md "Lesson audio prefetch").
 *
 * Both apps fetch every clip a lesson can play (`lessonAudioClips`, shared/lesson/audioClips.ts)
 * from `POST /api/practice/tts` when they sync and when the lesson opens; that route serves R2
 * `tts-cache/` and only calls a TTS provider on a miss (seconds). So when a lesson row is
 * written — created, assigned (a student's copy), updated or pushed — its clips are queued on
 * `tts-queue` (`{ kind: 'lesson_audio' }`) and made at BATCH priority through the same
 * limiter, for the lesson's owner: the default-voice texts plus each conversation line in the
 * owner's voices / speed / delivery (`resolveConversationAudio` with their stored preferences
 * — what their device resolves). A device's fetch is then an R2 hit.
 *
 * A delivery re-reads the lesson (an edit since is followed; a deleted lesson ends it), skips
 * clips already in R2, works ~40 s, and sends itself again for the rest; a rate limit puts it
 * back with a delay (at most MAX_ATTEMPTS times). It never fails a lesson write.
 */
import type { Env } from '../types';
import { distinctLessonClips, resolveConversationAudio, type CustomLessonSpec, type LessonAudioClip } from '@shared/lesson';
import { ensurePracticeClip, type PracticeClipStatus } from './tts-cache';
import { conversationAudioSource, getConversationAudioPrefs } from './conversation-audio';
import { getConversationVoiceSettings } from './conversation-voices';

export interface LessonAudioMessage {
  kind: 'lesson_audio';
  lesson_id: string;
  /** Rate-limited deliveries so far. */
  attempt?: number;
}

/** A lesson put back this many times after a rate limit is left to the devices. */
export const LESSON_AUDIO_MAX_ATTEMPTS = 20;
/** A delivery stops starting new clips after this long and sends itself again. */
export const LESSON_AUDIO_TICK_MS = 40_000;

/** Queue the pre-generation of a lesson's clips. Never throws (a lesson write must not fail over audio). */
export async function queueLessonAudio(env: Partial<Pick<Env, 'TTS_QUEUE'>>, lessonId: string, opts: { attempt?: number; delaySeconds?: number } = {}): Promise<boolean> {
  if (!env.TTS_QUEUE) return false;
  try {
    const body: LessonAudioMessage = { kind: 'lesson_audio', lesson_id: lessonId, ...(opts.attempt ? { attempt: opts.attempt } : {}) };
    await env.TTS_QUEUE.send(body, opts.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined);
    return true;
  } catch (err) {
    console.error('[lesson-audio] enqueue failed', lessonId, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Every distinct clip of `spec` as its owner's devices will ask for it. */
export async function lessonClipsForUser(env: Env, userId: string, spec: CustomLessonSpec): Promise<LessonAudioClip[]> {
  const hasConversation = spec.sections.some((s) => s.exercises.some((e) => e.type === 'conversation'));
  if (!hasConversation) return distinctLessonClips(spec);
  const [prefs, source, voices] = await Promise.all([
    getConversationAudioPrefs(env.DB, userId),
    conversationAudioSource(env),
    getConversationVoiceSettings(env.DB, userId).catch(() => null),
  ]);
  const ctx = { provider: source.provider, default_speed: source.default_speed, enabled: voices?.enabled ?? null, prefs };
  return distinctLessonClips(spec, (ex) => resolveConversationAudio(ex, ctx));
}

export type EnsureClip = (env: Env, clip: LessonAudioClip) => Promise<PracticeClipStatus>;

/**
 * Waits up to this long for a batch slot per clip (it books its place in the limiter's
 * line and sleeps), so a delivery makes clips at the limiter's pace instead of giving up
 * on the first refusal and coming back a minute later.
 */
export const LESSON_AUDIO_SLOT_WAIT_MS = 15_000;

const defaultEnsure: EnsureClip = (env, clip) =>
  clip.kind === 'conversation'
    ? ensurePracticeClip(env, clip.text, { voiceId: clip.voice, conversation: { speed: clip.speed, delivery: clip.delivery }, maxWaitMs: LESSON_AUDIO_SLOT_WAIT_MS })
    : ensurePracticeClip(env, clip.text, { maxWaitMs: LESSON_AUDIO_SLOT_WAIT_MS });

export interface LessonAudioRun {
  clips: number;
  made: number;
  cached: number;
  failed: number;
  next: 'done' | 'continue' | 'rate_limited' | 'gave_up' | 'gone';
}

export async function runLessonAudioJob(
  env: Env,
  msg: LessonAudioMessage,
  deps: { ensure?: EnsureClip; now?: () => number; clipsFor?: typeof lessonClipsForUser } = {},
): Promise<LessonAudioRun> {
  const ensure = deps.ensure ?? defaultEnsure;
  const now = deps.now ?? (() => Date.now());
  const run: LessonAudioRun = { clips: 0, made: 0, cached: 0, failed: 0, next: 'done' };
  const row = await env.DB.prepare('SELECT user_id, spec FROM custom_lessons WHERE id = ?').bind(msg.lesson_id).first<{ user_id: string; spec: string }>();
  if (!row) return { ...run, next: 'gone' };
  let spec: CustomLessonSpec;
  try {
    spec = JSON.parse(row.spec) as CustomLessonSpec;
  } catch {
    return { ...run, next: 'gone' };
  }
  const clips = await (deps.clipsFor ?? lessonClipsForUser)(env, row.user_id, spec);
  run.clips = clips.length;
  const started = now();
  for (const clip of clips) {
    if (now() - started > LESSON_AUDIO_TICK_MS) {
      await queueLessonAudio(env, msg.lesson_id, { attempt: msg.attempt });
      return { ...run, next: 'continue' };
    }
    const out = await ensure(env, clip).catch((err): PracticeClipStatus => ({ status: 'failed', reason: err instanceof Error ? err.message : String(err) }));
    if (out.status === 'cached') run.cached++;
    else if (out.status === 'made') run.made++;
    else if (out.status === 'failed') run.failed++;
    else if (out.status === 'rate_limited') {
      const attempt = (msg.attempt ?? 0) + 1;
      if (attempt > LESSON_AUDIO_MAX_ATTEMPTS) return { ...run, next: 'gave_up' };
      await queueLessonAudio(env, msg.lesson_id, { attempt, delaySeconds: Math.min(300, Math.max(60, Math.ceil(out.retryAfterMs / 1000))) });
      return { ...run, next: 'rate_limited' };
    }
  }
  return run;
}
