/**
 * Audio side effects for notes: the word clip, the example sentence's clip,
 * background sentence sets, and R2 clean-up that respects clips shared
 * between a tutor's note and the student's copy.
 */
import type { Env } from '../../types';
import * as db from '../../db/queries';
import { generateTTS, deleteAudio } from '../audio';

function ttsConfigured(env: Env): boolean {
  return !!(env.GOOGLE_TTS_API_KEY || env.MINIMAX_API_KEY);
}

/** Store a note's word clip and hand it to every student copy that has none. */
export async function setNoteAudio(env: Env, noteId: string, audioKey: string, provider: 'minimax' | 'gtts'): Promise<void> {
  await db.updateNote(env.DB, noteId, { audioUrl: audioKey, audioProvider: provider });
  await db.propagateNoteAudioToSharedCopies(env.DB, noteId);
}

/**
 * Make sure a note has a word clip.
 * - No clip yet: take whatever generateTTS produces (a fallback clip beats silence).
 * - Has a clip: only a MiniMax clip replaces it (this is the Google-fallback sweep),
 *   unless `force` — a changed hanzi needs a new clip whoever makes it.
 * The old clip is removed only after the new one is stored and pointed at.
 */
export async function ensureNoteAudio(env: Env, noteId: string, options: { force?: boolean } = {}): Promise<boolean> {
  if (!ttsConfigured(env)) return false;
  try {
    const note = await db.getNoteByIdUnscoped(env.DB, noteId);
    if (!note) return false;
    if (note.audio_url && !options.force) {
      const result = await generateTTS(env, note.hanzi, noteId);
      if (!result || result.provider !== 'minimax') return false;
      await setNoteAudio(env, noteId, result.audioKey, result.provider);
      await deleteUnreferencedAudio(env, [note.audio_url]);
      return true;
    }
    const result = await generateTTS(env, note.hanzi, noteId);
    if (!result) return false;
    await setNoteAudio(env, noteId, result.audioKey, result.provider);
    if (note.audio_url) await deleteUnreferencedAudio(env, [note.audio_url]);
    return true;
  } catch (error) {
    console.error('[note-audio] Failed for note', noteId, error);
    return false;
  }
}

/**
 * Give a note's own example sentence its audio. The clue is written by paths
 * that don't generate TTS themselves; without this the ▶ next to it is silent.
 */
export async function ensureSentenceClueAudio(env: Env, noteId: string, options: { force?: boolean } = {}): Promise<boolean> {
  if (!ttsConfigured(env)) return false;
  try {
    const note = await db.getNoteByIdUnscoped(env.DB, noteId);
    if (!note?.sentence_clue) return false;
    if (note.sentence_clue_audio_url && !options.force) return false;

    const result = await generateTTS(env, note.sentence_clue, `${noteId}-sentence`);
    if (!result) return false;

    await db.updateNote(env.DB, noteId, {
      sentenceClueAudioUrl: result.audioKey,
      sentenceClueAudioProvider: result.provider,
    });
    // Only once the replacement is stored and pointed at — a failed
    // regeneration must leave the old clip playable.
    if (options.force && note.sentence_clue_audio_url) {
      await deleteUnreferencedAudio(env, [note.sentence_clue_audio_url]);
    }
    return true;
  } catch (error) {
    console.error('[clue-audio] Failed for note', noteId, error);
    return false;
  }
}

/** Word clip + sentence clip for one note, in that order. What every create path runs. */
export async function generateNoteAudioNow(env: Env, noteId: string, options: { force?: boolean } = {}): Promise<void> {
  await ensureNoteAudio(env, noteId, options);
  await ensureSentenceClueAudio(env, noteId);
}

/** Queue the word clip (+ sentence clip) for a note. Best-effort. */
export async function enqueueNoteAudio(env: Env, noteId: string): Promise<void> {
  try {
    await env.SENTENCE_SET_QUEUE.send({ noteId, kind: 'note_audio' });
  } catch (error) {
    console.error('[note-audio] Failed to enqueue note', noteId, error);
  }
}

/** Queue a note for background clue-audio generation. Best-effort. */
export async function enqueueClueAudio(env: Env, noteId: string): Promise<void> {
  try {
    await env.SENTENCE_SET_QUEUE.send({ noteId, kind: 'clue_audio' });
  } catch (error) {
    console.error('[clue-audio] Failed to enqueue note', noteId, error);
  }
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

/**
 * Delete R2 clips that no note, clue or sentence row still points at. A
 * tutor's note and the student's copy share the same keys (shareDeck copies
 * the URL, not the bytes), so a delete must never take the other side's audio.
 */
export async function deleteUnreferencedAudio(env: Env, keys: Array<string | null | undefined>): Promise<number> {
  const wanted = Array.from(new Set(keys.filter((k): k is string => !!k)));
  if (wanted.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < wanted.length; i += 40) {
    const chunk = wanted.slice(i, i + 40);
    const ph = chunk.map(() => '?').join(', ');
    const rows = await env.DB
      .prepare(
        `SELECT audio_url AS k FROM notes WHERE audio_url IN (${ph})
         UNION SELECT sentence_clue_audio_url AS k FROM notes WHERE sentence_clue_audio_url IN (${ph})
         UNION SELECT audio_url AS k FROM note_sentences WHERE audio_url IN (${ph})`
      )
      .bind(...chunk, ...chunk, ...chunk)
      .all<{ k: string }>();
    const referenced = new Set((rows.results || []).map(r => r.k));
    for (const key of chunk) {
      if (referenced.has(key)) continue;
      try {
        await deleteAudio(env.AUDIO_BUCKET, key);
        deleted++;
      } catch (err) {
        console.error('[audio] Failed to delete clip', key, err);
      }
    }
  }
  return deleted;
}
