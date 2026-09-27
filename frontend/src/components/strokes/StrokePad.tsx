import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { brushPath, strokeStart, type CharStrokeData, type HintLevel, type Point } from '@shared/strokes';

/**
 * One character's writing surface: a 米字格 practice square with the stroke
 * data drawn in data space (1024 box, y up — flipped by the inner <g>) and the
 * learner's ink in view space. Purely presentational: the parent owns the
 * quiz and tells the pad what to show; the pad hands back each finished
 * drawing through `onStroke` and is told how to dispose of the ink.
 */

export type InkOutcome = 'accept' | 'reject' | 'ignore';

export interface StrokePadProps {
  data: CharStrokeData;
  /** Grey outline of the whole character (trace mode, and behind the demo). */
  showOutline: boolean;
  /** Strokes already written, in order (revealed ones are drawn in the "given" colour). */
  completed: { index: number; revealed: boolean }[];
  /** Animate this one in (the stroke just accepted / revealed). */
  justCompleted: number | null;
  /** Help for the stroke being written. */
  hint: { index: number; level: HintLevel } | null;
  /** Non-null → play the stroke-order animation (a new key restarts it). */
  demoKey: number | null;
  /** Show stroke numbers during the demo. */
  demoNumbers?: boolean;
  onDemoEnd?: () => void;
  /** Glow for a finished character. */
  celebrate?: 'perfect' | 'good' | 'practice' | null;
  disabled?: boolean;
  /** A finished drawing, in data space; the return value decides what happens to the ink. */
  onStroke?: (points: Point[]) => InkOutcome;
  /** The learner put the pen down (e.g. to cancel a running demo). */
  onPenDown?: () => void;
  label?: string;
}

const VIEW = 1024;
const BRUSH_WIDTH = 190;
const DEMO_GAP_MS = 120;

function demoDuration(length: number): number {
  return Math.round(260 + length * 0.55);
}

