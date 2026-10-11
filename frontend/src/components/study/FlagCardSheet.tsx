import { useEffect, useState } from 'react';
import { VoiceTextInput } from '../voice/VoiceTextInput';
import { queueCardFlag, type RememberedTutor } from '../../services/cardFlags';
import { track, trackError } from '../../services/analytics';

/**
 * "Flag for tutor": a bottom sheet on the card back. One short note, sent to
 * the tutor with a link back to this card. Works offline — the flag is queued
 * and posted by the next sync — and says which happened.
 */
export function FlagCardSheet({
  tutors,
  noteId,
  cardId,
  hanzi,
  onClose,
}: {
  tutors: RememberedTutor[];
  noteId: string;
  cardId: string | null;
  hanzi: string;
  onClose: () => void;
}) {
  const [relId, setRelId] = useState(tutors[0]?.relationship_id ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const tutor = tutors.find((t) => t.relationship_id === relId) ?? tutors[0];

  const send = async (text: string) => {
    if (!text.trim() || busy || !tutor) return;
    setMessage(text);
    setBusy(true);
    setError(null);
    try {
      const r = await queueCardFlag({
        relationship_id: tutor.relationship_id,
        tutor_name: tutor.name,
        note_id: noteId,
        card_id: cardId,
        hanzi,
        message: text.trim(),
      });
      track('study.flag_card');
      setDone(r.sent ? `Sent to ${tutor.name}` : `Saved — it goes to ${tutor.name} when you're back online`);
    } catch (err) {
      trackError('study_flag_card', err);
      setError(err instanceof Error ? err.message : 'Could not save the flag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="study-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="study-sheet study-flag-sheet" role="dialog" aria-label="Flag this card for your tutor" data-testid="flag-card-sheet">
        <div className="study-sheet-grip" aria-hidden="true" />
        <div className="study-flag-title">
          🚩 Flag <span className="study-flag-hanzi">{hanzi}</span> for {tutors.length > 1 ? 'your tutor' : tutor?.name ?? 'your tutor'}
        </div>
        {tutors.length > 1 && (
          <label className="study-flag-field">
            <span>Send to</span>
            <select value={relId} onChange={(e) => setRelId(e.target.value)} disabled={busy || !!done}>
              {tutors.map((t) => (
                <option key={t.relationship_id} value={t.relationship_id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}
        {done ? (
          <div className="study-flag-done" role="status" data-testid="flag-card-done">✓ {done}</div>
        ) : (
          <>
            {/* Voice first (shared/voice/dictation.ts): say what's confusing, or ✏️ Type. Offline → typing (it queues). */}
            <VoiceTextInput
              surface="card_flag"
              value={message}
              onChange={setMessage}
              onSubmit={(answer) => void send(answer.text)}
              placeholder="What's confusing? e.g. I keep mixing this up with 很行"
              listeningPlaceholder="Listening… what's confusing?"
              submitLabel={busy ? 'Sending…' : 'Send'}
              multiline
              lang="en"
              disabled={busy || !tutor}
              testId="flag-card"
            />
            {error && <div className="study-inline-error" role="alert">{error}</div>}
            <p className="study-flag-hint">Your tutor gets it in the chat with a link to this card, and their reply shows here next time.</p>
            <div className="study-flag-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
