/**
 * A canvas over a video of a shared screen: shows the drawings (both
 * people's, fading a few seconds after the pen lifts) and, when `interactive`,
 * lets me draw — a drag is a stroke, a quick tap is a "look here" ping.
 * Points are normalised to the shared picture (shared/calls/annotate.ts), so
 * they land in the same place on the other person's screen.
 *
 * Text tool (round 4): a tap on the picture places a text box and opens a real
 * <textarea> there (so every IME works); Enter or tapping away finishes it,
 * Esc cancels. A tap on a text box selects it (✕ deletes), a drag moves it, a
 * second tap edits it. What I type reaches the other person as I type (outside
 * an IME composition), through the call room like strokes.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ANNOT_TEXT_SIZE,
  ANNOT_WIDTH,
  containRect,
  denormalizePoint,
  moveAnnotText,
  normalizePoint,
  simplifyPoints,
  type AnnotPoint,
  type AnnotStroke,
  type AnnotText,
  type VideoSize,
} from '@shared/calls';
import { drawAnnotations, fitCanvas, type AnnotationStore, type TextBoxes } from '../../services/calls/annotations';

export type AnnotTool = 'pen' | 'text';

interface Props {
  store: AnnotationStore;
  /** The shared picture's size (the video's intrinsic size). */
  video: VideoSize | null;
  interactive?: boolean;
  color?: string;
  onStroke?: (stroke: AnnotStroke) => void;
  onPing?: (x: number, y: number) => void;
  /** Text tool: place / edit / move a text box (sent through the room), and delete one. */
  tool?: AnnotTool;
  onText?: (text: AnnotText) => void;
  onTextDelete?: (id: string) => void;
  className?: string;
  testId?: string;
}

