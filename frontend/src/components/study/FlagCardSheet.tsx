import { useEffect, useRef, useState } from 'react';
import { queueCardFlag, type RememberedTutor } from '../../services/cardFlags';

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const tutor = tutors.find((t) => t.relationship_id === relId) ?? tutors[0];

  const send = async () => {
    if (!message.trim() || busy || !tutor) return;
    setBusy(true);
    setError(null);
    try {
      const r = await queueCardFlag({
        relationship_id: tutor.relationship_id,
        tutor_name: tutor.name,
        note_id: noteId,
        card_id: cardId,
        hanzi,
        message,
      });
      setDone(r.sent ? `Sent to ${tutor.name}` : `Saved — it goes to ${tutor.name} when you're back online`);
    } catch (err) {
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
            <textarea
              ref={inputRef}
              className="study-flag-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's confusing? e.g. I keep mixing this up with 很行"
              rows={3}
              maxLength={2000}
              disabled={busy}
              data-testid="flag-card-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
              }}
            />
            {error && <div className="study-inline-error" role="alert">{error}</div>}
            <div className="study-flag-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !message.trim() || !tutor} data-testid="flag-card-send">
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
            <p className="study-flag-hint">Your tutor gets it in the chat with a link to this card, and their reply shows here next time.</p>
          </>
        )}
      </div>
    </>
  );
}
