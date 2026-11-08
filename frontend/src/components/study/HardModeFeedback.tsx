import {
  HARD_MODE_CHECKING, HARD_MODE_MISS_NOTE, HARD_MODE_RESULT, HARD_MODE_SHOW_ANSWER, HARD_MODE_TRY_AGAIN, HARD_MODE_UNKNOWN,
  HARD_MODE_REVEALED_TITLE, HARD_MODE_REVEALED_NOTE, hardModeNextLabel, hardModeRevealedNextLabel, hardModeSaidLine,
  hardModeQuestionFeel, hardModeReadAgainOffered, type HardModeQuestionResult,
} from '@shared/study/hardMode';
import { HardModeReadAgain, type HardModeReadAgainProps } from './HardModeReadAgain';
import { useEffect } from 'react';
import { studyFeel } from '../../services/studyFeel';
import { DIFFERENCE_CARD, DIFFERENCE_TITLE, type DifferenceReason } from '@shared/study/answerDifference';
import { DifferenceCompare } from './DifferenceCompare';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import { SENTENCE_CHECK_TYPE_INSTEAD } from '@shared/study/sentenceAnswerCheck';
import { AnswerCheckBody } from '../lessons/AnswerCheckCard';
import '../lessons/AnswerCheckCard.css';
import './HardModeFeedback.css';

export interface HardModeFeedbackProps {
  /** 'revealed' = he gave up: the answer is shown in place, the round still to come. */
  result: HardModeQuestionResult | 'revealed';
  /** The card's answer, for 'revealed'. */
  answer?: { hanzi: string; pinyin: string | null; english: string };
  onPlayAnswer?: () => void;
  /** His own answer / what was heard (never the card's answer); null = nothing to show. */
  said: string | null;
  spoken: boolean;
  /** The Sentence round comes next (else the answer). */
  roundFollows: boolean;
  /**
   * Right, but not the card's hanzi (a homophone / a listed alternative): the check stays up with
   * "You said" vs the card until Next — no going on by itself (shared/study/answerDifference.ts).
   */
  difference?: { reason: DifferenceReason; said: string; model: string; modelPinyin?: string | null } | null;
  onTryAgain: () => void;
  onShowAnswer: () => void;
  onNext: () => void;
  /**
   * Claude's check of a sentence answer (shared/study/sentenceAnswerCheck.ts): its verdict, the corrected
   * sentence, tips and an alternative on the question — the result above already follows it.
   */
  check?: AnswerCheck | null;
  /** The checking row's words (default "Checking what you said…"). */
  checkingLabel?: string;
  /** A spoken sentence's second way to try again: ✏️ Type it (the box, holding what was said). */
  onTypeInstead?: () => void;
  /** 🔊 on Claude's corrected sentence / alternative. */
  speak?: (text: string) => void;
  /**
   * 'revealed': 🎤 Read it again — read the answer aloud and see whether it comes out right this time
   * (practice only, the card stays a miss; `HardModeReadAgain`). Omitted = no 🎤.
   */
  readAgain?: HardModeReadAgainProps;
}

/**
 * Hard mode's check of the question's own answer, on the question (docs/STUDY_SESSION.md "Hard mode"):
 * ✓ Right → "Next: harder questions" (it goes on by itself after a beat — unless it was right in other
 * characters: then it holds with "You said" vs the card, `difference`); ✗ Not quite / ≈ Nearly →
 * 🔁 Try again, or 👁 Show answer (a miss: Again or Hard). Nothing here gives the answer away.
 */
