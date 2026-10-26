/**
 * Claude's check under "🎤 You said" on a self-assessed lesson exercise (shared/lesson/answerCheck.ts,
 * docs/STUDY_SESSION.md "Claude checks your answer"):
 *
 *   [~ Almost]  The 即使…也 is right — make "don't worry" a command.
 *   即使你不记得这些词，也不别着急，你就多练习吧。      ← red-pen diff of THEIR sentence
 *   jíshǐ nǐ … · 🔊
 *   • 也不着急 is a statement …                        ← Chinese taps into the explorer
 *   Also natural: 多练习就好了。 🔊
 *   🔁 Try again   💬 Ask about this
 *
 * While checking: one slim "Checking…" row — the Got it / Missed it buttons never wait for it.
 * Offline / failed: nothing (the self-assessment as before). Lab: `AnswerCheckCard` in ui/lessons.
 *
 * A speaking check (docs/STUDY_SESSION.md "Claude checks your speaking") adds the task's parts
 * (✓ ① 就是…吧 · ~ ③ 是关于…的 · ✗ …), "A cleaner version" (what they meant, with the real fixes
 * marked) and each tip's better version with its pinyin.
 */
import type { ReactNode } from 'react';
import { answerCheckChip, cleanerVersion, speakingPartMark, tipSegments, type AnswerCheck } from '@shared/lesson/answerCheck';
import { ExplorableText } from '../explorer/ExplorableText';
import { CorrectionDiffLine } from '../chat/ChatCorrection';
import type { AnswerCheckState } from '../../hooks/useAnswerCheck';
import './AnswerCheckCard.css';

export function AnswerCheckCard({ state, answer, speak, onRetry, onAsk }: {
  state: AnswerCheckState;
  answer: string;
  speak: (text: string) => void;
  onRetry?: () => void;
  onAsk?: () => void;
}) {
  if (state.status === 'checking') {
    return (
      <div className="answer-check checking" role="status" aria-live="polite" data-testid="answer-check-checking">
        <span className="answer-check-dot" aria-hidden="true" /> Checking your answer…
      </div>
    );
  }
  if (state.status !== 'done') return null;
  return <AnswerCheckBody check={state.check} answer={answer} speak={speak} onRetry={onRetry} onAsk={onAsk} />;
}

