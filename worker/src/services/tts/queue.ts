/**
 * `tts-queue` (docs/AUDIO.md): every background TTS clip, one per message, and
 * the backfill pump. Consumer: small batches, max_concurrency 2 (wrangler.toml).
 *
 * A rate limit is never retried inside a delivery: the message is acked and
 * sent again with a delay (60 s after MiniMax's own 1002 / 429, the limiter's
 * wait otherwise), so Queues' retry budget is only spent on real crashes.
 */
import type { Env } from '../../types';
import type { TtsPriority } from './bucket';
import { ensureClip, type ClipResult, type ClipTarget, type TtsFn } from './clips';
import { priorityUserIds, selectBackfill } from './backfill';
import { LIMITER_NAME } from './limiter';
import { storedClipPolicy } from './config';

export type TtsQueueMessage =
  | { kind: 'clip'; target: ClipTarget; priority: TtsPriority; force?: boolean; attempt?: number }
  | { kind: 'pump'; token: string; night?: boolean };

/** A clip rate-limited this many times is left to the backfill. */
export const MAX_CLIP_REQUEUES = 60;
export const PUMP_LEASE_MS = 3 * 60_000;
/** Clips one pump delivery picks; worked by PUMP_WORKERS at once, paced by the limiter. */
export const PUMP_PICK = 9;
export const PUMP_WORKERS = 3;
/** A pump delivery stops picking new clips after this long. */
export const PUMP_TICK_MS = 40_000;
/** The pump waits for a batch slot at most this long per clip (it is the pacing). */
export const PUMP_SLOT_WAIT_MS = 20_000;

/**
 * A batch clip told to wait by our own limiter comes back no sooner than this
 * (+ up to the same again, jittered). Hundreds of queued sentence-set clips
 * each retrying after the limiter's few-second wait asked it ~260 times a
 * minute for 9 tokens (Azure, Oct 2026) and gave up after MAX_CLIP_REQUEUES in
 * minutes; spread out, they still use every batch token and keep their place.
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
  opts: { priority?: TtsPriority; force?: boolean; delaySeconds?: number; attempt?: number } = {},
): Promise<boolean> {
  try {
    const body: TtsQueueMessage = { kind: 'clip', target, priority: opts.priority ?? 'batch', force: opts.force, attempt: opts.attempt };
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

function limiter(env: Env) {
  return env.TTS_LIMITER ? env.TTS_LIMITER.get(env.TTS_LIMITER.idFromName(LIMITER_NAME)) : null;
}

export async function handleClipMessage(env: Env, msg: Extract<TtsQueueMessage, { kind: 'clip' }>, tts?: TtsFn): Promise<ClipResult> {
  const result = await ensureClip(env, msg.target, {
    priority: msg.priority,
    // Someone tapped / made it: wait a little for a slot. Batch: never.
    maxWaitMs: msg.priority === 'interactive' ? 3_000 : 0,
    force: msg.force,
    tts,
  });
  if (result.status === 'rate_limited') {
    const attempt = (msg.attempt ?? 0) + 1;
    if (attempt <= MAX_CLIP_REQUEUES) {
      await enqueueClip(env, msg.target, {
        priority: msg.priority,
        force: msg.force,
        attempt,
        delaySeconds: requeueDelaySeconds(result.retryAfterMs, result.minimax, msg.priority),
      });
    } else {
      console.warn('[tts-queue] giving up requeueing (the backfill will find it):', msg.target);
    }
  }
  return result;
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
      const result = await ensureClip(env, item, { priority: 'batch', maxWaitMs: PUMP_SLOT_WAIT_MS, tts, policy });
      if (result.status === 'rate_limited') {
        stop = { delaySeconds: requeueDelaySeconds(result.retryAfterMs, result.minimax) };
      } else if (result.status === 'failed') failed++;
      else if (result.status === 'generated' || result.status === 'copied') made++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUMP_WORKERS, items.length) }, worker));

  const delaySeconds = stop ? (stop as { delaySeconds: number }).delaySeconds : 0;
  const body: TtsQueueMessage = { kind: 'pump', token: msg.token, night: msg.night };
  await env.TTS_QUEUE.send(body, delaySeconds ? { delaySeconds } : undefined);
  if (lim) await lim.claimPump(msg.token, PUMP_LEASE_MS + delaySeconds * 1000);
  console.log(JSON.stringify({
    type: 'tts_backfill', picked: items.length, made, failed, rate_limited: !!stop,
    tiers: items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.tier]: (m[i.tier] ?? 0) + 1 }), {}),
  }));
  return { picked: items.length, made, failed, rateLimited: !!stop, next: stop ? 'later' : 'again', delaySeconds };
}

/** The tts-queue consumer. */
export async function handleTtsBatch(batch: MessageBatch<TtsQueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body;
    try {
      if (body.kind === 'clip') {
        const result = await handleClipMessage(env, body);
        if (result.status !== 'current') console.log('[tts-queue] clip', body.target.kind, body.target.id, result.status);
      } else if (body.kind === 'pump') {
        await runPumpTick(env, body);
      }
      message.ack();
    } catch (err) {
      console.error('[tts-queue] message crashed:', body, err);
      message.retry({ delaySeconds: 30 });
    }
  }
}
