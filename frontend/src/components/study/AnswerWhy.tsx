/**
 * The ONE "why" sentence under an answer's verdict + diff, with a small "Explain more ›" (docs/STUDY_SESSION.md
 * "Answer feedback: one line and a diff"; rules in shared/cards/answer-why.ts). Muted text, no box: the result-state
 * colour stays on the verdict. "Explain more ›" opens what the check already returned IN PLACE (its tips, the corrected
 * line, an alternative) — no new call; with nothing on hand it asks Claude about this answer (`onAsk`) where the
 * surface has that path. Collapsed by default; open for this showing only. Lab twin: `AnswerWhyLine` in
 * ui/study/AnswerDiffView.kt.
 */
import { useState } from 'react';
import {
  ANSWER_WHY_ALTERNATIVE, ANSWER_WHY_CORRECTED, ANSWER_WHY_LESS, ANSWER_WHY_MORE, type AnswerMore,
} from '@shared/cards/answer-why';
import { track } from '../../services/analytics';
import './AnswerDiff.css';

export function AnswerWhy({ why, more, onAsk, surface = 'answer_diff' }: {
  why: string | null;
  more: AnswerMore | null;
  /** Nothing to open in place: Ask Claude about this answer. */
  onAsk?: () => void;
  /** Analytics: which surface the why sits on. */
  surface?: string;
}) {
  const [open, setOpen] = useState(false);
  const canMore = !!more || !!onAsk;
  if (!why && !more) return null;
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!more) {
      track('study.answer_why_more', { surface, action: 'ask' });
      onAsk?.();
      return;
    }
    track('study.answer_why_more', { surface, action: open ? 'close' : 'open' });
    setOpen((o) => !o);
  };
  return (
    <div className="adiff-why-box" data-testid="answer-why">
      <p className="adiff-why">
        {why && <span data-testid="answer-why-text">{why}</span>}
        {canMore && (
          <>
            {why && ' '}
            <button type="button" className="adiff-why-more" onClick={toggle} aria-expanded={more ? open : undefined} data-testid="answer-why-more">
              {open ? ANSWER_WHY_LESS : ANSWER_WHY_MORE}
            </button>
          </>
        )}
      </p>
      {open && more && (
        <div className="adiff-why-detail" data-testid="answer-why-detail">
          {more.tips.map((t, i) => <p key={i} className="adiff-why-tip">{t}</p>)}
          {more.corrected && (
            <p className="adiff-why-tip"><span className="adiff-why-label">{ANSWER_WHY_CORRECTED}</span> <span lang="zh-CN">{more.corrected}</span></p>
          )}
          {more.alternative && (
            <p className="adiff-why-tip"><span className="adiff-why-label">{ANSWER_WHY_ALTERNATIVE}</span> <span lang="zh-CN">{more.alternative}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
