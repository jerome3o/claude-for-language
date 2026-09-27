/**
 * Re-draws captured handwriting (vector strokes) as SVG — beside the model
 * characters after a handwriting exercise, and on the tutor's review page.
 */

import type { HandwritingStrokes } from '@shared/lesson';
import './handwriting.css';

export function StrokesView({ strokes, label, maxHeight = 140 }: { strokes: HandwritingStrokes; label?: string; maxHeight?: number }) {
  const { width, height } = strokes;
  const lineWidth = Math.max(4, height / 22);
  return (
    <figure className="hw-view">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ maxHeight, width: '100%' }}
        role="img"
        aria-label={label ?? 'Handwritten answer'}
        preserveAspectRatio="xMidYMid meet"
      >
        {strokes.strokes.map((s, i) => {
          if (s.length < 2) return null;
          if (s.length === 2) return <circle key={i} cx={s[0]} cy={s[1]} r={lineWidth / 2} className="hw-dot" />;
          const points: string[] = [];
          for (let j = 0; j < s.length; j += 2) points.push(`${s[j]},${s[j + 1]}`);
          return <polyline key={i} points={points.join(' ')} strokeWidth={lineWidth} className="hw-line" />;
        })}
      </svg>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}
