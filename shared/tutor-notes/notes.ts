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
  /**
   * The tutor's own recording of how it should sound (a needs-work mark's model answer,
   * docs/RECORDING_REVIEW.md "Model recordings"): fetched with the session from
   * /api/recording-marks/<id>/model-audio?v=…, cached on the device. Null / missing = none.
   */
  model_audio_url?: string | null;
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
  /** My take the note is on (R2 key, /api/audio/<key>) — recording notes only. */
  recording_url?: string | null;
  /** The tutor's model recording — the feed is newer than the full list, so it wins. */
  model_audio_url?: string | null;
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
        ? {
            ...full,
            comment: u.comment,
            tutor_name: u.tutor_name ?? full.tutor_name,
            updated_at: u.updated_at,
            seen_at: null,
            recording_url: full.recording_url ?? u.recording_url ?? null,
            model_audio_url: u.model_audio_url ?? full.model_audio_url ?? null,
          }
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
            recording_url: u.recording_url ?? null,
            student_message: null,
            model_audio_url: u.model_audio_url ?? null,
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

/**
 * The button that plays the tutor's model recording: "明慧老师 says it" (beside "You", the
 * student's own take). A blank name reads "Your tutor says it".
 */
export function tutorSaysItLabel(tutorName: string | null | undefined): string {
  return `${tutorName?.trim() || 'Your tutor'} says it`;
}

/** "Recording" / "Your flag" — the small label above a note on the page. */
export function tutorNoteLabel(note: Pick<TutorNote, 'kind'>): string {
  return note.kind === 'flag' ? 'Reply to your flag' : 'On your recording';
}
