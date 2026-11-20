/**
 * The slim answer feedback (docs/STUDY_SESSION.md "Answer feedback: one line and a diff"; rules in
 * shared/cards/answer-diff.ts): ONE short line that says what differs, the expected answer once (▶ where it can be
 * played), and his answer lined up with it character by character —
 *
 *   ✕ 1 wrong character, 1 missing
 *   ANSWER   我的书呢 ▶
 *            wǒ de shū ne
 *   YOU SAID 他的书呢            ← 他 in rose, 呢 (left out) in grey
 *            tā de shū           ← his own pinyin, tā in rose (AnswerDiffPinyin)
 *
 * No explanations, tips or reasons. The marks are COLOUR ONLY (Jerome, Nov 2026: "we don't need the outlines and
 * the color and the underlines"; the same language as the reader's read-aloud marks): the character itself in its
 * mark's colour (index.css `--mark-*`) — wrong rose, tone off amber, extra violet, missing = the expected character
 * in grey; a homophone counts as right and has no mark. No box, tint or underline. Colour is never the only signal:
 * the line says what differs in words, screen readers get the whole diff as one sentence (`answerDiffLabel`) and
 * each marked character carries its own title (`answerDiffPartLabel`). Lab twin: ui/study/AnswerDiffView.kt.
 */
import { useMemo, type ReactNode } from 'react';
import {
  answerDiff, answerDiffLabel, answerDiffLine, answerDiffPartLabel, answerDiffTone, ANSWER_DIFF_ICON, ANSWER_DIFF_YOU_SAID,
  type AnswerDiffPart, type AnswerDiffTone,
} from '@shared/cards/answer-diff';
import { answerAskOffered, answerAskQuestion, answerMore, answerWhy, type AnswerWhyCheck } from '@shared/cards/answer-why';
import { devicePinyinLine } from '../../utils/autoPinyin';
import { AnswerWhy } from './AnswerWhy';
import { AnswerDiffPinyin } from './AnswerDiffPinyin';
import { useAnswerAsk } from './answerAsk';
import './AnswerDiff.css';

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** His answer's characters, marked (the diff line alone — "You said" rows reuse it). */
export function AnswerDiffChars({ parts, testId = 'answer-diff-chars' }: { parts: readonly AnswerDiffPart[]; testId?: string }) {
  return (
    <span className="adiff-chars" lang="zh-CN" data-testid={testId} aria-hidden="true">
      {parts.map((p, i) => (p.kind === 'ok' || p.kind === 'plain'
        ? <span key={i}>{p.text}</span>
        : <span key={i} className={`adiff adiff--${p.kind}`} data-kind={p.kind} title={answerDiffPartLabel(p)}>{p.text}</span>))}
    </span>
  );
}

export interface AnswerDiffProps {
  said: string;
  expected: string;
  /** The expected answer's own pinyin (else the device's). */
  expectedPinyin?: string | null;
  expectedEnglish?: string | null;
  /** The label over the expected line (default "Answer"). */
  expectedLabel?: string;
  /** Show the expected line (off where the answer is already on screen — the read card's hanzi). */
  showExpected?: boolean;
  onPlayExpected?: () => void;
  /** Right in other words (Claude correct / acceptable, a listed alternative): "Right — worded differently", quiet marks. */
  accepted?: boolean;
  /** Claude's headline: its first sentence stands in only when the answer is too different for a count. */
  headline?: string | null;
  /** A verdict that isn't the diff's own (Claude's chip, "≈ Nearly"): replaces the line's icon + tone. */
  verdict?: { tone: AnswerDiffTone; label: string } | null;
  /** Override the line (a waiting "Checking…" row, …). */
  line?: ReactNode;
  /** No line: the surface already says the verdict right above (the Sentence round's held "✓ Right — worded differently"). */
  hideLine?: boolean;
  saidLabel?: string;
  expectedTestId?: string;
  saidTestId?: string;
  playTestId?: string;
  /**
   * The check that judged it (Claude's answer check, the sentence check, the read-take check's reason): its headline /
   * first tip is the ONE why sentence under the diff, its tips / fix / alternative what "Explain more ›" opens
   * (shared/cards/answer-why.ts). No check: the device's own reason where it has one (a homophone).
   */
  check?: AnswerWhyCheck | null;
  /** The why, given (else from `check` / the diff); `null` = none. */
  why?: string | null;
  /**
   * "Explain more ›" with nothing on hand: Ask Claude about this answer. Default: the card's Claude thread when the
   * surface provides one (`AnswerAskContext`) — which also offers the small "💬 Ask Claude" link when the check gave no
   * reason at all (`answerAskOffered`).
   */
  onExplainMore?: () => void;
  /** What he was asked (the English he said in Chinese) — for the question Ask Claude sends; default `expectedEnglish`. */
  askPrompt?: string | null;
  /**
   * Off: no Ask Claude here — while Claude is still checking (its reason may be on the way), or while the answer is
   * still hidden (Hard mode's question before 👁 Show answer: the question would give it away).
   */
  askable?: boolean;
  /** Analytics: the surface (study.answer_why_more). */
  whySurface?: string;
  /** Under the diff (🎤 Read it again …). */
  children?: ReactNode;
  testId?: string;
  /**
   * A WRITTEN answer (typed / handwritten characters): judged by the characters, so a homophone is a wrong
   * character (`answerDiff(…, { written: true })`).
   */
  written?: boolean;
}

