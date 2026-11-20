/**
 * The pinyin line under "You said" (Jerome, Nov 2026: "the stuff that I said that was incorrect also has pinyin, so I
 * can see where my pronunciation was"): HIS syllables — the device's own automatic pinyin of what he said, + 一 / 不,
 * never a network call — in the same style and size as the answer's pinyin, so wǔzhù sits under wǔrǔ. The syllables of
 * his wrong / tone-off / extra characters carry the same subtle colour as those characters (`answerDiffPinyin` in
 * shared/cards/answer-diff.ts); what he left out has none. When the parts don't line up, the device's plain line.
 * Lab twin: `DiffPinyinLine` in ui/study/AnswerDiffView.kt.
 */
import { useMemo } from 'react';
import { answerDiffPinyin, type AnswerDiff } from '@shared/cards/answer-diff';
import { devicePinyinLine } from '../../utils/autoPinyin';
import './AnswerDiff.css';

const HAN = /\p{Script=Han}/u;

export function AnswerDiffPinyin({ diff, said, className = 'adiff-said-py', testId = 'answer-diff-said-pinyin', accepted = false }: {
  diff: AnswerDiff;
  /** What he said (the plain fallback line's text). */
  said: string;
  className?: string;
  testId?: string;
  /** Right in other words: no marks (as on the characters). */
  accepted?: boolean;
}) {
  const syllables = useMemo(() => answerDiffPinyin(diff), [diff]);
  const plain = useMemo(() => (syllables || !HAN.test(said) ? '' : devicePinyinLine(said).trim()), [syllables, said]);
  if (!syllables && !plain) return null;
  return (
    <span className={className} data-testid={testId} aria-hidden="true">
      {syllables
        ? syllables.map((s, i) => {
          const marked = !accepted && (s.kind === 'wrong' || s.kind === 'tone' || s.kind === 'extra');
          return (
            <span key={i}>
              {i > 0 && ' '}
              {marked ? <span className={`adiff adiff--${s.kind}`} data-kind={s.kind}>{s.text}</span> : s.text}
            </span>
          );
        })
        : plain}
    </span>
  );
}
