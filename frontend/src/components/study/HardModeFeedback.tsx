import {
  HARD_MODE_CHECKING, HARD_MODE_MISS_NOTE, HARD_MODE_RESULT, HARD_MODE_SHOW_ANSWER, HARD_MODE_TRY_AGAIN, HARD_MODE_UNKNOWN,
  HARD_MODE_REVEALED_TITLE, HARD_MODE_REVEALED_NOTE, hardModeNextLabel, hardModeRevealedNextLabel, hardModeSaidLine,
  hardModeQuestionFeel, hardModeReadAgainOffered, type HardModeQuestionResult,
} from '@shared/study/hardMode';
import { HardModeReadAgain, type HardModeReadAgainProps } from './HardModeReadAgain';
import { useEffect, type ReactNode } from 'react';
import { studyFeel } from '../../services/studyFeel';
import { DIFFERENCE_CARD, type DifferenceReason } from '@shared/study/answerDifference';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import {
  SENTENCE_CHECK_ANSWER, SENTENCE_CHECK_MOVE_ON_NOTE, SENTENCE_CHECK_TYPE_INSTEAD, SENTENCE_CHECKING,
  type SentenceCheckView,
} from '@shared/study/sentenceAnswerCheck';
import { ANSWER_DIFF_VERDICT, ANSWER_DIFF_YOUR_ANSWER, ANSWER_DIFF_YOU_SAID } from '@shared/cards/answer-diff';
import { AnswerDiff } from './AnswerDiff';
import '../lessons/AnswerCheckCard.css';
import './HardModeFeedback.css';
import { takeTap } from '../../services/takeLock';
import { TakeLockedActions } from '../voice/TakeStop';

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
  /**
   * 'revealed': 🎤 Read it again — read the answer aloud and see whether it comes out right this time
   * (practice only, the card stays a miss; `HardModeReadAgain`). Omitted = no 🎤.
   */
  readAgain?: HardModeReadAgainProps;
  /**
   * The answer is already on screen (the read card shows its hanzi): a miss shows his take against it at once —
   * one line + the diff (docs/STUDY_SESSION.md "Answer feedback: one line and a diff"). Off on the typing cards,
   * where the diff would give the answer away before 🔁 Try again.
   */
  diffOnQuestion?: boolean;
}

/** Claude's verdict as the slim line's chip ("≈ Almost · Tone off on 都"). */
const checkVerdict = (check: AnswerCheck | null | undefined) => (check ? ANSWER_DIFF_VERDICT[check.verdict] : null);

/**
 * Hard mode's check of the question's own answer, on the question (docs/STUDY_SESSION.md "Hard mode"):
 * ✓ Right → "Next: harder questions" (it goes on by itself after a beat — unless it was right in other
 * characters: then it holds with "You said" vs the card, `difference`); ✗ Not quite / ≈ Nearly →
 * 🔁 Try again, or 👁 Show answer (a miss: Again or Hard). Nothing here gives the answer away.
 */
