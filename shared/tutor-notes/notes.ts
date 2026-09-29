/**
 * "Notes from your tutor": a tutor's needs-work comment on one of the student's recordings, or the
 * tutor's reply to a card the student flagged. The card back shows a NEW note once (the unseen
 * feed, GET /api/me/recording-notes, cached on the device); the Tutor notes page lists every note
 * (GET /api/me/tutor-notes?include_seen=1, cached too) — new first, then the earlier ones.
 *
 * Pure, shared by the web app (services/tutorNotes.ts, pages/TutorNotesPage.tsx) and the Lab app
 * (core TutorNotesRules.kt, parity-tested through android-lab/parity/fixtures/tutor-notes.ts).
 */

export type TutorNoteKind = 'recording' | 'flag';

/** A row of GET /api/me/tutor-notes (the full list, seen ones included). */
export interface TutorNote {
  id: string;
  kind: TutorNoteKind;
  card_id: string | null;
  card_type: string | null;
  note_id: string;
  deck_id: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  comment: string;
  tutor_name: string | null;
  updated_at: string;
  seen_at: string | null;
  recording_url: string | null;
  student_message: string | null;
}

/** A row of the unseen feed (GET /api/me/recording-notes) as the device caches it. */
export interface UnseenTutorNote {
  id: string;
  kind: TutorNoteKind;
  card_id: string | null;
  note_id: string;
  hanzi: string;
  comment: string;
  tutor_name: string | null;
  updated_at: string;
}

export interface TutorNotesList {
  /** Not seen yet (on the card back or on this page) — newest first. */
  fresh: TutorNote[];
  /** Seen before — newest first. */
  earlier: TutorNote[];
}

function newestFirst(a: TutorNote, b: TutorNote): number {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Merge the full list with the device's unseen feed. The unseen feed decides what is NEW: it is
 * what the card back reads and what "seen" updates on this device at once (the full list only
 * learns about it on the next sync). A new note missing from the full list (it arrived after the
 * last full fetch) is still listed, with the fields the feed has. A row the full list calls unseen
 * but the feed no longer holds was seen on this device → earlier.
 */
export function mergeTutorNotes(all: readonly TutorNote[], unseen: readonly UnseenTutorNote[]): TutorNotesList {
  const byId = new Map(all.map((n) => [n.id, n]));
  const freshIds = new Set<string>();
  const fresh: TutorNote[] = [];
  for (const u of unseen) {
    if (freshIds.has(u.id)) continue;
    freshIds.add(u.id);
    const full = byId.get(u.id);
    fresh.push(
      full
        ? { ...full, comment: u.comment, tutor_name: u.tutor_name ?? full.tutor_name, updated_at: u.updated_at, seen_at: null }
        : {
            id: u.id,
            kind: u.kind,
            card_id: u.card_id,
            card_type: null,
            note_id: u.note_id,
            deck_id: null,
            hanzi: u.hanzi,
            pinyin: '',
            english: '',
            comment: u.comment,
            tutor_name: u.tutor_name,
            updated_at: u.updated_at,
            seen_at: null,
            recording_url: null,
            student_message: null,
          }
    );
  }
  const earlier = all.filter((n) => !freshIds.has(n.id));
  return { fresh: fresh.sort(newestFirst), earlier: earlier.slice().sort(newestFirst) };
}

/** Home's one-line entry: "3 new notes from 明慧老师" — null when nothing is new. */
export function tutorNotesHomeLine(fresh: ReadonlyArray<Pick<TutorNote, 'tutor_name'>>): string | null {
  if (fresh.length === 0) return null;
  const names = new Set(fresh.map((n) => n.tutor_name?.trim() || ''));
  const from = names.size === 1 ? [...names][0] || 'your tutor' : 'your tutors';
  return `${fresh.length} new ${fresh.length === 1 ? 'note' : 'notes'} from ${from}`;
}

/** "Recording" / "Your flag" — the small label above a note on the page. */
export function tutorNoteLabel(note: Pick<TutorNote, 'kind'>): string {
  return note.kind === 'flag' ? 'Reply to your flag' : 'On your recording';
}
