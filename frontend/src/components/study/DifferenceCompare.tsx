/**
 * "You said" vs the model answer (docs/STUDY_SESSION.md "Right, but said differently"): now the slim answer diff
 * (components/study/AnswerDiff.tsx, shared/cards/answer-diff.ts) — ONE line that says what differs, the model
 * once (▶), his answer lined up with it. Kept as a thin wrapper so the callers' words and test ids stay.
 * Lab: `DifferenceCompare` in ui/study/DifferenceCompare.kt.
 */
import type { ReactNode } from 'react';
import { DIFFERENCE_MODEL } from '@shared/study/answerDifference';
import type { AnswerDiffTone } from '@shared/cards/answer-diff';
import { AnswerDiff } from './AnswerDiff';
import './DifferenceCompare.css';

export function DifferenceCompare({ said, model, modelPinyin, accepted, modelLabel = DIFFERENCE_MODEL, onPlayModel, answerFirst, verdict, headline, hideLine, children }: {
  said: string;
  model: string;
  /** The model's own pinyin (else the device's). */
  modelPinyin?: string | null;
  /** Right in other words (quiet marks, "Right — worded differently") or not. */
  accepted: boolean;
  modelLabel?: string;
  onPlayModel?: () => void;
  /** The model's English under it. */
  answerFirst?: { english?: string | null } | null;
  /** Claude's verdict as the line's chip. */
  verdict?: { tone: AnswerDiffTone; label: string } | null;
  headline?: string | null;
  hideLine?: boolean;
  children?: ReactNode;
}) {
  return (
    <AnswerDiff
      said={said}
      expected={model}
      expectedPinyin={modelPinyin}
      expectedEnglish={answerFirst?.english}
      expectedLabel={modelLabel}
      onPlayExpected={onPlayModel}
      accepted={accepted}
      verdict={verdict}
      headline={headline}
      hideLine={hideLine}
      testId="difference-compare"
      expectedTestId="difference-model"
      saidTestId="difference-said"
    >
      {children}
    </AnswerDiff>
  );
}
