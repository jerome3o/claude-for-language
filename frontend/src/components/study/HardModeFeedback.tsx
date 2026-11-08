import {
  HARD_MODE_CHECKING, HARD_MODE_MISS_NOTE, HARD_MODE_RESULT, HARD_MODE_SHOW_ANSWER, HARD_MODE_TRY_AGAIN, HARD_MODE_UNKNOWN,
  HARD_MODE_REVEALED_TITLE, HARD_MODE_REVEALED_NOTE, hardModeNextLabel, hardModeRevealedNextLabel, hardModeSaidLine,
  hardModeQuestionFeel, type HardModeQuestionResult,
} from '@shared/study/hardMode';
import { useEffect } from 'react';
import { studyFeel } from '../../services/studyFeel';
import { DIFFERENCE_CARD, DIFFERENCE_TITLE, type DifferenceReason } from '@shared/study/answerDifference';import { DifferenceCompare } from './DifferenceCompare';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import {
  SENTENCE_CHECK_ANSWER, SENTENCE_CHECK_MOVE_ON_NOTE, SENTENCE_CHECK_TYPE_INSTEAD, SENTENCE_CHECK_YOUR_FIX, SENTENCE_CHECKING,
  type SentenceCheckView,
} from '@shared/study/sentenceAnswerCheck';
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
   * A sentence answer that goes to Claude (`sentenceCheckView`): the card's answer (`answer`) and "You said"
   * against it show AT ONCE, Claude's verdict loads in below them; its fix of his wording is at most a small line.
   */
  sentenceView?: SentenceCheckView | null;
  /** With `sentenceView`: on from a miss with the answer already on screen (a miss: Again or Hard). */
  onMoveOn?: () => void;
  /** The move-on button's words (`hardModeRevealedNextLabel`). */
  moveOnLabel?: string;
}

/**
 * Hard mode's check of the question's own answer, on the question (docs/STUDY_SESSION.md "Hard mode"):
 * ✓ Right → "Next: harder questions" (it goes on by itself after a beat — unless it was right in other
 * characters: then it holds with "You said" vs the card, `difference`); ✗ Not quite / ≈ Nearly →
 * 🔁 Try again, or 👁 Show answer (a miss: Again or Hard). Nothing here gives the answer away.
 */
export function HardModeFeedback({ result, said, spoken, roundFollows, difference, answer, onPlayAnswer, onTryAgain, onShowAnswer, onNext, check, checkingLabel, onTypeInstead, speak, sentenceView, onMoveOn, moveOnLabel }: HardModeFeedbackProps) {
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
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-continue" autoFocus>
            {hardModeRevealedNextLabel(roundFollows)} ›
          </button>
        </div>
        <p className="hard-feedback-note">{HARD_MODE_REVEALED_NOTE}</p>
      </div>
    );
  }
  if (sentenceView?.answerFirst && answer && said) {
    return (
      <SentenceAnswerFirst
        result={result}
        view={sentenceView}
        answer={answer}
        said={said}
        difference={difference?.reason ?? null}
        check={check ?? null}
        checkingLabel={checkingLabel ?? SENTENCE_CHECKING}
        roundFollows={roundFollows}
        moveOnLabel={moveOnLabel ?? HARD_MODE_SHOW_ANSWER}
        onPlayAnswer={onPlayAnswer}
        onTryAgain={onTryAgain}
        onMoveOn={onMoveOn ?? onShowAnswer}
        onNext={onNext}
        onTypeInstead={onTypeInstead}
        speak={speak}
      />
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

/**
 * A sentence answer Claude checks (shared/study/sentenceAnswerCheck.ts `sentenceCheckView`; docs/STUDY_SESSION.md
 * "Sentence answers checked by Claude"): the card's answer first — hanzi big with ▶, pinyin, English — and
 * "You said" against it, character by character, AT ONCE; Claude's verdict loads in under them (a slim
 * "Checking your sentence…" row, then its chip, headline and tips), and its fix of his own wording is at most a
 * small labelled line. Offline / failed: the device's verdict under the same answer + diff.
 */
function SentenceAnswerFirst({ result, view, answer, said, difference, check, checkingLabel, roundFollows, moveOnLabel, onPlayAnswer, onTryAgain, onMoveOn, onNext, onTypeInstead, speak }: {
  result: HardModeQuestionResult;
  view: SentenceCheckView;
  answer: { hanzi: string; pinyin: string | null; english: string };
  said: string;
  difference: DifferenceReason | null;
  check: AnswerCheck | null;
  checkingLabel: string;
  roundFollows: boolean;
  moveOnLabel: string;
  onPlayAnswer?: () => void;
  onTryAgain: () => void;
  onMoveOn: () => void;
  onNext: () => void;
  onTypeInstead?: () => void;
  speak?: (text: string) => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const miss = result === 'wrong' || result === 'close';
  return (
    <div
      className={`hard-feedback hard-feedback--${result} hard-feedback--answer-first`}
      data-testid="hard-feedback"
      data-result={result}
      data-answer-first="true"
      data-held={result === 'right' && difference ? 'true' : undefined}
      aria-live="polite"
    >
      <div className="hard-feedback-check" onClick={(e) => e.stopPropagation()}>
        <DifferenceCompare
          said={said}
          model={answer.hanzi}
          modelPinyin={answer.pinyin}
          accepted={view.accepted}
          modelLabel={SENTENCE_CHECK_ANSWER}
          onPlayModel={onPlayAnswer}
          answerFirst={{ english: answer.english }}
        />
        {view.checking ? (
          <div className="answer-check checking hard-feedback-checking-row" role="status" data-testid="hard-sentence-checking">
            <span className="answer-check-dot" aria-hidden="true" /> {checkingLabel}
          </div>
        ) : check ? (
          <div data-testid="hard-sentence-check">
            <AnswerCheckBody check={check} answer={said} speak={speak} hideFix />
            {view.corrected && (
              <p className="hard-feedback-your-fix" data-testid="hard-sentence-your-fix">
                <span className="hard-feedback-your-fix-label">{SENTENCE_CHECK_YOUR_FIX}</span>{' '}
                <span lang="zh-CN">{view.corrected}</span>
                {speak && (
                  <button type="button" className="answer-check-icon" onClick={stop(() => speak(view.corrected!))} aria-label="Play your wording, fixed">🔊</button>
                )}
              </p>
            )}
          </div>
        ) : (
          <p className="hard-feedback-title hard-feedback-verdict-line">
            {result === 'unknown' ? HARD_MODE_UNKNOWN : result === 'right' && difference ? DIFFERENCE_TITLE[difference] : HARD_MODE_RESULT[result as 'right' | 'close' | 'wrong']}
          </p>
        )}
      </div>
      <div className="hard-feedback-row">
        {result === 'right' ? (
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        ) : result === 'unknown' ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={stop(onTryAgain)} data-testid="hard-try-again">
              <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
            </button>
            <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
              {hardModeNextLabel(roundFollows)} →
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={stop(onMoveOn)} data-testid="hard-show-answer">
              {moveOnLabel} ›
            </button>
            {miss && onTypeInstead && (
              <button type="button" className="btn btn-secondary" onClick={stop(onTypeInstead)} data-testid="hard-type-instead">
                <span aria-hidden="true">✏️</span> {SENTENCE_CHECK_TYPE_INSTEAD}
              </button>
            )}
            {miss && (
              <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onTryAgain)} data-testid="hard-try-again" autoFocus>
                <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
              </button>
            )}
          </>
        )}
      </div>
      {miss && <p className="hard-feedback-note">{SENTENCE_CHECK_MOVE_ON_NOTE}</p>}
    </div>
  );
}
