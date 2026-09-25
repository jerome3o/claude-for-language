/**
 * Tutor notes on the student's pronunciation recordings — and, through the
 * same endpoint, the tutor's replies to cards the student flagged (kind 'flag').
 *
 * A tutor marks a recording "needs work" with a comment ("second tone, not
 * fourth") from the recordings inbox. The student sees that comment once, as
 * a quiet line under the pinyin on the back of that card, the next time the
 * card comes up in study.
 *
 * Offline-first: the unseen notes are pulled into IndexedDB during sync
 * (`syncRecordingNotes`), the card back reads them locally, and rating the
 * card marks the note seen locally first (`markRecordingNoteSeen`) — the
 * server hears about it right away when online, otherwise on the next sync.
 */

import { db, LocalRecordingNote } from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';

const API_PATH = `${API_BASE}/api`;

export interface ServerRecordingNote {
  event_id: string;
  kind?: 'recording' | 'flag';
  card_id: string | null;
  note_id: string;
  hanzi: string;
  comment: string;
  tutor_name: string | null;
  updated_at: string;
}

async function fetchUnseenNotes(): Promise<ServerRecordingNote[]> {
  const response = await fetch(`${API_PATH}/me/recording-notes`, { headers: getAuthHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch recording notes: ${response.status}`);
  const data = (await response.json()) as { notes?: ServerRecordingNote[] };
  return data.notes || [];
}

async function postSeen(eventId: string): Promise<void> {
  const response = await fetch(`${API_PATH}/me/recording-notes/${encodeURIComponent(eventId)}/seen`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to mark recording note seen: ${response.status}`);
}

/**
 * Push local "seen" marks the server has not heard about yet. Each one is
 * deleted locally once the server confirms it — a seen note never needs to
 * come back.
 */
export async function uploadSeenRecordingNotes(): Promise<{ uploaded: number; uploadedIds: string[]; errors: string[] }> {
  const pending = await db.recordingNotes.where('_synced').equals(0).filter(n => n.seen_at !== null).toArray();
  const uploadedIds: string[] = [];
  const errors: string[] = [];
  for (const note of pending) {
    try {
      await postSeen(note.id);
      await db.recordingNotes.delete(note.id);
      uploadedIds.push(note.id);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { uploaded: uploadedIds.length, uploadedIds, errors };
}

/**
 * Sync: report anything seen offline, then replace the local unseen set with
 * the server's. A local row that is still unseen but no longer on the server
 * (the tutor cleared the mark, or it was seen on another device) is dropped.
 * Rows with a pending "seen" that failed to upload are kept for next time.
 */
export async function syncRecordingNotes(): Promise<{ downloaded: number; uploaded: number }> {
  const { uploaded, uploadedIds } = await uploadSeenRecordingNotes();
  const remote = await fetchUnseenNotes();
  const remoteIds = new Set(remote.map(n => n.event_id));

  await db.transaction('rw', db.recordingNotes, async () => {
    const local = await db.recordingNotes.toArray();
    const stale = local
      .filter(n => n.seen_at === null && !remoteIds.has(n.id))
      .map(n => n.id);
    if (stale.length > 0) await db.recordingNotes.bulkDelete(stale);

    // Never resurrect a note the student already saw here: neither one whose
    // "seen" is still pending, nor one just confirmed (a list fetched from a
    // replica may still include it).
    const seenHere = new Set([
      ...local.filter(n => n.seen_at !== null).map(n => n.id),
      ...uploadedIds,
    ]);
    const rows: LocalRecordingNote[] = remote
      .filter(n => !seenHere.has(n.event_id))
      .map(n => ({
        id: n.event_id,
        kind: n.kind ?? 'recording',
        card_id: n.card_id,
        note_id: n.note_id,
        hanzi: n.hanzi,
        comment: n.comment,
        tutor_name: n.tutor_name,
        updated_at: n.updated_at,
        seen_at: null,
        _synced: 1,
      }));
    if (rows.length > 0) await db.recordingNotes.bulkPut(rows);
  });

  return { downloaded: remote.length, uploaded };
}

/**
 * The unseen tutor notes for one card, newest first (usually zero or one).
 * A recording mark belongs to the card it was recorded on; a reply to a
 * flagged card shows on any card of that word.
 */
export async function getUnseenRecordingNotesForCard(cardId: string, noteId?: string): Promise<LocalRecordingNote[]> {
  const byCard = await db.recordingNotes.where('card_id').equals(cardId).toArray();
  const byNote = noteId ? await db.recordingNotes.where('note_id').equals(noteId).toArray() : [];
  const seen = new Set(byCard.map(n => n.id));
  const rows = [...byCard, ...byNote.filter(n => n.kind === 'flag' && !seen.has(n.id))];
  return rows
    .filter(n => n.seen_at === null)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

/**
 * The student has seen the note (the card was rated with it on screen).
 * Local first so it never shows twice; the server is told immediately when
 * online, otherwise by the next sync.
 */
export async function markRecordingNoteSeen(eventId: string): Promise<void> {
  const existing = await db.recordingNotes.get(eventId);
  if (!existing || existing.seen_at !== null) return;
  await db.recordingNotes.update(eventId, { seen_at: new Date().toISOString(), _synced: 0 });
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await postSeen(eventId);
      await db.recordingNotes.delete(eventId);
    } catch {
      // Offline or flaky — uploadSeenRecordingNotes() retries on the next sync.
    }
  }
}
