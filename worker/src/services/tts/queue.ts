/**
 * `tts-queue` (docs/AUDIO.md): every background TTS clip, one per message, and
 * the backfill pump. Consumer: small batches, max_concurrency 2 (wrangler.toml).
 *
 * A rate limit is never retried inside a delivery, and a refused clip never polls
 * (docs/AUDIO.md "Queue churn"):
 * - a BATCH clip the backfill would find by itself (missing / old settings) is
 *   simply left to it — the message is acked and the pump nudged. The pump is the
 *   one paced producer of stored clips;
 * - any other refused clip (an interactive one, a forced remake, an edited text)
 *   comes back when its slot is: a batch message books its place in the
 *   limiter's line and is requeued with that slot as the delay (and its ticket),
 *   an interactive one after the limiter's wait — three times at most, then it is
 *   treated as batch (nobody is waiting for it any more).
 * Before (Oct 2026): every refused clip came back 30–60 s later up to 60 times —
 * ~250k messages and ~525k limiter calls a day for ~19k clips.
 */
import type { Env } from '../../types';
import type { TtsPriority } from './bucket';
import type { TtsTicket } from '../audio';
import { ensureClip, type ClipResult, type ClipTarget, type TtsFn } from './clips';
import { priorityUserIds, selectBackfill } from './backfill';
import { LIMITER_NAME } from './limiter';
import { storedClipPolicy } from './config';
import { runLessonAudioJob, type LessonAudioMessage } from '../lesson-audio';

export type TtsQueueMessage =
  | { kind: 'clip'; target: ClipTarget; priority: TtsPriority; force?: boolean; attempt?: number; ticket?: TtsTicket }
  | { kind: 'pump'; token: string; night?: boolean }
  /** A mini lesson's practice clips into R2 tts-cache/ (services/lesson-audio.ts). */
  | LessonAudioMessage;

/** A clip rate-limited this many times is left to the backfill. */
export const MAX_CLIP_REQUEUES = 60;
/** An interactive clip refused this many times is treated as batch: nobody is waiting any more. */
export const INTERACTIVE_REQUEUES = 3;
export const PUMP_LEASE_MS = 3 * 60_000;
/** Clips one pump delivery picks; worked by PUMP_WORKERS at once, paced by the limiter. */
export const PUMP_PICK = 9;
export const PUMP_WORKERS = 3;
/** A pump delivery stops picking new clips after this long. */
export const PUMP_TICK_MS = 40_000;
/** The pump waits for a batch slot at most this long per clip (it is the pacing). */
export const PUMP_SLOT_WAIT_MS = 20_000;
/** A pump tick that made nothing (every pick current / failed) waits this long before the next. */
export const PUMP_IDLE_DELAY_SECONDS = 30;
/** Queues' longest delay. */
export const MAX_QUEUE_DELAY_SECONDS = 12 * 3600;
/** One isolate nudges the pump at most this often (dropped clips nudge it). */
export const PUMP_NUDGE_EVERY_MS = 60_000;

/**
 * A batch clip told to wait by our own limiter WITHOUT a booking comes back no
 * sooner than this (+ up to the same again, jittered).
 */
export const BATCH_REQUEUE_MIN_SECONDS = 30;

export function requeueDelaySeconds(retryAfterMs: number, minimax: boolean, priority: TtsPriority = 'interactive', random: () => number = Math.random): number {
  if (minimax) return 60;
  const wait = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (priority === 'batch') return Math.min(300, Math.max(wait, BATCH_REQUEUE_MIN_SECONDS + Math.floor(random() * BATCH_REQUEUE_MIN_SECONDS)));
  return Math.min(300, wait);
}