interface Editor {
  id: string;
  /** Normalised top-left. */
  x: number;
  y: number;
  value: string;
  /** Editing a box that existed before (Esc restores it); a new one is dropped when left empty. */
  before: AnnotText | null;
}

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function AnnotationLayer({ store, video, interactive, color = '#f43f5e', onStroke, onPing, tool = 'pen', onText, onTextDelete, className, testId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<TextBoxes>(new Map());
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const [selected, setSelected] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const composing = useRef(false);
  const liveAt = useRef(0);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textDrag = useRef<{ id: string; start: [number, number]; base: AnnotText; moved: boolean } | null>(null);
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
      if (ctx) drawAnnotations(ctx, box, videoRef.current, store, Date.now(), boxes.current);
      setTick((t) => t + 1); // the ✕ of a selected box follows it
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

  const picShort = () => {
    const c = canvasRef.current;
    if (!c) return 400;
    const r = c.getBoundingClientRect();
    const pic = containRect(videoRef.current, { width: r.width, height: r.height });
    return Math.max(1, Math.min(pic.width, pic.height));
  };
  const textOf = (e: Editor, done: boolean): AnnotText => ({ id: e.id, color: e.before?.color ?? color, x: e.x, y: e.y, text: e.value, size: e.before?.size ?? ANNOT_TEXT_SIZE, done });

  /** Send what is typed (≤ ~7 updates a second, never mid-composition). */
  const sendLive = () => {
    const e = editorRef.current;
    if (!e || composing.current || !onText) return;
    const go = () => {
      liveTimer.current = null;
      const cur = editorRef.current;
      if (!cur || composing.current) return;
      liveAt.current = Date.now();
      if (cur.value || cur.before) onText(textOf(cur, false));
    };
    if (liveTimer.current) return;
    const wait = 150 - (Date.now() - liveAt.current);
    if (wait <= 0) go();
    else liveTimer.current = setTimeout(go, wait);
  };

  const finish = (keep: boolean) => {
    const e = editorRef.current;
    if (!e) return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = null;
    setEditor(null);
    store.setEditing(null);
    if (!keep) {
      // Esc: back as it was (a new box goes away).
      if (e.before) {
        store.upsertText(e.before, 'me');
        onText?.(e.before);
      } else if (store.texts.has(e.id)) {
        store.deleteText(e.id);
        onTextDelete?.(e.id);
      }
      return;
    }
    if (!e.value.trim()) {
      store.deleteText(e.id);
      onTextDelete?.(e.id);
      return;
    }
    const t = textOf(e, true);
    store.upsertText(t, 'me');
    onText?.(t);
  };

  const openEditor = (ed: Editor) => {
    setSelected(null);
    store.setEditing(ed.id);
    setEditor(ed);
  };

  const hitText = (e: React.PointerEvent<HTMLCanvasElement>): string | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let hit: string | null = null;
    for (const [id, b] of boxes.current) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) hit = id;
    return hit;
  };

  const send = (done: boolean) => {
    const d = drawing.current;
    if (!d || !onStroke) return;
    const stroke: AnnotStroke = { id: d.id, color, width: ANNOT_WIDTH, points: simplifyPoints(d.points), done };
    onStroke(stroke);
    d.lastSent = Date.now();
  };

  const canvasEl = (
    <canvas
      ref={canvasRef}
      className={`annot-layer${interactive ? ' interactive' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onPointerDown={interactive ? (e) => {
        if (tool === 'text') {
          if (editorRef.current) {
            finish(true); // tapping away finishes the box being typed
            return;
          }
          const hit = hitText(e);
          const t = hit ? store.texts.get(hit) : null;
          if (hit && t) {
            e.currentTarget.setPointerCapture(e.pointerId);
            textDrag.current = { id: hit, start: [e.clientX, e.clientY], base: t, moved: false };
            return;
          }
          if (selected) {
            setSelected(null);
            return;
          }
          const p = pointFor(e);
          if (!p) return;
          e.preventDefault();
          openEditor({ id: newId('t'), x: p[0], y: Math.max(0, p[1] - 0.02), value: '', before: null });
          return;
        }
        const p = pointFor(e);
        if (!p) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = { id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, points: [p], startedAt: Date.now(), lastSent: 0, moved: 0, start: [e.clientX, e.clientY] };
      } : undefined}
      onPointerMove={interactive ? (e) => {
        const td = textDrag.current;
        if (td) {
          const r = e.currentTarget.getBoundingClientRect();
          const pic = containRect(videoRef.current, { width: r.width, height: r.height });
          const dx = e.clientX - td.start[0];
          const dy = e.clientY - td.start[1];
          if (!td.moved && Math.hypot(dx, dy) < 5) return;
          td.moved = true;
          const at = moveAnnotText(td.base, dx / Math.max(1, pic.width), dy / Math.max(1, pic.height));
          store.upsertText({ ...td.base, ...at }, 'me');
          return;
        }
        const d = drawing.current;
        if (!d) return;
        const p = pointFor(e);
        if (!p) return;
        d.points.push(p);
        d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]));
        if (d.moved > 6 && Date.now() - d.lastSent > 40) send(false);
      } : undefined}
      onPointerUp={interactive ? () => {
        const td = textDrag.current;
        if (td) {
          textDrag.current = null;
          const t = store.texts.get(td.id);
          if (td.moved && t) {
            onText?.({ id: t.id, color: t.color, x: t.x, y: t.y, text: t.text, size: t.size, done: true });
            setSelected(td.id);
          } else if (selected === td.id && t) {
            // A second tap on the selected box: edit it.
            openEditor({ id: t.id, x: t.x, y: t.y, value: t.text, before: { id: t.id, color: t.color, x: t.x, y: t.y, text: t.text, size: t.size, done: true } });
          } else setSelected(td.id);
          return;
        }
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

  if (!interactive || tool !== 'text') return canvasEl;
  const c = canvasRef.current;
  const rect = c ? { width: c.clientWidth, height: c.clientHeight } : { width: 0, height: 0 };
  const sel = selected ? boxes.current.get(selected) : null;
  let editorStyle: React.CSSProperties | null = null;
  if (editor && c) {
    const [x, y] = denormalizePoint([editor.x, editor.y], rect, videoRef.current);
    const px = Math.max(11, (editor.before?.size ?? ANNOT_TEXT_SIZE) * picShort());
    editorStyle = { left: c.offsetLeft + x, top: c.offsetTop + y, fontSize: px, color: editor.before?.color ?? color, maxWidth: Math.max(120, rect.width - x - 8) };
  }
  return (
    <>
      {canvasEl}
      {editor && editorStyle && (
        <textarea
          className="annot-text-editor"
          style={editorStyle}
          value={editor.value}
          autoFocus
          rows={Math.max(1, editor.value.split('\n').length)}
          lang="zh"
          placeholder="Type…"
          data-testid="annot-text-editor"
          onChange={(e) => {
            setEditor({ ...editor, value: e.target.value });
            editorRef.current = { ...editor, value: e.target.value };
            sendLive();
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            sendLive();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
      )}
      {sel && selected && !editor && c && (
        <button
          type="button"
          className="annot-text-delete"
          style={{ left: c.offsetLeft + sel.x + sel.w - 14, top: c.offsetTop + sel.y - 14 }}
          aria-label="Delete this text"
          data-testid="annot-text-delete"
          onClick={() => {
            store.deleteText(selected);
            onTextDelete?.(selected);
            setSelected(null);
          }}
        >
          ✕
        </button>
      )}
    </>
  );
}
