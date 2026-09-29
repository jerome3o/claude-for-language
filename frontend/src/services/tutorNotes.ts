/**
 * The student's "Notes from your tutor" (Home row + /tutor-notes page), offline-first.
 *
 * Two local sources, merged by the shared `mergeTutorNotes`:
 *  - `recordingNotes` — the unseen feed the card back reads (services/recording-notes.ts). It
 *    decides what is NEW, and "seen" lands there first (card back or this page).
 *  - `tutorNotes` — every note, seen ones too, from GET /api/me/tutor-notes?include_seen=1
 *    (first 200, replaced by each sync), so the page lists earlier notes on the train.
 * Pinyin / meaning missing from a row (a note that arrived after the last full fetch) come from
 * the local note.
 */

import { mergeTutorNotes, type TutorNote, type TutorNotesList, type UnseenTutorNote } from '@shared/tutor-notes';
import { API_BASE, getAuthHeaders } from '../api/client';
import { db, type LocalRecordingNote } from '../db/database';
import { markRecordingNoteSeen } from './recording-notes';

const PAGE = 200;

export interface TutorNotesPage {
  notes: TutorNote[];
  next_cursor: string | null;
}

export async function fetchTutorNotes(opts: { includeSeen?: boolean; limit?: number; before?: string | null } = {}): Promise<TutorNotesPage> {
  const q = new URLSearchParams();
  if (opts.includeSeen !== false) q.set('include_seen', '1');
  q.set('limit', String(opts.limit ?? PAGE));
  if (opts.before) q.set('before', opts.before);
  const response = await fetch(`${API_BASE}/api/me/tutor-notes?${q}`, { headers: getAuthHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch tutor notes: ${response.status}`);
  return (await response.json()) as TutorNotesPage;
}

/** Sync step (after syncRecordingNotes): mirror the newest notes, seen ones included. */
export async function syncTutorNotes(): Promise<{ notes: number; more: boolean }> {
  const page = await fetchTutorNotes({ includeSeen: true, limit: PAGE });
  await db.transaction('rw', db.tutorNotes, async () => {
    await db.tutorNotes.clear();
    if (page.notes.length > 0) await db.tutorNotes.bulkPut(page.notes);
  });
  return { notes: page.notes.length, more: page.next_cursor !== null };
}

export function unseenFromLocal(rows: LocalRecordingNote[]): UnseenTutorNote[] {
  return rows
    .filter((r) => r.seen_at === null)
    .map((r) => ({
      id: r.id,
      kind: r.kind ?? 'recording',
      card_id: r.card_id,
      note_id: r.note_id,
      hanzi: r.hanzi,
      comment: r.comment,
      tutor_name: r.tutor_name,
      updated_at: r.updated_at,
    }));
}

/** The page's list from the device: new first, then earlier; blanks filled from the local note. */
export async function loadTutorNotes(): Promise<TutorNotesList> {
  const [all, local] = await Promise.all([db.tutorNotes.toArray(), db.recordingNotes.toArray()]);
  const list = mergeTutorNotes(all, unseenFromLocal(local));
  const missing = [...list.fresh, ...list.earlier].filter((n) => !n.pinyin || !n.english).map((n) => n.note_id);
  if (missing.length > 0) {
    const notes = await db.notes.bulkGet([...new Set(missing)]);
    const byId = new Map(notes.filter((n): n is NonNullable<typeof n> => !!n).map((n) => [n.id, n]));
    const fill = (n: TutorNote): TutorNote => {
      const local = byId.get(n.note_id);
      return local ? { ...n, pinyin: n.pinyin || local.pinyin, english: n.english || local.english, deck_id: n.deck_id ?? local.deck_id } : n;
    };
    return { fresh: list.fresh.map(fill), earlier: list.earlier.map(fill) };
  }
  return list;
}

/**
 * The student has seen these notes on the page: the same local-first "seen" the card back uses
 * (hidden from the card back from now on, POST …/seen now or on the next sync), and the full list's
 * copy is stamped so it reads as earlier until the next sync replaces it.
 */
export async function markTutorNotesSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  await db.transaction('rw', db.tutorNotes, async () => {
    for (const id of ids) {
      const row = await db.tutorNotes.get(id);
      if (row && !row.seen_at) await db.tutorNotes.put({ ...row, seen_at: now });
    }
  });
  for (const id of ids) {
    await markRecordingNoteSeen(id).catch(() => {});
  }
}