export async function enqueueClip(
  env: Pick<Env, 'TTS_QUEUE'>,
  target: ClipTarget,
  opts: { priority?: TtsPriority; force?: boolean; delaySeconds?: number; attempt?: number; ticket?: TtsTicket } = {},
): Promise<boolean> {
  try {
    const body: TtsQueueMessage = {
      kind: 'clip', target, priority: opts.priority ?? 'batch', force: opts.force, attempt: opts.attempt,
      ...(opts.ticket ? { ticket: opts.ticket } : {}),
    };
    await env.TTS_QUEUE.send(body, opts.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined);
    return true;
  } catch (err) {
    console.error('[tts-queue] enqueue failed', target, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Word clip + example sentence clip of a note. */
export async function enqueueNoteClips(env: Pick<Env, 'TTS_QUEUE'>, noteId: string, opts: { priority?: TtsPriority; force?: boolean; delaySeconds?: number } = {}): Promise<void> {
  await enqueueClip(env, { kind: 'word', id: noteId }, opts);
  await enqueueClip(env, { kind: 'clue', id: noteId }, opts);
}

/** Start (or nudge) the backfill pump. A pump already holding the lease makes this a no-op. */
export async function startPump(env: Pick<Env, 'TTS_QUEUE'>, opts: { night?: boolean } = {}): Promise<void> {
  const body: TtsQueueMessage = { kind: 'pump', token: crypto.randomUUID(), night: opts.night };
  await env.TTS_QUEUE.send(body);
}

let lastNudge = 0;

/** Tests: forget when this isolate last nudged the pump. */
export function resetPumpNudge(): void {
  lastNudge = 0;
}

/** A dropped clip: make sure the pump runs (at most one nudge a minute per isolate). */
export async function nudgePump(env: Pick<Env, 'TTS_QUEUE'>, now = Date.now()): Promise<boolean> {
  if (now - lastNudge < PUMP_NUDGE_EVERY_MS) return false;
  lastNudge = now;
  try {
    await startPump(env);
    return true;
  } catch (err) {
    console.error('[tts-queue] pump nudge failed', err instanceof Error ? err.message : err);
    return false;
  }
}

function limiter(env: Env) {
  return env.TTS_LIMITER ? env.TTS_LIMITER.get(env.TTS_LIMITER.idFromName(LIMITER_NAME)) : null;
}

export type ClipMessageOutcome = ClipResult & { queued?: 'requeued' | 'left_to_backfill' | 'gave_up' };

export async function handleClipMessage(env: Env, msg: Extract<TtsQueueMessage, { kind: 'clip' }>, tts?: TtsFn): Promise<ClipMessageOutcome> {
  const attempt = (msg.attempt ?? 0) + 1;
  // A tap that has waited through three refusals: nobody is looking at it any more.
  const priority: TtsPriority = msg.priority === 'interactive' && attempt <= INTERACTIVE_REQUEUES ? 'interactive' : 'batch';
  const result = await ensureClip(env, msg.target, {
    priority,
    // Someone tapped / made it: wait a little for a slot. Batch: never (it books instead).
    maxWaitMs: priority === 'interactive' ? 3_000 : 0,
    force: msg.force,
    tts,
    requeue: priority === 'batch',
    ticket: msg.ticket ?? null,
  });
  if (result.status !== 'rate_limited') return result;

  if (priority === 'batch' && result.backfill) {
    // The backfill finds this clip by itself, in priority order, at the limiter's pace.
    await nudgePump(env);
    return { ...result, queued: 'left_to_backfill' };
  }
  if (attempt > MAX_CLIP_REQUEUES) {
    console.warn('[tts-queue] giving up requeueing (the backfill will find it):', msg.target);
    return { ...result, queued: 'gave_up' };
  }
  const delaySeconds = result.ticket
    ? Math.min(MAX_QUEUE_DELAY_SECONDS, Math.max(1, Math.ceil(result.retryAfterMs / 1000)))
    : requeueDelaySeconds(result.retryAfterMs, result.minimax, priority);
  await enqueueClip(env, msg.target, {
    priority: msg.priority,
    force: msg.force,
    attempt,
    delaySeconds,
    ...(result.ticket ? { ticket: result.ticket } : {}),
  });
  return { ...result, queued: 'requeued' };
}

export interface PumpTickResult {
  picked: number;
  made: number;
  failed: number;
  rateLimited: boolean;
  next: 'again' | 'later' | 'done' | 'not_mine';
  delaySeconds: number;
}

/** One delivery of the backfill pump: pick the next clips, make them, send itself again. */
export async function runPumpTick(env: Env, msg: Extract<TtsQueueMessage, { kind: 'pump' }>, tts?: TtsFn, now = () => Date.now()): Promise<PumpTickResult> {
  const lim = limiter(env);
  if (lim && !(await lim.claimPump(msg.token, PUMP_LEASE_MS))) {
    return { picked: 0, made: 0, failed: 0, rateLimited: false, next: 'not_mine', delaySeconds: 0 };
  }
  const started = now();
  const policy = await storedClipPolicy(env);
  if (policy.order.length === 0) {
    // No provider may make stored clips (none configured / all disabled): don't burn the clips' attempts.
    if (lim) await lim.releasePump(msg.token);
    console.warn(JSON.stringify({ type: 'tts_backfill', event: 'no_provider' }));
    return { picked: 0, made: 0, failed: 0, rateLimited: false, next: 'done', delaySeconds: 0 };
  }
  const userIds = await priorityUserIds(env.DB, env.ADMIN_EMAIL, started);
  const items = await selectBackfill(env.DB, { now: started, limit: PUMP_PICK, userIds, acceptableHashes: policy.acceptableHashes });
  if (items.length === 0) {
    if (lim) await lim.releasePump(msg.token);
    console.log(JSON.stringify({ type: 'tts_backfill', event: 'done' }));
    return { picked: 0, made: 0, failed: 0, rateLimited: false, next: 'done', delaySeconds: 0 };
  }

  let next = 0;
  let made = 0;
  let failed = 0;
  let stop: { delaySeconds: number } | null = null;
  const worker = async () => {
    while (!stop && next < items.length && now() - started < PUMP_TICK_MS) {
      const item = items[next++];
      // A worker that waits books its slot in the limiter's line and sleeps until it.
      const result = await ensureClip(env, item, { priority: 'batch', maxWaitMs: PUMP_SLOT_WAIT_MS, tts, policy });
      if (result.status === 'rate_limited') {
        stop = { delaySeconds: requeueDelaySeconds(result.retryAfterMs, result.minimax) };
      } else if (result.status === 'failed') failed++;
      else if (result.status === 'generated' || result.status === 'copied') made++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUMP_WORKERS, items.length) }, worker));

  // Never faster than the clips come: a tick that made nothing (all current / failing) rests a while.
  const delaySeconds = stop ? (stop as { delaySeconds: number }).delaySeconds : made === 0 ? PUMP_IDLE_DELAY_SECONDS : 0;
  const body: TtsQueueMessage = { kind: 'pump', token: msg.token, night: msg.night };
  await env.TTS_QUEUE.send(body, delaySeconds ? { delaySeconds } : undefined);
  if (lim) await lim.claimPump(msg.token, PUMP_LEASE_MS + delaySeconds * 1000);
  console.log(JSON.stringify({
    type: 'tts_backfill', picked: items.length, made, failed, rate_limited: !!stop,
    tiers: items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.tier]: (m[i.tier] ?? 0) + 1 }), {}),
  }));
  return { picked: items.length, made, failed, rateLimited: !!stop, next: stop ? 'later' : 'again', delaySeconds };
}

