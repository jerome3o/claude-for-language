import { useEffect, useMemo, useState } from 'react';
import { correctionDiff, correctionIsNoop } from '../../services/chatLearning';
import type { ChatCorrection } from '../../types';
import { SpinnerButton } from './SpinnerButton';

/** The correction as one line of red-pen marks against the original. */
export function CorrectionDiffLine({ original, corrected }: { original: string; corrected: string }) {
  const parts = useMemo(() => correctionDiff(original, corrected), [original, corrected]);
  return (
    <span className="chat-diff" lang="zh">
      {parts.map((p, i) =>
        p.kind === 'del' ? (
          <del key={i} className="chat-diff-del">
            {p.text}
          </del>
        ) : p.kind === 'ins' ? (
          <ins key={i} className="chat-diff-ins">
            {p.text}
          </ins>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Under a corrected message (docs/CHAT.md PR 3): the tutor's correction as a
 * character diff + their note. The tutor can edit or remove it; the student
 * can turn it into a card.
 */
export function CorrectionBlock({
  original,
  correction,
  tutorName,
  canEdit,
  canMakeCard,
  busy,
  onEdit,
  onRemove,
  onMakeCard,
}: {
  original: string;
  correction: ChatCorrection;
  tutorName: string;
  canEdit: boolean;
  canMakeCard: boolean;
  busy?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMakeCard: () => void;
}) {
  const noop = correctionIsNoop(original, correction.text);
  return (
    <div className="chat-correction" data-testid="chat-correction">
      <div className="chat-correction-head">
        <span aria-hidden="true">✏️</span> {tutorName}
        {noop ? ' · punctuation only' : ''}
      </div>
      <div className="chat-correction-text">
        <CorrectionDiffLine original={original} corrected={correction.text} />
      </div>
      {correction.note && <div className="chat-correction-note">{correction.note}</div>}
      {(canEdit || canMakeCard) && (
        <div className="chat-correction-actions">
          {canMakeCard && (
            <button type="button" className="chat-link-btn" onClick={onMakeCard} disabled={busy}>
              + Make a card from this
            </button>
          )}
          {canEdit && (
            <>
              <button type="button" className="chat-link-btn" onClick={onEdit} disabled={busy}>
                Edit
              </button>
              <button type="button" className="chat-link-btn" onClick={onRemove} disabled={busy}>
                Remove
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The tutor's "Correct this" sheet: the message text to edit, an optional note, a live diff. */
export function CorrectMessageSheet({
  original,
  initial,
  initialNote,
  studentName,
  busy,
  error,
  onSave,
  onCancel,
}: {
  original: string;
  initial: string;
  initialNote: string;
  studentName: string;
  busy: boolean;
  error: string | null;
  onSave: (text: string, note: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [note, setNote] = useState(initialNote);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const unchanged = text.trim() === initial.trim() && note.trim() === initialNote.trim();
  const same = text.trim() === original.trim() && !note.trim();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal idk-dialog-modal chat-correct-modal" role="dialog" aria-label="Correct this message" onClick={(e) => e.stopPropagation()}>
        <h3>Correct {studentName}'s message</h3>
        <p className="chat-correct-original" lang="zh">
          {original}
        </p>
        <label className="chat-correct-label" htmlFor="chat-correct-text">
          Corrected
        </label>
        <textarea
          id="chat-correct-text"
          className="idk-input chat-edit-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          lang="zh"
        />
        {text.trim() && text.trim() !== original.trim() && (
          <div className="chat-correct-preview" aria-label="Preview">
            <CorrectionDiffLine original={original} corrected={text.trim()} />
          </div>
        )}
        <label className="chat-correct-label" htmlFor="chat-correct-note">
          Note <span className="chat-correct-optional">(optional)</span>
        </label>
        <input
          id="chat-correct-note"
          type="text"
          className="new-deck-input chat-title-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. 了 goes after the verb here"
          maxLength={500}
        />
        {error && (
          <div className="chat-notice chat-notice-error" role="alert">
            <span className="chat-notice-text">{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <SpinnerButton
            type="button"
            className="btn btn-primary"
            busy={busy}
            disabled={!text.trim() || unchanged || same}
            onClick={() => onSave(text.trim(), note.trim())}
          >
            Save correction
          </SpinnerButton>
        </div>
      </div>
    </div>
  );
}
