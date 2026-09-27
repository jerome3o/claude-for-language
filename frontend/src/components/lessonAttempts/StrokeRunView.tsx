/**
 * A stroke-order checked handwriting run, for review: per character the
 * learner's own strokes re-drawn over the faint model outline (coloured by
 * how each stroke went), the grade, mistakes and hints.
 */

import { useEffect, useState } from 'react';
import type { StrokeWritingSummary } from '@shared/lesson';
import type { CharStrokeData } from '@shared/strokes';
import { getStrokeData } from '../../services/strokeData';

type Char = StrokeWritingSummary['characters'][number];
type Stroke = Char['strokes'][number];

const GRADE_LABEL = { perfect: 'Perfect', good: 'Good', practice: 'Needs practice' } as const;

function strokeColour(s: Stroke): string {
  if (s.revealed) return '#9ca3af';
  if (s.hinted) return '#3b82f6';
  if (s.misses > 0) return '#d97706';
  return '#16a34a';
}

function CharacterView({ c }: { c: Char }) {
  const [model, setModel] = useState<CharStrokeData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getStrokeData(c.character).then(r => { if (!cancelled && r.status === 'ok') setModel(r.data); });
    return () => { cancelled = true; };
  }, [c.character]);

  const detail = [
    c.mistakes ? `${c.mistakes} mistake${c.mistakes === 1 ? '' : 's'}` : 'no mistakes',
    c.hints ? `${c.hints} hint${c.hints === 1 ? '' : 's'}` : null,
    c.revealed ? `${c.revealed} shown` : null,
    `${(c.ms / 1000).toFixed(1)} s`,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`srv-char grade-${c.grade}`}>
      <svg viewBox="0 0 1024 1024" className="srv-svg" role="img" aria-label={`${c.character} as written`}>
        <g transform="translate(0 900) scale(1 -1)">
          {model?.strokes.map((d, i) => <path key={i} d={d} fill="#eef0f3" />)}
          {c.strokes.map((s, i) => {
            if (!s.drawn || s.drawn.length < 2) {
              const median = model?.medians[i];
              return median ? (
                <polyline key={i} points={median.map(p => p.join(',')).join(' ')} fill="none" stroke="#9ca3af" strokeWidth={40} strokeDasharray="60 50" strokeLinecap="round" />
              ) : null;
            }
            return (
              <polyline
                key={i}
                points={s.drawn.map(p => p.join(',')).join(' ')}
                fill="none"
                stroke={strokeColour(s)}
                strokeWidth={56}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      </svg>
      <div className="srv-meta">
        <span className="srv-grade">{c.character} · {GRADE_LABEL[c.grade]}</span>
        <span className="srv-detail">{detail}</span>
        {c.strokes.some(s => s.mistakes.length) && (
          <span className="srv-detail">
            {Array.from(new Set(c.strokes.flatMap(s => s.mistakes))).map(m => m.replace('_', ' ')).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}

export function StrokeRunView({ run }: { run: StrokeWritingSummary }) {
  return (
    <div className="srv">
      <div className="srv-head">
        {run.mode === 'recall' ? 'From memory' : 'Traced over the outline'} · {GRADE_LABEL[run.grade]}
      </div>
      <div className="srv-chars">
        {run.characters.map((c, i) => <CharacterView key={i} c={c} />)}
      </div>
      <div className="srv-legend">
        <span style={{ color: '#16a34a' }}>● first try</span>
        <span style={{ color: '#d97706' }}>● after a miss</span>
        <span style={{ color: '#3b82f6' }}>● with a hint</span>
        <span style={{ color: '#9ca3af' }}>● shown by the app</span>
      </div>
      {run.skipped.length > 0 && <div className="srv-detail">No stroke data for {run.skipped.join(' ')}.</div>}
    </div>
  );
}
