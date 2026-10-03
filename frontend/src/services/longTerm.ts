/**
 * "Add to my long-term review" — the learner's per-word choice (notes.long_term,
 * shared/decks/long-term.ts), offline-first:
 *
 *   - the choice is written to the local note and to `pendingNotePrefs` at once
 *     (the study queue reads both, so it applies immediately, offline too);
 *   - it goes up with PUT /api/notes/:id/long-term straight away when online,
 *     otherwise during the next sync (`uploadPendingNotePrefs`);
 *   - a sync that writes notes re-applies the pending choices on top
 *     (`applyPendingNotePrefs`), so a download racing an un-uploaded choice
 *     never flips the switch back.
 */
import { db, type LocalPendingNotePref } from '../db/database';
import { apiErrorStatus, setNoteLongTermRemote } from '../api/client';
import type { LongTermPref } from '@shared/decks';
import { track } from './analytics';

async function upload(p: LocalPendingNotePref): Promise<void> {
  try {
    await setNoteLongTermRemote(p.note_id, p.long_term);
  } catch (err) {
    // The note is gone (deleted elsewhere): nothing left to tell the server.
    if (apiErrorStatus(err) !== 404) throw err;
  }
  // A newer choice made while this one was in flight stays queued.
  await db.transaction('rw', db.pendingNotePrefs, async () => {
    const now = await db.pendingNotePrefs.get(p.note_id);
    if (now && now.at === p.at) await db.pendingNotePrefs.delete(p.note_id);
  });
}

/** Record the choice locally and send it (now when online, else on the next sync). */
export async function setNoteLongTerm(noteId: string, longTerm: LongTermPref): Promise<void> {
  const pending: LocalPendingNotePref = { note_id: noteId, long_term: longTerm, at: Date.now() };
  await db.transaction('rw', [db.notes, db.pendingNotePrefs], async () => {
    await db.notes.update(noteId, { long_term: longTerm });
    await db.pendingNotePrefs.put(pending);
  });
  track('study.long_term_toggle', { value: longTerm === null ? 'default' : longTerm ? 'on' : 'off' });
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    upload(pending).catch(() => undefined); // stays queued for the sync
  }
}

/** Sync: send every queued choice; each row is removed once the server has it. */
export async function uploadPendingNotePrefs(): Promise<{ uploaded: number; errors: string[] }> {
  const pending = await db.pendingNotePrefs.toArray();
  let uploaded = 0;
  const errors: string[] = [];
  for (const p of pending) {
    try {
      await upload(p);
      uploaded++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { uploaded, errors };
}

/** Inside a sync transaction that wrote notes (include db.pendingNotePrefs in its scope). */
export async function applyPendingNotePrefs(): Promise<void> {
  const pending = await db.pendingNotePrefs.toArray();
  for (const p of pending) await db.notes.update(p.note_id, { long_term: p.long_term });
}
