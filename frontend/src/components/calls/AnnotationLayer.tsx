/**
 * A canvas over a video of a shared screen: shows the drawings (both
 * people's, fading a few seconds after the pen lifts) and, when `interactive`,
 * lets me draw — a drag is a stroke, a quick tap is a "look here" ping.
 * Points are normalised to the shared picture (shared/calls/annotate.ts), so
 * they land in the same place on the other person's screen.
 */

import { useEffect, useRef } from 'react';
import { ANNOT_WIDTH, normalizePoint, simplifyPoints, type AnnotPoint, type AnnotStroke, type VideoSize } from '@shared/calls';
import { drawAnnotations, fitCanvas, type AnnotationStore } from '../../services/calls/annotations';

interface Props {
  store: AnnotationStore;
  /** The shared picture's size (the video's intrinsic size). */
  video: VideoSize | null;
  interactive?: boolean;
  color?: string;
  onStroke?: (stroke: AnnotStroke) => void;
  onPing?: (x: number, y: number) => void;
  className?: string;
  testId?: string;
}

export function AnnotationLayer({ store, video, interactive, color = '#f43f5e', onStroke, onPing, className, testId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef(video);
  videoRef.current = video;
  const drawing = useRef<{ id: string; points: AnnotPoint[]; startedAt: number; lastSent: number; moved: number; start: [number, number] } | null>(null);

  // Redraw while anything is visible (and on every change).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const frame = () => {
      raf = 0;
      const box = fitCanvas(canvas);
      const ctx = canvas.getContext('2d');
      if (ctx) drawAnnotations(ctx, box, videoRef.current, store);
      if (store.active()) raf = requestAnimationFrame(frame);
      else store.prune();
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    kick();
    const unsub = store.subscribe(kick);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(kick) : null;
    ro?.observe(canvas);
    return () => {
      unsub();
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [store]);

  const pointFor = (e: React.PointerEvent<HTMLCanvasElement>): AnnotPoint | null => {
    const r = e.currentTarget.getBoundingClientRect();
    return normalizePoint(e.clientX - r.left, e.clientY - r.top, { width: r.width, height: r.height }, videoRef.current);
  };

  const send = (done: boolean) => {
    const d = drawing.current;
    if (!d || !onStroke) return;
    const stroke: AnnotStroke = { id: d.id, color, width: ANNOT_WIDTH, points: simplifyPoints(d.points), done };
    onStroke(stroke);
    d.lastSent = Date.now();
  };

  return (
    <canvas
      ref={canvasRef}
      className={`annot-layer${interactive ? ' interactive' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onPointerDown={interactive ? (e) => {
        const p = pointFor(e);
        if (!p) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = { id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, points: [p], startedAt: Date.now(), lastSent: 0, moved: 0, start: [e.clientX, e.clientY] };
      } : undefined}
      onPointerMove={interactive ? (e) => {
        const d = drawing.current;
        if (!d) return;
        const p = pointFor(e);
        if (!p) return;
        d.points.push(p);
        d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]));
        if (d.moved > 6 && Date.now() - d.lastSent > 40) send(false);
      } : undefined}
      onPointerUp={interactive ? () => {
        const d = drawing.current;
        if (!d) return;
        if (d.moved <= 6 && Date.now() - d.startedAt < 400) onPing?.(d.points[0][0], d.points[0][1]);
        else send(true);
        drawing.current = null;
      } : undefined}
      onPointerCancel={interactive ? () => {
        if (drawing.current && drawing.current.moved > 6) send(true);
        drawing.current = null;
      } : undefined}
    />
  );
}
