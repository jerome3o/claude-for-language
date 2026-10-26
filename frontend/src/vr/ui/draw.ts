/**
 * Draws a laid-out VR panel (ui/layout.ts) onto a 2D canvas — the window's texture. Fonts are
 * the self-hosted Noto Sans SC slices (vr/fonts.ts), loaded for exactly the characters drawn.
 */
import { layoutUi, UI_THEME, type HitRegion, type Measure, type UiLayout, type UiNode } from './layout';

export type PanelImage = CanvasImageSource & { width: number; height: number };

export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  const cache = new Map<string, number>();
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    cache.set(key, w);
    return w;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export interface DrawOptions {
  images?: ReadonlyMap<string, PanelImage>;
  hovered?: HitRegion | null;
  /** Panel background (the tray and title bars use their own). */
  background?: string;
  radius?: number;
}

/** Paints `layout` on the whole canvas (rounded panel, transparent corners). */
export function drawLayout(ctx: CanvasRenderingContext2D, layout: UiLayout, opts: DrawOptions = {}) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = opts.background ?? UI_THEME.bg;
  roundRect(ctx, 0, 0, width, height, opts.radius ?? 28);
  ctx.fill();
  const hovered = opts.hovered ?? null;
  layout.ops.forEach((op, i) => {
    if (op.op === 'rect') {
      const isHover = hovered && hovered.rect === i;
      ctx.fillStyle = op.fill;
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.fill();
      if (isHover) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = UI_THEME.accent;
        ctx.stroke();
      } else if (op.stroke) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = op.stroke;
        ctx.stroke();
      }
    } else if (op.op === 'text') {
      ctx.font = op.font;
      ctx.fillStyle = op.color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.op === 'image') {
      const img = opts.images?.get(op.key);
      ctx.save();
      roundRect(ctx, op.x, op.y, op.w, op.h, 18);
      ctx.clip();
      ctx.fillStyle = UI_THEME.card;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      if (img && img.width > 0 && img.height > 0) {
        const scale = Math.min(op.w / img.width, op.h / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, op.x + (op.w - w) / 2, op.y + (op.h - h) / 2, w, h);
      }
      ctx.restore();
    }
  });
  // A hovered tap target without its own background (a word in a sentence) gets a soft pill.
  if (hovered && hovered.rect === undefined) {
    ctx.fillStyle = UI_THEME.hover;
    roundRect(ctx, hovered.x, hovered.y, hovered.w, hovered.h, 12);
    ctx.fill();
  }
}

/** Lays out and draws in one go, resizing the canvas to the content (height in 32 px steps). */
export function renderPanel(
  canvas: HTMLCanvasElement,
  nodes: readonly UiNode[],
  width: number,
  opts: DrawOptions & { minHeight?: number; maxHeight?: number; padding?: number } = {}
): { layout: UiLayout; resized: boolean } {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const layout = layoutUi(nodes, { width, measure: canvasMeasure(ctx), maxHeight: opts.maxHeight, padding: opts.padding });
  const h = Math.max(opts.minHeight ?? 0, Math.ceil(layout.height / 32) * 32);
  let resized = false;
  if (canvas.width !== width || canvas.height !== h) {
    canvas.width = width;
    canvas.height = h;
    resized = true;
  }
  drawLayout(ctx, { ...layout, height: h }, opts);
  return { layout: { ...layout, height: h }, resized };
}
