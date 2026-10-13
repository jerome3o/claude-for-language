import { LocalRecordingNote } from '../../db/database';
import { ModelRecordingButtons } from '../recordings/ModelRecordingButtons';

/**
 * "From Wang Laoshi: second tone, not fourth" — a tutor's note on one of the
 * student's recordings, or "Wang Laoshi replied to your flag: …" — the answer
 * to a card the student flagged. Shown once under the pinyin on the card back
 * the next time the card comes up. The caller marks it seen when rated.
 *
 * When the tutor recorded how it should sound, "▶ Wang Laoshi says it" plays it
 * next to "▶ You" (the take the note is on), so the student can compare.
 */
export function TutorNoteLine({ notes, where = 'card' }: { notes: LocalRecordingNote[]; where?: 'card' | 'practice' }) {
  if (notes.length === 0) return null;
  return (
    <div className="study-tutor-notes" data-testid="tutor-note-line">
      {notes.map((note) => (
        <div key={note.id} className="study-tutor-note-block">
          <p className="study-tutor-note">
            <span className="study-tutor-note-from">
              {note.kind === 'flag' ? `${note.tutor_name || 'Your tutor'} replied to your flag:` : `From ${note.tutor_name || 'your tutor'}:`}
            </span>{' '}
            {note.comment || (note.model_audio_url ? 'listen to how it should sound, then compare with yours.' : '')}
          </p>
          {note.kind !== 'flag' && note.model_audio_url && (
            <ModelRecordingButtons
              tutorName={note.tutor_name}
              modelAudioUrl={note.model_audio_url}
              recordingUrl={note.recording_url}
              where={where}
            />
          )}
        </div>
      ))}
    </div>
  );
}