/**
 * The tts-queue consumer. ONE log line per batch with the counts (it used to be a
 * line per refused clip — a few hundred thousand a day of Workers Logs).
 */
export async function handleTtsBatch(batch: MessageBatch<TtsQueueMessage>, env: Env): Promise<void> {
  const counts: Record<string, number> = {};
  const bump = (k: string) => void (counts[k] = (counts[k] ?? 0) + 1);
  for (const message of batch.messages) {
    const body = message.body;
    try {
      if (body.kind === 'clip') {
        const result = await handleClipMessage(env, body);
        bump(result.status === 'rate_limited' ? `rate_limited_${result.queued ?? 'requeued'}` : result.status);
        if (result.status === 'failed') console.warn('[tts-queue] clip failed', body.target.kind, body.target.id, result.reason);
      } else if (body.kind === 'pump') {
        await runPumpTick(env, body);
        bump('pump');
      } else if (body.kind === 'lesson_audio') {
        const run = await runLessonAudioJob(env, body);
        bump(`lesson_audio_${run.next}`);
        if (run.made > 0 || run.failed > 0) console.log('[tts-queue] lesson audio', body.lesson_id, JSON.stringify(run));
      }
      message.ack();
    } catch (err) {
      console.error('[tts-queue] message crashed:', body, err);
      bump('crashed');
      message.retry({ delaySeconds: 30 });
    }
  }
  const quiet = Object.keys(counts).every((k) => k === 'current' || k === 'pump' || k.startsWith('rate_limited_') || k === 'lesson_audio_rate_limited' || k === 'lesson_audio_continue');
  // Only the batches that did something worth reading; the rest are counted by the limiter's minute log.
  if (!quiet) console.log(JSON.stringify({ type: 'tts_queue', ...counts }));
}
