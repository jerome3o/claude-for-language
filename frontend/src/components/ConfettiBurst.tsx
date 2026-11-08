/**
 * A SMALL confetti burst at one spot (a right answer's verdict) — not the full-screen rain of
 * `Confetti`. Drop it inside a `position: relative` element: ~22 pieces fly out from its centre and
 * fade in ~0.8 s, never catching a tap. Lab: `ConfettiBurst` in ui/fx/Effects.kt.
 */
import { useState, type CSSProperties } from 'react';
import './ConfettiBurst.css';

const COLORS = ['#22c55e', '#3b82f6', '#f97316', '#ef4444', '#a855f7', '#eab308'];

export function ConfettiBurst({ count = 22, testId = 'confetti-burst' }: { count?: number; testId?: string }) {
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const reach = 40 + Math.random() * 50;
      return {
        dx: Math.round(Math.cos(angle) * reach * 1.6),
        dy: Math.round(Math.sin(angle) * reach - 18),
        rot: Math.round((Math.random() - 0.5) * 540),
        color: COLORS[i % COLORS.length],
        delay: Math.round(Math.random() * 60),
        w: 5 + Math.round(Math.random() * 3),
      };
    }),
  );
  return (
    <span className="confetti-burst" aria-hidden="true" data-testid={testId}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-burst-piece"
          style={{
            '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg`,
            background: p.color, width: p.w, height: p.w * 1.6, animationDelay: `${p.delay}ms`,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}