export function HardModeFeedback({ result, said, spoken, roundFollows, difference, answer, onPlayAnswer, onTryAgain, onShowAnswer, onNext, check, checkingLabel, onTypeInstead, speak, readAgain }: HardModeFeedbackProps) {
  // The check's result you can FEEL (Jerome: "when I get it right on the very first page there's no
  // satisfying haptics … I find myself quite dependent on it"): ✓ Right = a firm double buzz + chime,
  // ✗ / ≈ a short one; checking / unknown / revealed none. Once per result (a Try again remounts it).
  useEffect(() => {
    if (result !== 'revealed') studyFeel(hardModeQuestionFeel(result));
  }, [result]);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const saidLine = said ? <p className="hard-feedback-said" data-testid="hard-said">{hardModeSaidLine(said, spoken)}</p> : null;
  if (result === 'revealed') {
    // 👁 Show answer before a right answer: the answer IN PLACE, then on to the sentences (a miss all the same).
    return (
      <div className="hard-feedback hard-feedback--revealed" data-testid="hard-feedback" data-result="revealed" aria-live="polite">
        <p className="hard-feedback-title">{HARD_MODE_REVEALED_TITLE}</p>
        {answer && (
          <div className="hard-feedback-answer" data-testid="hard-revealed-answer">
            <p className="hard-feedback-answer-zh" lang="zh-CN">
              {answer.hanzi}
              {onPlayAnswer && (
                <button type="button" className="hard-feedback-play" onClick={stop(onPlayAnswer)} aria-label={`Play: ${answer.hanzi}`} data-testid="hard-revealed-play">▶</button>
              )}
            </p>
            {answer.pinyin && <p className="hard-feedback-answer-pinyin">{answer.pinyin}</p>}
            <p className="hard-feedback-answer-en">{answer.english}</p>
          </div>
        )}
        {saidLine}
        {readAgain && hardModeReadAgainOffered(readAgain.hanzi) && <HardModeReadAgain {...readAgain} />}
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-continue" autoFocus>
            {hardModeRevealedNextLabel(roundFollows)} ›
          </button>
        </div>
        <p className="hard-feedback-note">{HARD_MODE_REVEALED_NOTE}</p>
      </div>
    );
  }
  if (result === 'checking') {
    return (
      <div className="hard-feedback hard-feedback--checking" data-testid="hard-feedback" data-result="checking" aria-live="polite">
        <p className="hard-feedback-title"><span className="spinner hard-feedback-spinner" aria-hidden="true" /> {checkingLabel ?? HARD_MODE_CHECKING}</p>
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-secondary" onClick={stop(onShowAnswer)} data-testid="hard-show-answer">
            <span aria-hidden="true">👁</span> {HARD_MODE_SHOW_ANSWER}
          </button>
        </div>
      </div>
    );
  }
  // Claude checked a sentence answer: its card IS the verdict (chip + headline), then the fix, tips and alternative.
  const checkBody = (afterHead?: React.ReactNode) => check && said ? (
    <div className="hard-feedback-check" data-testid="hard-sentence-check" onClick={(e) => e.stopPropagation()}>
      <AnswerCheckBody check={check} answer={said} speak={speak} afterHead={afterHead} />
    </div>
  ) : null;
  if (result === 'right') {
    const compare = difference ? (
      <DifferenceCompare said={difference.said} model={difference.model} modelPinyin={difference.modelPinyin} accepted modelLabel={DIFFERENCE_CARD} />
    ) : null;
    return (
      <div className="hard-feedback hard-feedback--right" data-testid="hard-feedback" data-result="right" data-held={difference ? 'true' : undefined} aria-live="polite">
        {check && said ? checkBody(compare) : (
          <>
            <p className="hard-feedback-title">{difference ? DIFFERENCE_TITLE[difference.reason] : HARD_MODE_RESULT.right}</p>
            {compare ?? saidLine}
          </>
        )}
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        </div>
      </div>
    );
  }
  if (result === 'unknown') {
    return (
      <div className="hard-feedback hard-feedback--unknown" data-testid="hard-feedback" data-result="unknown" aria-live="polite">
        <p className="hard-feedback-title">{HARD_MODE_UNKNOWN}</p>
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-secondary" onClick={stop(onTryAgain)} data-testid="hard-try-again">
            <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
          </button>
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`hard-feedback hard-feedback--${result}`} data-testid="hard-feedback" data-result={result} aria-live="polite">
      {check && said ? (
        <>
          {/* His own words once: the red-pen fix shows them when there is one. */}
          {!check.corrected && saidLine}
          {checkBody()}
        </>
      ) : (
        <>
          <p className="hard-feedback-title">{HARD_MODE_RESULT[result]}</p>
          {saidLine}
        </>
      )}
      <div className="hard-feedback-row">
        <button type="button" className="btn btn-secondary" onClick={stop(onShowAnswer)} data-testid="hard-show-answer">
          <span aria-hidden="true">👁</span> {HARD_MODE_SHOW_ANSWER}
        </button>
        {onTypeInstead && (
          <button type="button" className="btn btn-secondary" onClick={stop(onTypeInstead)} data-testid="hard-type-instead">
            <span aria-hidden="true">✏️</span> {SENTENCE_CHECK_TYPE_INSTEAD}
          </button>
        )}
        <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onTryAgain)} data-testid="hard-try-again" autoFocus>
          <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
        </button>
      </div>
      <p className="hard-feedback-note">{HARD_MODE_MISS_NOTE}</p>
    </div>
  );
}
