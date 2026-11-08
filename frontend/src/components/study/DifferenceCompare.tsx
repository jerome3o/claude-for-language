/**
 * "You said" vs the model answer (docs/STUDY_SESSION.md "Right, but said differently";
 * shared/study/answerDifference.ts): two lines, the characters each has that the other hasn't marked
 * with the "You said" row's marks (yellow + dotted = differs, red + solid = not in the answer), the
 * pinyin of both, ▶ on the model when it can be played. Lab: `DifferenceCompare` in ui/study/DifferenceCompare.kt.
 *
 * `answerFirst` (a sentence answer Claude checks, shared/study/sentenceAnswerCheck.ts `sentenceCheckView`):
 * the model answer comes FIRST and big — its label, the hanzi marked, ▶, its pinyin and English — then
 * "You said" against it.
 */
import { useMemo } from 'react';
import { differenceLines, DIFFERENCE_MODEL, DIFFERENCE_SAID } from '@shared/study/answerDifference';
import type { SpokenResultChar } from '@shared/cards/spoken-result';
import { devicePinyinLine } from '../../utils/autoPinyin';
import { tidyPinyin } from './YouSaid';
import './DifferenceCompare.css';

function Marked({ chars }: { chars: SpokenResultChar[] }) {
  return (
    <>
      {chars.map((c, i) => (
        <span key={i} className={`spoken-mark spoken-mark--${c.mark}`} data-mark={c.mark}>{c.char}</span>
      ))}
    </>
  );
}

export function DifferenceCompare({ said, model, modelPinyin, accepted, modelLabel = DIFFERENCE_MODEL, onPlayModel, answerFirst }: {
  said: string;
  model: string;
  /** The model's own pinyin (else the device's). */
  modelPinyin?: string | null;
  /** Right (differences in yellow) or not (his in red). */
  accepted: boolean;
  modelLabel?: string;
  onPlayModel?: () => void;
  /** The model answer first and big, with its English (`modelLabel` over it). */
  answerFirst?: { english?: string | null } | null;
}) {
  const lines = useMemo(() => differenceLines(said, model, accepted), [said, model, accepted]);
  const saidPinyin = useMemo(() => tidyPinyin(devicePinyinLine(said)), [said]);
  const ownPinyin = modelPinyin?.trim() || '';
  const derivedPinyin = useMemo(() => (ownPinyin ? '' : tidyPinyin(devicePinyinLine(model))), [ownPinyin, model]);
  const pinyin = ownPinyin || derivedPinyin;
  const play = onPlayModel ? (
    <button
      type="button"
      className="difference-compare-play"
      onClick={(e) => { e.stopPropagation(); onPlayModel(); }}
      aria-label={`Play: ${model}`}
      data-testid="difference-play-model"
    >
      ▶
    </button>
  ) : null;
  const saidRow = (
    <div className="difference-compare-row" data-testid="difference-said">
      <span className="difference-compare-label">{DIFFERENCE_SAID}</span>
      <span className="difference-compare-text">
        <span className="difference-compare-hanzi" lang="zh-CN"><Marked chars={lines.said} /></span>
        {saidPinyin && <span className="difference-compare-pinyin">{saidPinyin}</span>}
      </span>
    </div>
  );
  if (answerFirst) {
    return (
      <div className="difference-compare difference-compare--answer-first" data-testid="difference-compare" data-answer-first="true">
        <div className="difference-compare-answer" data-testid="difference-model">
          <span className="difference-compare-label">{modelLabel}</span>
          <div className="difference-compare-answer-line">
            <span className="difference-compare-answer-hanzi" lang="zh-CN"><Marked chars={lines.model} /></span>
            {play}
          </div>
          {pinyin && <span className="difference-compare-answer-pinyin">{pinyin}</span>}
          {answerFirst.english && <span className="difference-compare-answer-en" data-testid="difference-model-english">{answerFirst.english}</span>}
        </div>
        {saidRow}
      </div>
    );
  }
  return (
    <div className="difference-compare" data-testid="difference-compare">
      {saidRow}
      <div className="difference-compare-row" data-testid="difference-model">
        <span className="difference-compare-label">{modelLabel}</span>
        <span className="difference-compare-text">
          <span className="difference-compare-hanzi" lang="zh-CN"><Marked chars={lines.model} /></span>
          {pinyin && <span className="difference-compare-pinyin">{pinyin}</span>}
        </span>
        {play}
      </div>
    </div>
  );
}
