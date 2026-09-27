/**
 * Free handwriting: a drawing surface that captures the strokes as vectors,
 * for writing with no fixed answer (a handwritten sentence_making answer) and
 * as the offline fallback of the stroke-order pad (components/strokes) when a
 * character's stroke data isn't on the device yet. The learner compares with
 * the model and self-assesses; the tutor sees exactly what was written
 * (StrokesView re-draws it).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandwritingAnswer } from '@shared/lesson';
import './handwriting.css';

export interface HandwritingPadProps {
  /** The characters expected, when known — only used to size the writing
   * boxes (one 田字格 per character). Free writing passes nothing. */
  target?: string;
  /** Called after every stroke / undo / clear with the current answer. */
  onChange: (answer: HandwritingAnswer) => void;
  disabled?: boolean;
}

export function HandwritingPad(props: HandwritingPadProps) {
  return <SketchPad {...props} />;
}

/** Han characters in a target (punctuation doesn't get a writing box). */
export function targetChars(target: string | undefined): string[] {
  return Array.from((target ?? '').match(/\p{Script=Han}/gu) ?? []);
}

// ============ SketchPad: free drawing, strokes captured as vectors ============

const MIN_POINT_DISTANCE = 2;

export function SketchPad({ target, onChange, disabled }: HandwritingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<number[][]>([]);
  const currentRef = useRef<number[] | null>(null);
  const sizeRef = useRef({ width: 320, height: 160 });
  const [strokeCount, setStrokeCount] = useState(0);
  const boxes = Math.min(Math.max(targetChars(target).length, 1), 6);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, Math.min(width / boxes, height) / 22);
    ctx.strokeStyle = getComputedStyle(canvas).color || '#1f2937';
    for (const stroke of [...strokesRef.current, ...(currentRef.current ? [currentRef.current] : [])]) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0], stroke[1]);
      if (stroke.length === 2) ctx.lineTo(stroke[0] + 0.1, stroke[1] + 0.1);
      for (let i = 2; i < stroke.length; i += 2) ctx.lineTo(stroke[i], stroke[i + 1]);
      ctx.stroke();
    }
  }, [boxes]);

  // Size the canvas to its box (and on resize — the Fold unfolds).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const width = Math.round(wrap.clientWidth);
      const height = Math.round(Math.min(Math.max(width / boxes, 150), 240));
      sizeRef.current = { width, height };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      redraw();
    };
    fit();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    observer?.observe(wrap);
    return () => observer?.disconnect();
  }, [boxes, redraw]);

  const report = useCallback(() => {
    setStrokeCount(strokesRef.current.length);
    onChange({
      engine: 'sketch',
      strokes: { width: sizeRef.current.width, height: sizeRef.current.height, strokes: strokesRef.current.map(s => [...s]) },
    });
  }, [onChange]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top)];
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    currentRef.current = point(e);
    redraw();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const current = currentRef.current;
    if (!current) return;
    e.preventDefault();
    const [x, y] = point(e);
    const lx = current[current.length - 2];
    const ly = current[current.length - 1];
    if (Math.hypot(x - lx, y - ly) < MIN_POINT_DISTANCE) return;
    current.push(x, y);
    redraw();
  }

  function up() {
    const current = currentRef.current;
    if (!current) return;
    currentRef.current = null;
    strokesRef.current.push(current);
    redraw();
    report();
  }

  function undo() {
    strokesRef.current.pop();
    redraw();
    report();
  }

  function clear() {
    strokesRef.current = [];
    redraw();
    report();
  }

  return (
    <div className={`hw-pad ${disabled ? 'disabled' : ''}`}>
      <div className="hw-canvas-wrap" ref={wrapRef}>
        <div className="hw-grid" aria-hidden="true">
          {Array.from({ length: boxes }, (_, i) => <div key={i} className="hw-box" />)}
        </div>
        <canvas
          ref={canvasRef}
          className="hw-canvas"
          aria-label="Writing pad — write the characters here"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
      {!disabled && (
        <div className="hw-tools">
          <button type="button" className="hw-tool" onClick={undo} disabled={strokeCount === 0}>↶ Undo</button>
          <button type="button" className="hw-tool" onClick={clear} disabled={strokeCount === 0}>Clear</button>
        </div>
      )}
    </div>
  );
}