export function HardModeFeedback({ result, said, spoken, roundFollows, difference, answer, onPlayAnswer, onTryAgain, onShowAnswer, onNext, check, checkingLabel, onTypeInstead, sentenceView, onMoveOn, moveOnLabel, readAgain, diffOnQuestion }: HardModeFeedbackProps) {
  // The check's result you can FEEL (Jerome: "when I get it right on the very first page there's no
  // satisfying haptics … I find myself quite dependent on it"): ✓ Right = a firm double buzz + chime,
  // ✗ / ≈ a short one; checking / unknown / revealed none. Once per result (a Try again remounts it).
  useEffect(() => {
    if (result !== 'revealed') studyFeel(hardModeQuestionFeel(result));
  }, [result]);
  // A tap while a take records (🎤 Read it again) stops the take instead (the take lock).
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); if (takeTap() === 'run') fn(); };
  const saidLine = said ? <p className="hard-feedback-said" data-testid="hard-said">{hardModeSaidLine(said, spoken)}</p> : null;
  if (result === 'revealed') {
    // 👁 Show answer before a right answer: the answer IN PLACE, then on to the sentences (a miss all the same).
    return (
      <div className="hard-feedback hard-feedback--revealed" data-testid="hard-feedback" data-result="revealed" aria-live="polite">
        <p className="hard-feedback-title">{HARD_MODE_REVEALED_TITLE}</p>
        {answer && said ? (
          // He answered first: the answer once, his answer lined up with it, one line on top.
          <div data-testid="hard-revealed-answer" onClick={(e) => e.stopPropagation()}>
            <AnswerDiff
              said={said}
              expected={answer.hanzi}
              expectedPinyin={answer.pinyin}
              expectedEnglish={answer.english}
              onPlayExpected={onPlayAnswer}
              saidLabel={spoken ? ANSWER_DIFF_YOU_SAID : ANSWER_DIFF_YOUR_ANSWER}
            />
          </div>
        ) : answer ? (
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
        ) : saidLine}
        {readAgain && hardModeReadAgainOffered(readAgain.hanzi) && <HardModeReadAgain {...readAgain} />}
        <FeedbackRow>
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-continue" autoFocus>
            {hardModeRevealedNextLabel(roundFollows)} ›
          </button>
        </FeedbackRow>
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
        readAgain={readAgain}
      />
    );
  }
  if (result === 'checking') {
    return (
      <div className="hard-feedback hard-feedback--checking" data-testid="hard-feedback" data-result="checking" aria-live="polite">
        <p className="hard-feedback-title"><span className="spinner hard-feedback-spinner" aria-hidden="true" /> {checkingLabel ?? HARD_MODE_CHECKING}</p>
        <FeedbackRow>
          <button type="button" className="btn btn-secondary" onClick={stop(onShowAnswer)} data-testid="hard-show-answer">
            <span aria-hidden="true">👁</span> {HARD_MODE_SHOW_ANSWER}
          </button>
        </FeedbackRow>
      </div>
    );
  }
  // The slim diff (one line + his answer marked) wherever the answer may be seen: a right answer written
  // differently (vs the card), a miss on the read card (the hanzi is the question), or one Claude checked.
  const verdict = checkVerdict(check);
  if (result === 'right') {
    const held = difference ? (
      <AnswerDiff
        said={difference.said}
        expected={difference.model}
        expectedPinyin={difference.modelPinyin}
        expectedLabel={DIFFERENCE_CARD}
        accepted
        verdict={verdict}
        saidLabel={spoken ? ANSWER_DIFF_YOU_SAID : ANSWER_DIFF_YOUR_ANSWER}
        expectedTestId="difference-model"
        saidTestId="difference-said"
        testId="difference-compare"
      />
    ) : null;
    return (
      <div className="hard-feedback hard-feedback--right" data-testid="hard-feedback" data-result="right" data-held={difference ? 'true' : undefined} aria-live="polite">
        {held ?? (
          <>
            <p className="hard-feedback-title">{HARD_MODE_RESULT.right}</p>
            {saidLine}
          </>
        )}
        <FeedbackRow>
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        </FeedbackRow>
      </div>
    );
  }
  if (result === 'unknown') {
    return (
      <div className="hard-feedback hard-feedback--unknown" data-testid="hard-feedback" data-result="unknown" aria-live="polite">
        <p className="hard-feedback-title">{HARD_MODE_UNKNOWN}</p>
        <FeedbackRow>
          <button type="button" className="btn btn-secondary" onClick={stop(onTryAgain)} data-testid="hard-try-again">
            <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
          </button>
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        </FeedbackRow>
      </div>
    );
  }
  return (
    <div className={`hard-feedback hard-feedback--${result}`} data-testid="hard-feedback" data-result={result} aria-live="polite">
      {said && answer && (diffOnQuestion || check) ? (
        <div className="hard-feedback-check" data-testid={check ? 'hard-sentence-check' : 'hard-said-diff'} onClick={(e) => e.stopPropagation()}>
          <AnswerDiff
            said={said}
            expected={answer.hanzi}
            showExpected={false}
            headline={check?.headline}
            verdict={verdict ?? ANSWER_DIFF_VERDICT[result]}
            saidLabel={spoken ? ANSWER_DIFF_YOU_SAID : ANSWER_DIFF_YOUR_ANSWER}
          />
        </div>
      ) : (
        <>
          <p className="hard-feedback-title">{HARD_MODE_RESULT[result]}</p>
          {saidLine}
        </>
      )}
      <FeedbackRow>
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
      </FeedbackRow>
      <p className="hard-feedback-note">{HARD_MODE_MISS_NOTE}</p>
    </div>
  );
}