export function AnswerCheckBody({ check, answer, speak, onRetry, onAsk, compact, afterHead }: {
  check: AnswerCheck;
  answer: string;
  speak?: (text: string) => void;
  onRetry?: () => void;
  onAsk?: () => void;
  /** The attempt review: no actions, no audio. */
  compact?: boolean;
  /** Under the chip + headline (Hard mode's "You said" vs the model answer). */
  afterHead?: ReactNode;
}) {
  const chip = answerCheckChip(check.verdict, !!check.cleaned);
  return (
    <div className={`answer-check ${chip.tone}${compact ? ' compact' : ''}`} data-testid="answer-check" data-verdict={check.verdict}>
      <div className="answer-check-head">
        <span className={`answer-check-chip ${chip.tone}`}>{chip.label}</span>
        <span className="answer-check-headline">{check.headline}</span>
      </div>
      {afterHead}
      {check.parts && check.parts.length > 0 && (
        <ul className="answer-check-parts" data-testid="answer-check-parts">
          {check.parts.map((p, i) => {
            const mark = speakingPartMark(p.status);
            return (
              <li key={i} className={`answer-check-part ${mark.tone}`} data-status={p.status}>
                <span className={`answer-check-part-mark ${mark.tone}`} aria-hidden="true">{mark.icon}</span>
                <span className="answer-check-part-body">
                  <span className="answer-check-part-label" lang="zh-CN">{p.label}</span>
                  {p.status === 'missing' && <span className="answer-check-part-missing"> missing</span>}
                  {p.note && <span className="answer-check-part-note"> — <ExplorableText text={p.note} source="lesson" /></span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {check.cleaned && <CleanerVersion check={check} speak={speak} />}
      {check.corrected && !check.cleaned && (
        <div className="answer-check-fix">
          <div className="answer-check-fix-line" lang="zh-CN" onClick={speak ? () => speak(check.corrected) : undefined}>
            <CorrectionDiffLine original={answer} corrected={check.corrected} />
            {speak && <span className="answer-check-play" aria-label="Play the corrected sentence"> 🔊</span>}
          </div>
          {check.corrected_pinyin && <div className="answer-check-pinyin">{check.corrected_pinyin}</div>}
        </div>
      )}
      {check.tips.length > 0 && (
        <ul className="answer-check-tips">
          {check.tips.map((tip, i) => {
            const { segments, quoteInText } = tipSegments(tip);
            return (
              <li key={i}>
                {tip.quote && !quoteInText && (
                  <span className="answer-check-quote"><ExplorableText text={tip.quote} segments={[{ text: tip.quote }]} source="lesson" /> · </span>
                )}
                {segments.map((s, j) =>
                  s.quote ? (
                    <mark key={j} className="answer-check-quote"><ExplorableText text={s.text} segments={[{ text: s.text }]} source="lesson" /></mark>
                  ) : s.han ? (
                    <ExplorableText key={j} text={s.text} source="lesson" />
                  ) : (
                    <span key={j}>{s.text}</span>
                  ),
                )}
                {tip.fix && (
                  <div className="answer-check-tip-fix">
                    <span className="answer-check-tip-arrow" aria-hidden="true">→ </span>
                    <span lang="zh-CN" className="answer-check-tip-fix-hanzi"><ExplorableText text={tip.fix} source="lesson" /></span>
                    {speak && <button type="button" className="answer-check-icon" onClick={() => speak(tip.fix!)} aria-label="Play the better version">🔊</button>}
                    {tip.fix_pinyin && <span className="answer-check-pinyin"> {tip.fix_pinyin}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {check.alternative && (
        <div className="answer-check-alt">
          <span className="answer-check-alt-label">Also natural:</span>{' '}
          <span className="answer-check-alt-hanzi" lang="zh-CN"><ExplorableText text={check.alternative.hanzi} source="lesson" /></span>
          {speak && (
            <button type="button" className="answer-check-icon" onClick={() => speak(check.alternative!.hanzi)} aria-label="Play the alternative">🔊</button>
          )}
          {check.alternative.pinyin && <div className="answer-check-pinyin">{check.alternative.pinyin}</div>}
          {check.alternative.english && <div className="answer-check-alt-english">{check.alternative.english}</div>}
        </div>
      )}
      {(onRetry || onAsk) && (
        <div className="answer-check-actions">
          {onRetry && <button type="button" className="answer-check-action" onClick={onRetry} data-testid="answer-check-retry">🔁 Try again</button>}
          {onAsk && <button type="button" className="answer-check-action" onClick={onAsk} data-testid="answer-check-ask">💬 Ask about this</button>}
        </div>
      )}
    </div>
  );
}

/** Speaking: "A cleaner version" — what they meant, with the real fixes marked in green. */
function CleanerVersion({ check, speak }: { check: AnswerCheck; speak?: (text: string) => void }) {
  const v = cleanerVersion(check);
  if (!v.hanzi) return null;
  return (
    <div className="answer-check-fix answer-check-cleaner" data-testid="answer-check-cleaner">
      <div className="answer-check-cleaner-label">{v.diffFrom ? 'A cleaner version' : 'What you said, tidied up'}</div>
      <div className="answer-check-fix-line speaking" lang="zh-CN" onClick={speak ? () => speak(v.hanzi) : undefined}>
        {v.diffFrom ? <CorrectionDiffLine original={v.diffFrom} corrected={v.hanzi} /> : v.hanzi}
        {speak && <span className="answer-check-play" aria-label="Play the cleaner version"> 🔊</span>}
      </div>
      {v.pinyin && <div className="answer-check-pinyin">{v.pinyin}</div>}
    </div>
  );
}
