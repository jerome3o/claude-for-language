import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { WritingExerciseResult } from '@shared/strokes';
import { WritingExercise } from './WritingExercise';
import './strokes.css';

/**
 * Full-screen writing practice over whatever is underneath (the study card's
 * ⋯ → "Write it"), so the session keeps its place. Closes on Done, ✕ or Escape.
 */
export function WritingSheet({
  text,
  pinyin,
  english,
  onClose,
  onComplete,
}: {
  text: string;
  pinyin?: string | null;
  english?: string | null;
  onClose: () => void;
  onComplete?: (result: WritingExerciseResult) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="writing-sheet" role="dialog" aria-modal="true" aria-label={`Write ${text}`} data-testid="writing-sheet">
      <div className="writing-sheet-head">
        <span className="writing-sheet-title">
          ✍️ Write it <span className="preview-badge">Preview</span>
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close writing practice">
          ✕
        </button>
      </div>
      <div className="writing-sheet-body">
        <WritingExercise text={text} pinyin={pinyin} english={english} onComplete={onComplete} onDone={onClose} doneLabel="Back to the card" />
      </div>
    </div>,
    document.body,
  );
}
