/**
 * The web's auto-audio (docs/AUDIO.md), the twin of the Lab's NoteAudioFixer:
 * a card that shows up without its clip — or whose clip fails to load — asks
 * the server to make it (`POST /api/notes/:id/ensure-audio`, interactive
 * priority, queued when MiniMax is busy). While a clip is on its way the card
 * says "Audio coming…" instead of reading the word in the device's robotic
 * voice; the device voice stays the last resort for a tap, and offline.
 */
import { ensureNoteAudio, type EnsureClipOutcome, type EnsureNoteAudioResponse } from '../api/client';
import { db } from '../db/database';
import type { Note } from '../types';

/** A note is asked about at most this often… */
export const ENSURE_RETRY_MS = 20_000;
/** …and at most this many times per page load. */
export const ENSURE_MAX_ATTEMPTS = 6;

interface Attempt {
  at: number;
  count: number;
}

export type AudioFields = Pick<Note, 'audio_url' | 'sentence_clue' | 'sentence_clue_audio_url'>;

/** Does this note need the server's help? Missing word clip, a sentence without a clip, or a clip that failed to load. */
export function needsAudio(note: AudioFields, broken: readonly string[] = []): boolean {
  if (!note.audio_url) return true;
  if (note.sentence_clue?.trim() && !note.sentence_clue_audio_url) return true;
  return broken.length > 0;
}

/** Pure throttle: may we ask the server about this note now? */
export function mayAsk(attempts: ReadonlyMap<string, Attempt>, noteId: string, now: number): boolean {
  const a = attempts.get(noteId);
  if (!a) return true;
  return a.count < ENSURE_MAX_ATTEMPTS && now - a.at >= ENSURE_RETRY_MS;
}

/** A clip is on its way (made now, or queued behind MiniMax's rate limit). */
export function isPending(outcome: EnsureClipOutcome): boolean {
  return outcome === 'queued';
}

const attempts = new Map<string, Attempt>();
const brokenByNote = new Map<string, Set<string>>();

/** A stored clip failed to play: remember its key so the next ask reports it. */
export function reportBrokenClip(noteId: string, audioUrl: string): void {
  const set = brokenByNote.get(noteId) ?? new Set<string>();
  set.add(audioUrl);
  brokenByNote.set(noteId, set);
  // A broken clip is worth asking about again straight away.
  const a = attempts.get(noteId);
  if (a) attempts.set(noteId, { ...a, at: 0 });
}

export function brokenClips(noteId: string): string[] {
  return Array.from(brokenByNote.get(noteId) ?? []);
}

/** Test hook. */
export function resetEnsureState(): void {
  attempts.clear();
  brokenByNote.clear();
}

export type EnsureResult = { response: EnsureNoteAudioResponse; patch: Partial<Note> } | null;

/**
 * Ask the server (when allowed by the throttle) and write what came back into
 * IndexedDB, so the clip is there on the next card / offline. Null = not asked.
 */
export async function ensureAudioForNote(note: AudioFields & { id: string }, now = Date.now()): Promise<EnsureResult> {
  const broken = brokenClips(note.id);
  if (!needsAudio(note, broken) || !mayAsk(attempts, note.id, now)) return null;
  const prev = attempts.get(note.id);
  attempts.set(note.id, { at: now, count: (prev?.count ?? 0) + 1 });
  const response = await ensureNoteAudio(note.id, broken);
  brokenByNote.delete(note.id);
  const n = response.note;
  if (!n) return { response, patch: {} };
  const patch: Partial<Note> = {};
  if (n.audio_url && n.audio_url !== note.audio_url) {
    patch.audio_url = n.audio_url;
    patch.audio_provider = n.audio_provider;
  }
  if (n.sentence_clue_audio_url && n.sentence_clue_audio_url !== note.sentence_clue_audio_url) {
    patch.sentence_clue_audio_url = n.sentence_clue_audio_url;
  }
  if (Object.keys(patch).length > 0) {
    await db.notes.update(note.id, { ...patch, updated_at: n.updated_at }).catch(() => 0);
  }
  return { response, patch };
}
