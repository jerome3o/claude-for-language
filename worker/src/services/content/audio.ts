/**
 * Audio side effects for notes: the word clip, the example sentence's clip,
 * background sentence sets, and R2 clean-up that respects clips shared
 * between a tutor's note and the student's copy.
 */
import type { Env } from '../../types';
import * as db from '../../db/queries';
import type { TtsPriority } from '../tts/bucket';
import { ensureClip, type ClipKind, type ClipResult, type TtsFn } from '../tts/clips';
import { enqueueClip } from '../tts/queue';
import { INTERACTIVE_MAX_WAIT_MS } from '../tts/limiter';

export { audioKeyOf, deleteUnreferencedAudio } from '../tts/clips';
import { audioKeyOf } from '../tts/clips';

function ttsConfigured(env: Env): boolean {
  return !!env.MINIMAX_API_KEY;
}

/**
 * Store a note's word clip made outside the clip worker (an admin's custom voice
 * / speed) and hand it to every student copy that has none. No signature, so the
 * backfill brings it back to the current settings later.
 */
export async function setNoteAudio(env: Env, noteId: string, audioKey: string, provider: 'minimax' | 'azure' | 'gtts', prov: { voice?: string; model?: string } = {}): Promise<void> {
  await db.updateNote(env.DB, noteId, { audioUrl: audioKey, audioProvider: provider });
  await env.DB
    .prepare('UPDATE notes SET audio_voice = ?, audio_model = ?, audio_settings = NULL WHERE id = ?')
    .bind(prov.voice ?? null, prov.model ?? null, noteId)
    .run();
  await db.propagateNoteAudioToSharedCopies(env.DB, noteId);
}

/**
 * One clip now, for someone who is waiting (a card just made / edited, a tap):
 * interactive priority; when MiniMax (or our limiter) says not now, or a
 * transient failure, the clip goes to tts-queue instead of being lost.
 */
async function clipNowOrQueue(
  env: Env,
  kind: ClipKind,
  noteId: string,
  opts: { force?: boolean; priority?: TtsPriority; maxWaitMs?: number; onlyMissing?: boolean; brokenKeys?: Set<string>; tts?: TtsFn } = {},
): Promise<ClipResult & { queued?: boolean }> {
  const priority = opts.priority ?? 'interactive';
  const result = await ensureClip(env, { kind, id: noteId }, {
    priority,
    maxWaitMs: opts.maxWaitMs ?? (priority === 'interactive' ? INTERACTIVE_MAX_WAIT_MS : 0),
    force: opts.force,
    onlyMissing: opts.onlyMissing,
    brokenKeys: opts.brokenKeys,
    tts: opts.tts,
  });
  if (result.status === 'rate_limited' || (result.status === 'failed' && !result.permanent)) {
    const delaySeconds = result.status === 'rate_limited' && result.minimax ? 60 : 5;
    const queued = await enqueueClip(env, { kind, id: noteId }, { priority, force: opts.force, delaySeconds });
    return { ...result, queued };
  }
  return result;
}

const made = (r: ClipResult) => r.status === 'generated' || r.status === 'copied';

/** Make sure a note has a current word clip (`force`: a changed hanzi). True when one was stored now. */
export async function ensureNoteAudio(env: Env, noteId: string, options: { force?: boolean; priority?: TtsPriority } = {}): Promise<boolean> {
  if (!ttsConfigured(env)) return false;
  try {
    return made(await clipNowOrQueue(env, 'word', noteId, options));
  } catch (error) {
    console.error('[note-audio] Failed for note', noteId, error);
    return false;
  }
}

/**
 * Give a note's own example sentence its audio. The clue is written by paths
 * that don't generate TTS themselves; without this the ▶ next to it is silent.
 */
export async function ensureSentenceClueAudio(env: Env, noteId: string, options: { force?: boolean; priority?: TtsPriority } = {}): Promise<boolean> {
  if (!ttsConfigured(env)) return false;
  try {
    return made(await clipNowOrQueue(env, 'clue', noteId, options));
  } catch (error) {
    console.error('[clue-audio] Failed for note', noteId, error);
    return false;
  }
}