/**
 * A sentence answer Claude checks (shared/study/sentenceAnswerCheck.ts `sentenceCheckView`; docs/STUDY_SESSION.md
 * "Sentence answers checked by Claude"): the card's answer first — hanzi big with ▶, pinyin, English — and
 * "You said" against it, character by character, AT ONCE, under ONE line that says what differs; Claude's verdict
 * loads in below as a slim "Checking your sentence…" row, then becomes that line's chip ("≈ Almost · 1 wrong
 * character") — never its tips, explanations or a fix of his wording (docs/STUDY_SESSION.md "Answer feedback: one
 * line and a diff"). 🎤 Read it again (#722) sits under "You said" until Claude says it was right — practice only.
 * Offline / failed: the device's verdict on the same line.
 */
function SentenceAnswerFirst({ result, view, answer, said, difference, check, checkingLabel, roundFollows, moveOnLabel, onPlayAnswer, onTryAgain, onMoveOn, onNext, onTypeInstead, readAgain }: {
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
  /** 🎤 Read it again under the answer (`view.readAgain`): practice only, the card stays a miss. */
  readAgain?: HardModeReadAgainProps;
}) {
  // A tap while a take records (🎤 Read it again) stops the take instead (the take lock).
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); if (takeTap() === 'run') fn(); };
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
        <AnswerDiff
          said={said}
          expected={answer.hanzi}
          expectedPinyin={answer.pinyin}
          expectedEnglish={answer.english}
          expectedLabel={SENTENCE_CHECK_ANSWER}
          onPlayExpected={onPlayAnswer}
          accepted={view.accepted || (!check && result === 'right' && !!difference)}
          headline={check?.headline}
          verdict={view.checking ? null : checkVerdict(check) ?? (result === 'right' || result === 'close' || result === 'wrong' ? ANSWER_DIFF_VERDICT[result] : null)}
          expectedTestId="difference-model"
          saidTestId="difference-said"
        >
          {/* Right under "You said", so the verdict landing below never moves it. */}
          {readAgain && view.readAgain && <HardModeReadAgain {...readAgain} />}
        </AnswerDiff>
        {view.checking ? (
          <div className="answer-check checking hard-feedback-checking-row" role="status" data-testid="hard-sentence-checking">
            <span className="answer-check-dot" aria-hidden="true" /> {checkingLabel}
          </div>
        ) : check ? (
          <span hidden data-testid="hard-sentence-check" data-verdict={check.verdict} />
        ) : result === 'unknown' ? (
          <p className="hard-feedback-note">{HARD_MODE_UNKNOWN}</p>
        ) : null}
      </div>
      <FeedbackRow>
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
      </FeedbackRow>
      {miss && <p className="hard-feedback-note">{SENTENCE_CHECK_MOVE_ON_NOTE}</p>}
    </div>
  );
}

/**
 * A row of the panel's buttons (Continue / Next / Try again / Show answer …): while a take records (🎤 Read it
 * again sits right above it) the row gives way to ONE red "■ Stop recording" in the same place, then
 * "Checking…" — never Next under a thumb that meant to stop (the take lock, shared/voice/takeLock.ts).
 */
function FeedbackRow({ children }: { children: ReactNode }) {
  return (
    <TakeLockedActions testId="hard-feedback-stop">
      <div className="hard-feedback-row">{children}</div>
    </TakeLockedActions>
  );
}