export function StrokePad({
  data,
  showOutline,
  completed,
  justCompleted,
  hint,
  demoKey,
  demoNumbers = true,
  onDemoEnd,
  celebrate,
  disabled,
  onStroke,
  onPenDown,
  label,
}: StrokePadProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const inkRef = useRef<SVGPathElement>(null);
  const drawing = useRef<{ id: number; data: Point[]; view: [number, number][] } | null>(null);
  const [rejected, setRejected] = useState<{ d: string; key: number } | null>(null);

  const brushes = useMemo(() => data.medians.map((m) => brushPath(m)), [data]);
  const starts = useMemo(() => data.medians.map((m) => strokeStart(m)), [data]);

  // Demo timeline: each stroke starts when the previous one ends.
  const demoTimeline = useMemo(() => {
    let t = 250;
    return brushes.map((b) => {
      const dur = demoDuration(b.length);
      const entry = { delay: t, dur };
      t += dur + DEMO_GAP_MS;
      return entry;
    });
  }, [brushes]);

  useEffect(() => {
    if (demoKey === null || !onDemoEnd) return;
    const last = demoTimeline[demoTimeline.length - 1];
    const total = last ? last.delay + last.dur + 400 : 0;
    const t = window.setTimeout(onDemoEnd, total);
    return () => window.clearTimeout(t);
  }, [demoKey, demoTimeline, onDemoEnd]);

  useEffect(() => {
    if (!rejected) return;
    const t = window.setTimeout(() => setRejected(null), 650);
    return () => window.clearTimeout(t);
  }, [rejected]);

  const toPoints = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return null;
    const vx = ((e.clientX - r.left) / r.width) * VIEW;
    const vy = ((e.clientY - r.top) / r.height) * VIEW;
    return { view: [vx, vy] as [number, number], data: { x: vx, y: 900 - vy } };
  }, []);

  const renderInk = () => {
    const d = drawing.current;
    const el = inkRef.current;
    if (!el) return;
    if (!d || d.view.length === 0) {
      el.setAttribute('d', '');
      return;
    }
    const pts = d.view.length === 1 ? [d.view[0], d.view[0]] : d.view;
    el.setAttribute('d', pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''));
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || drawing.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = toPoints(e);
    if (!p) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not all environments support capture
    }
    drawing.current = { id: e.pointerId, data: [p.data], view: [p.view] };
    renderInk();
    onPenDown?.();
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [native]) {
      const p = toPoints(ev);
      if (!p) continue;
      d.data.push(p.data);
      d.view.push(p.view);
    }
    renderInk();
  };

  const finish = (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    const viewD = inkRef.current?.getAttribute('d') ?? '';
    renderInk();
    if (cancelled || !onStroke) return;
    const outcome = onStroke(d.data);
    if (outcome === 'reject' && viewD) setRejected({ d: viewD, key: Date.now() });
  };

  const demoing = demoKey !== null;
  const completedSet = new Map(completed.map((c) => [c.index, c]));
  const hintStart = hint && hint.level !== 'none' ? starts[hint.index] : null;

  return (
    <div className={`sp-wrap${celebrate ? ` sp-celebrate sp-celebrate-${celebrate}` : ''}`}>
      <svg
        ref={svgRef}
        className={`sp-svg${disabled ? ' sp-disabled' : ''}`}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label={label ?? 'Writing pad'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        data-testid="stroke-pad"
      >
        <defs>
          {data.strokes.map((s, i) => (
            <clipPath id={`${uid}-c${i}`} key={i}>
              <path d={s} />
            </clipPath>
          ))}
        </defs>

        {/* 米字格 guides */}
        <g className="sp-grid" aria-hidden="true">
          <rect x="6" y="6" width={VIEW - 12} height={VIEW - 12} className="sp-grid-border" />
          <line x1="0" y1={VIEW / 2} x2={VIEW} y2={VIEW / 2} />
          <line x1={VIEW / 2} y1="0" x2={VIEW / 2} y2={VIEW} />
          <line x1="0" y1="0" x2={VIEW} y2={VIEW} />
          <line x1={VIEW} y1="0" x2="0" y2={VIEW} />
        </g>

        <g transform="translate(0 900) scale(1 -1)">
          {(showOutline || demoing) &&
            data.strokes.map((s, i) => <path key={`o${i}`} d={s} className="sp-outline" />)}

          {demoing
            ? brushes.map((b, i) => (
                <path
                  key={`d${demoKey}-${i}`}
                  d={b.d}
                  clipPath={`url(#${uid}-c${i})`}
                  className="sp-brush sp-brush-demo"
                  strokeWidth={BRUSH_WIDTH}
                  style={{
                    strokeDasharray: `${b.length} ${b.length + 400}`,
                    strokeDashoffset: b.length,
                    animationDuration: `${demoTimeline[i].dur}ms`,
                    animationDelay: `${demoTimeline[i].delay}ms`,
                  }}
                />
              ))
            : data.strokes.map((s, i) => {
                const c = completedSet.get(i);
                if (!c) return null;
                const cls = c.revealed ? 'sp-done sp-done-revealed' : 'sp-done';
                if (i !== justCompleted) return <path key={`f${i}`} d={s} className={cls} />;
                const b = brushes[i];
                return (
                  <g key={`j${i}`}>
                    <path
                      d={b.d}
                      clipPath={`url(#${uid}-c${i})`}
                      className={`sp-brush ${c.revealed ? 'sp-brush-revealed' : 'sp-brush-snap'}`}
                      strokeWidth={BRUSH_WIDTH}
                      style={{
                        strokeDasharray: `${b.length} ${b.length + 400}`,
                        strokeDashoffset: b.length,
                        animationDuration: c.revealed ? '700ms' : '240ms',
                      }}
                    />
                    {!c.revealed && <path d={s} className="sp-glow" />}
                  </g>
                );
              })}

          {!demoing && hint && hint.level === 'stroke' && brushes[hint.index] && (
            <path
              key={`h${hint.index}`}
              d={brushes[hint.index].d}
              clipPath={`url(#${uid}-c${hint.index})`}
              className="sp-brush sp-brush-hint"
              strokeWidth={BRUSH_WIDTH}
              style={{
                strokeDasharray: `${brushes[hint.index].length} ${brushes[hint.index].length + 400}`,
                strokeDashoffset: brushes[hint.index].length,
                ['--len' as string]: brushes[hint.index].length,
              }}
            />
          )}
        </g>

        {/* start dot + direction arrow (view space so the arrowhead isn't mirrored) */}
        {!demoing && hintStart && (
          <g className="sp-start" aria-hidden="true">
            {(() => {
              const sx = hintStart.start.x;
              const sy = 900 - hintStart.start.y;
              const dx = hintStart.dir.x;
              const dy = -hintStart.dir.y;
              const ex = sx + dx * 150;
              const ey = sy + dy * 150;
              const ax = -dy;
              const ay = dx;
              return (
                <>
                  <line x1={sx} y1={sy} x2={ex} y2={ey} className="sp-arrow" />
                  <path
                    d={`M${ex + dx * 34} ${ey + dy * 34} L${ex + ax * 26} ${ey + ay * 26} L${ex - ax * 26} ${ey - ay * 26} Z`}
                    className="sp-arrowhead"
                  />
                  <circle cx={sx} cy={sy} r="38" className="sp-start-dot" />
                </>
              );
            })()}
          </g>
        )}

        {demoing && demoNumbers && (
          <g className="sp-numbers" aria-hidden="true">
            {starts.map((s, i) => (
              <g
                key={`n${demoKey}-${i}`}
                className="sp-number"
                style={{ animationDelay: `${demoTimeline[i].delay}ms` }}
              >
                <circle cx={s.start.x} cy={900 - s.start.y} r="34" />
                <text x={s.start.x} y={900 - s.start.y} dy="0.36em">
                  {i + 1}
                </text>
              </g>
            ))}
          </g>
        )}

        {rejected && <path key={rejected.key} d={rejected.d} className="sp-ink sp-ink-wrong" />}
        <path ref={inkRef} className="sp-ink" d="" />
      </svg>
    </div>
  );
}