/** What `ensureNoteClips` did with one clip. `none` = no sentence to voice; `queued` = it is coming. */
export type ClipOutcome = 'ok' | 'copied' | 'generated' | 'queued' | 'failed' | 'none';

export interface EnsureNoteClipsResult {
  word: ClipOutcome;
  sentence: ClipOutcome;
}

/** At most this many client-reported broken keys are checked per call. */
export const MAX_BROKEN_KEYS = 4;

function outcomeOf(r: ClipResult & { queued?: boolean }): ClipOutcome {
  switch (r.status) {
    case 'current':
      return 'ok';
    case 'generated':
    case 'copied':
    case 'none':
      return r.status;
    case 'gone':
      return 'failed';
    default:
      return r.queued ? 'queued' : 'failed';
  }
}

/**
 * `POST /api/notes/:id/ensure-audio`: make sure a note's word clip and its example
 * sentence's clip exist — the web study card and the Lab app call it when a card
 * shows up silent (or a clip 404s) and, ahead of time, for the upcoming queue.
 * Idempotent: a clip that is there is left alone (the backfill upgrades old ones),
 * so repeating the call costs a lookup. A student's copy takes the tutor's clip.
 * When MiniMax is busy the clip is queued at interactive priority (`queued`).
 */
export async function ensureNoteClips(
  env: Env,
  noteId: string,
  options: { broken?: string[]; maxWaitMs?: number } = {},
  tts?: TtsFn,
): Promise<EnsureNoteClipsResult> {
  const note = await db.getNoteByIdUnscoped(env.DB, noteId);
  if (!note) return { word: 'failed', sentence: 'failed' };
  const brokenKeys = new Set((options.broken ?? []).slice(0, MAX_BROKEN_KEYS).map(audioKeyOf));
  const opts = { onlyMissing: true, brokenKeys, maxWaitMs: options.maxWaitMs ?? 6_000, tts };
  const word = outcomeOf(await clipNowOrQueue(env, 'word', noteId, opts));
  const sentence = note.sentence_clue?.trim() ? outcomeOf(await clipNowOrQueue(env, 'clue', noteId, opts)) : 'none';
  return { word, sentence };
}

/** Word clip + sentence clip for one note, in that order. What every create path runs. */
export async function generateNoteAudioNow(env: Env, noteId: string, options: { force?: boolean } = {}): Promise<void> {
  await ensureNoteAudio(env, noteId, options);
  await ensureSentenceClueAudio(env, noteId, { force: options.force });
}

/** Queue the word clip (+ sentence clip) for a note: bulk imports, MCP batches. Best-effort. */
export async function enqueueNoteAudio(env: Env, noteId: string): Promise<void> {
  await enqueueClip(env, { kind: 'word', id: noteId }, { priority: 'batch' });
  await enqueueClip(env, { kind: 'clue', id: noteId }, { priority: 'batch' });
}

/** Queue a note's clue clip. Best-effort. */
export async function enqueueClueAudio(env: Env, noteId: string, options: { force?: boolean } = {}): Promise<void> {
  await enqueueClip(env, { kind: 'clue', id: noteId }, { priority: 'batch', force: options.force });
}

/**
 * Queue a note for background sentence-set generation.
 * Best-effort: a failure here just means the set gets made on demand instead.
 */
export async function enqueueSentenceSet(env: Env, noteId: string, count?: number): Promise<void> {
  try {
    // Send first, mark second: a job marked 'queued' is skipped by future
    // sweeps, so marking a send that never happened would starve the note.
    await env.SENTENCE_SET_QUEUE.send({ noteId, count });
    await db.markSentenceSetJobQueued(env.DB, noteId);
  } catch (error) {
    console.error('[sentence-set] Failed to enqueue note', noteId, error);
  }
}
