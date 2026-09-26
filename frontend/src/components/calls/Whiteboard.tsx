/**
 * The shared whiteboard: draw with a finger / pen / mouse, tap with the text
 * tool to type (IME works — type 你好 with pinyin), undo your last item,
 * clear. Every committed item goes to the room; strokes in progress are
 * streamed so the other side sees the ink appear as you write.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BOARD_COLORS, lastItemBy, type BoardItem, type BoardOp, type BoardPoint, type LiveStroke } from '@shared/calls';
import { drawBoard, fitBoard } from '../../services/calls/boardRender';

type Tool = 'pen' | 'text';

interface Props {
  items: BoardItem[];
  live: LiveStroke[];
  myUserId: string;
  onCommit: (op: BoardOp) => void;
  onLive: (stroke: LiveStroke | null) => void;
}

const PEN_WIDTH = 10;
const TEXT_SIZE = 80;

function newId(): string {
  return crypto.randomUUID().slice(0, 18);
}

export function Whiteboard({ items, live, myUserId, onCommit, onLive }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const drawing = useRef<LiveStroke | null>(null);
  const lastLiveSend = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(fitBoard(el.clientWidth, el.clientHeight)));
    ro.observe(el);
    setSize(fitBoard(el.clientWidth, el.clientHeight));
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, items, drawing.current ? [...live, drawing.current] : live, size.w, size.h);
  }, [items, live, size]);

  useEffect(redraw, [redraw]);

  const pointAt = (e: React.PointerEvent): BoardPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // No compatibility mousedown: its default action would move focus to the
    // page and blur (= commit empty) the text box we are about to open.
    e.preventDefault();
    if (draft) commitDraft();
    const p = pointAt(e);
    if (tool === 'text') {
      setDraft({ x: p[0], y: p[1], text: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { id: newId(), color, width: PEN_WIDTH, points: [p] };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current;
    if (!stroke) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const rect = canvasRef.current!.getBoundingClientRect();
    if (events.length > 1) {
      for (const ev of events) stroke.points.push([(ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height]);
    } else {
      stroke.points.push(pointAt(e));
    }
    redraw();
    const now = performance.now();
    if (now - lastLiveSend.current > 60) {
      lastLiveSend.current = now;
      onLive(stroke);
    }
  };

  const onPointerUp = () => {
    const stroke = drawing.current;
    drawing.current = null;
    if (!stroke) return;
    onLive(null);
    onCommit({ type: 'stroke', id: stroke.id, by: myUserId, color: stroke.color, width: stroke.width, points: stroke.points });
    setTick((t) => t + 1);
  };

  const commitDraft = () => {
    if (draft && draft.text.trim()) {
      onCommit({ type: 'text', id: newId(), by: myUserId, color, x: draft.x, y: draft.y, size: TEXT_SIZE, text: draft.text.trim() });
    }
    setDraft(null);
  };

  const undo = () => {
    const id = lastItemBy(items, myUserId);
    if (id) onCommit({ type: 'delete', id, by: myUserId });
  };

  const clear = () => {
    if (items.length === 0 || confirm('Clear the whiteboard for everyone?')) onCommit({ type: 'clear', by: myUserId });
  };

  return (
    <div className="wb">
      <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
        <button type="button" className={`wb-tool${tool === 'pen' ? ' active' : ''}`} onClick={() => setTool('pen')} aria-pressed={tool === 'pen'} title="Pen">✏️</button>
        <button type="button" className={`wb-tool${tool === 'text' ? ' active' : ''}`} onClick={() => setTool('text')} aria-pressed={tool === 'text'} title="Type text">T</button>
        <span className="wb-sep" aria-hidden="true" />
        {BOARD_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`wb-swatch${color === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
          />
        ))}
        <span className="wb-sep" aria-hidden="true" />
        <button type="button" className="wb-tool" onClick={undo} title="Undo my last item" aria-label="Undo">↶</button>
        <button type="button" className="wb-tool" onClick={clear} title="Clear the board" aria-label="Clear">🗑</button>
      </div>
      <div className="wb-stage" ref={wrapRef}>
        <div className="wb-paper" style={{ width: size.w, height: size.h }}>
          <canvas
            ref={canvasRef}
            data-testid="whiteboard-canvas"
            className={`wb-canvas wb-canvas-${tool}`}
            style={{ width: size.w, height: size.h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {draft && (
            <textarea
              className="wb-text-input"
              autoFocus
              lang="zh"
              data-testid="whiteboard-text-input"
              style={{ left: draft.x * size.w, top: draft.y * size.h, color, fontSize: TEXT_SIZE * (size.w / 1600) }}
              value={draft.text}
              placeholder="Type…"
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  commitDraft();
                } else if (e.key === 'Escape') {
                  setDraft(null);
                }
              }}
              onBlur={commitDraft}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Read-only board for the review page. */
export function BoardSnapshot({ items }: { items: BoardItem[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(fitBoard(el.clientWidth, el.clientWidth)));
    ro.observe(el);
    setSize(fitBoard(el.clientWidth, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, items, [], size.w, size.h);
  }, [items, size]);
  return (
    <div ref={wrapRef} className="wb-snapshot">
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
    </div>
  );
}
