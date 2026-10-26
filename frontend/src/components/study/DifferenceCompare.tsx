/**
 * "You said" vs the model answer (docs/STUDY_SESSION.md "Right, but said differently";
 * shared/study/answerDifference.ts): two lines, the characters each has that the other hasn't marked
 * with the "You said" row's marks (yellow + dotted = differs, red + solid = not in the answer), the
 * pinyin of both, ▶ on the model when it can be played. Lab: `DifferenceCompare` in ui/study/HardModeUi.kt.
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

export function DifferenceCompare({ said, model, modelPinyin, accepted, modelLabel = DIFFERENCE_MODEL, onPlayModel }: {
  said: string;
  model: string;
  /** The model's own pinyin (else the device's). */
  modelPinyin?: string | null;
  /** Right (differences in yellow) or not (his in red). */
  accepted: boolean;
  modelLabel?: string;
  onPlayModel?: () => void;
}) {
  const lines = useMemo(() => differenceLines(said, model, accepted), [said, model, accepted]);
  const saidPinyin = useMemo(() => tidyPinyin(devicePinyinLine(said)), [said]);
  const ownPinyin = modelPinyin?.trim() || '';
  const derivedPinyin = useMemo(() => (ownPinyin ? '' : tidyPinyin(devicePinyinLine(model))), [ownPinyin, model]);
  const pinyin = ownPinyin || derivedPinyin;
  return (
    <div className="difference-compare" data-testid="difference-compare">
      <div className="difference-compare-row" data-testid="difference-said">
        <span className="difference-compare-label">{DIFFERENCE_SAID}</span>
        <span className="difference-compare-text">
          <span className="difference-compare-hanzi" lang="zh-CN"><Marked chars={lines.said} /></span>
          {saidPinyin && <span className="difference-compare-pinyin">{saidPinyin}</span>}
        </span>
      </div>
      <div className="difference-compare-row" data-testid="difference-model">
        <span className="difference-compare-label">{modelLabel}</span>
        <span className="difference-compare-text">
          <span className="difference-compare-hanzi" lang="zh-CN"><Marked chars={lines.model} /></span>
          {pinyin && <span className="difference-compare-pinyin">{pinyin}</span>}
        </span>
        {onPlayModel && (
          <button
            type="button"
            className="difference-compare-play"
            onClick={(e) => { e.stopPropagation(); onPlayModel(); }}
            aria-label={`Play: ${model}`}
            data-testid="difference-play-model"
          >
            ▶
          </button>
        )}
      </div>
    </div>
  );
}