export function AnswerDiff({
  said, expected, expectedPinyin, expectedEnglish, expectedLabel = 'Answer', showExpected = true, onPlayExpected,
  accepted = false, headline, verdict, line, hideLine = false, saidLabel = ANSWER_DIFF_YOU_SAID, check, why, onExplainMore, askPrompt, askable = true, whySurface,
  children, testId = 'answer-diff', written = false,
  expectedTestId = 'answer-diff-expected', saidTestId = 'answer-diff-said', playTestId = 'answer-diff-play',
}: AnswerDiffProps) {
  const diff = useMemo(() => answerDiff(said, expected, { written }), [said, expected, written]);
  const full = answerDiffLine({ diff, accepted, headline });
  // Under a "✓ Also right" chip, "Right — worded differently" says "right" twice: just "Worded differently".
  const text = verdict?.tone === 'right' && full.startsWith('Right — ') ? capitalize(full.slice('Right — '.length)) : full;
  const tone = verdict?.tone ?? answerDiffTone(diff, accepted);
  const ownPinyin = expectedPinyin?.trim() || '';
  const derived = useMemo(() => (ownPinyin || !showExpected ? '' : devicePinyinLine(expected).trim()), [ownPinyin, showExpected, expected]);
  const pinyin = ownPinyin || derived;
  const whyText = why !== undefined ? why : answerWhy({ diff, check: check ?? (headline ? { headline } : null), line: text });
  const more = answerMore(check ?? null, whyText, said, showExpected ? expected : '');
  // Ask Claude about this answer: the surface's own path, else the card's Claude thread (online only).
  const askCtx = useAnswerAsk();
  const askCard = askCtx && !written
    ? () => askCtx.ask(answerAskQuestion({ said, expected, prompt: askPrompt ?? expectedEnglish, spoken: saidLabel === ANSWER_DIFF_YOU_SAID }))
    : undefined;
  const onAsk = askable ? onExplainMore ?? askCard : undefined;
  // Nothing explains a not-right answer: one small "💬 Ask Claude" link (never when a why + Explain more is there).
  const askFallback = answerAskOffered({ tone, why: whyText, more, canAsk: !!onAsk }) ? onAsk : undefined;
  return (
    <div className={`adiff-box${accepted ? ' adiff-box--accepted' : ''}`} data-testid={testId} data-tone={tone}>
      {hideLine ? null : line ?? (
        <p className={`adiff-line adiff-line--${tone}`} data-testid="answer-diff-line" role="status">
          <span className="adiff-line-icon" aria-hidden="true">{ANSWER_DIFF_ICON[tone]}</span>{' '}
          {verdict && <span className="adiff-line-verdict" data-testid="answer-diff-verdict">{verdict.label}</span>}
          {verdict && <span className="adiff-line-sep" aria-hidden="true"> · </span>}
          <span className="adiff-line-text" data-testid="answer-diff-text">{text}</span>
        </p>
      )}
      {showExpected && (
        <div className="adiff-row adiff-row--expected" data-testid={expectedTestId}>
          <span className="adiff-label">{expectedLabel}</span>
          <div className="adiff-expected">
            <span className="adiff-expected-line">
              <span className="adiff-expected-zh" lang="zh-CN">{expected}</span>
              {onPlayExpected && (
                <button
                  type="button"
                  className="adiff-play"
                  onClick={(e) => { e.stopPropagation(); onPlayExpected(); }}
                  aria-label={`Play: ${expected}`}
                  data-testid={playTestId}
                >
                  ▶
                </button>
              )}
            </span>
            {pinyin && <span className="adiff-expected-py">{pinyin}</span>}
            {expectedEnglish && <span className="adiff-expected-en" data-testid={`${expectedTestId}-english`}>{expectedEnglish}</span>}
          </div>
        </div>
      )}
      {!diff.empty && (
        <div className="adiff-row adiff-row--said" data-testid={saidTestId}>
          <span className="adiff-label">{saidLabel}</span>
          <span className="adiff-said">
            <span className="adiff-sr">{answerDiffLabel(diff, text, saidLabel)}</span>
            <AnswerDiffChars parts={diff.parts} />
            <AnswerDiffPinyin diff={diff} said={said} accepted={accepted} />
          </span>
        </div>
      )}
      {!diff.empty && <AnswerWhy why={whyText} more={more} onAsk={onAsk} askFallback={askFallback} surface={whySurface} />}
      {children}
    </div>
  );
}
