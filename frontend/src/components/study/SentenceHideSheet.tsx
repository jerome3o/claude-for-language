/**
 * "Stop showing this sentence" (docs/STUDY_SESSION.md "Sentence practice history"; words in
 * shared/study/sentenceHistory.ts): long-press or ⋯ on an example sentence — in the Sentence round or
 * the answer side's list — opens this sheet; a reason chip (weird / wrong / not useful / too rare)
 * hides it for him at once (an event, offline-first). The caller shows the Undo toast.
 */
import { useEffect } from 'react';
import {
  SENTENCE_HIDE_HINT,
  SENTENCE_HIDE_REASONS,
  SENTENCE_HIDE_REASON_LABEL,
  SENTENCE_HIDE_TITLE,
  type SentenceHideReason,
} from '@shared/study/sentenceHistory';
import '../cardControls/cardControls.css';
import './SentenceRound.css';

export function SentenceHideSheet({ hanzi, translation, onHide, onClose }: {
  hanzi: string;
  translation?: string | null;
  onHide: (reason: SentenceHideReason) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="cc-backdrop" onClick={onClose} role="presentation" />
      <div className="cc-sheet" role="dialog" aria-label={SENTENCE_HIDE_TITLE} data-testid="sentence-hide-sheet">
        <div className="cc-grip" aria-hidden="true" />
        <div className="cc-title"><span aria-hidden="true">🙈</span> {SENTENCE_HIDE_TITLE}</div>
        <p className="sentence-hide-sentence" lang="zh-CN">{hanzi}</p>
        {translation && <p className="sentence-hide-en">{translation}</p>}
        <p className="cc-explain">{SENTENCE_HIDE_HINT}</p>
        <div className="sentence-hide-reasons">
          {SENTENCE_HIDE_REASONS.map((r) => (
            <button key={r} type="button" className="sentence-hide-reason" onClick={() => onHide(r)} data-testid={`sentence-hide-${r}`}>
              {SENTENCE_HIDE_REASON_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}
