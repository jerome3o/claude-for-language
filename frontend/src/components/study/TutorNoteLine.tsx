import { LocalRecordingNote } from '../../db/database';

/**
 * "From Wang Laoshi: second tone, not fourth" — a tutor's note on one of the
 * student's recordings, or "Wang Laoshi replied to your flag: …" — the answer
 * to a card the student flagged. Shown once under the pinyin on the card back
 * the next time the card comes up. The caller marks it seen when rated.
 */
export function TutorNoteLine({ notes }: { notes: LocalRecordingNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="study-tutor-notes" data-testid="tutor-note-line">
      {notes.map((note) => (
        <p key={note.id} className="study-tutor-note">
          <span className="study-tutor-note-from">
            {note.kind === 'flag' ? `${note.tutor_name || 'Your tutor'} replied to your flag:` : `From ${note.tutor_name || 'your tutor'}:`}
          </span>{' '}
          {note.comment}
        </p>
      ))}
    </div>
  );
}
