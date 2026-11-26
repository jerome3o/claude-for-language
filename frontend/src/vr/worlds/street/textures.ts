/**
 * The street's own canvas textures (docs/VR_WORLDS.md "The helper library" has the shared ones): shop
 * signs with several lines, building facades with lit windows (a colour map + an emissive map, so the
 * windows glow at dusk), the dusk sky, shelves of goods drawn as one picture, the pedestrian signal's
 * little man, road paint. All invented — no real shop names, brands or logos. Drawn once, cached by key,
 * deterministic (seeded); Chinese text is drawn again once the VR font's slices are in.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { seeded } from '../kit';

const cache = new Map<string, CanvasTexture>();
const FONT = '"Noto Sans SC Variable", "Noto Sans SC", sans-serif';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A cached canvas texture; `text` = the Chinese it draws (redrawn once the font slices load). */
export function canvasTex(key: string, w: number, h: number, draw: Draw, opts: { text?: string; repeat?: boolean; srgb?: boolean } = {}): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const t = new CanvasTexture(canvas);
  if (opts.srgb !== false) t.colorSpace = SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  if (opts.text && ctx && typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, opts.text).then(() => {
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}

export function font(px: number, weight = 700): string {
  return `${weight} ${Math.round(px)}px ${FONT}`;
}

/** Centred text, shrunk to fit `maxW`. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, maxW: number, weight = 700) {
  let size = px;
  ctx.font = font(size, weight);
  while (size > 8 && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = font(size, weight);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** A sign: a background, an optional border, lines of text [text, size (fraction of height), colour, y (fraction)]. */
export function signTex(key: string, w: number, h: number, bg: string, lines: Array<[string, number, string, number]>, border?: string): CanvasTexture {
  return canvasTex(`sign:${key}`, w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = Math.max(4, h * 0.04);
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
    }
    for (const [text, size, color, y] of lines) {
      ctx.fillStyle = color;
      fitText(ctx, text, w / 2, h * y, h * size, w * 0.92);
    }
  }, { text: lines.map((l) => l[0]).join('') });
}

export interface FacadeOpts {
  seed: number;
  /** Wall colour, window frame colour. */
  wall: string;
  frame?: string;
  cols: number;
  rows: number;
  /** Share of windows lit (0–1). */
  lit?: number;
  /** Air-conditioning units under some windows (very Chinese). */
  ac?: boolean;
  /** Balconies with railings (residential). */
  balcony?: boolean;
}

/** A building facade: rows of windows, some lit — `map` for the wall, `emissive` for the glowing windows. */
export function facadeTex(key: string, o: FacadeOpts): { map: CanvasTexture; emissive: CanvasTexture } {
  const S = 512;
  const layout = (rnd: () => number) => {
    const cells: Array<{ x: number; y: number; w: number; h: number; lit: boolean; warm: string; ac: boolean; curtain: number }> = [];
    const cw = S / o.cols;
    const ch = S / o.rows;
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const lit = rnd() < (o.lit ?? 0.45);
        const warm = ['#ffd9a0', '#ffe8c2', '#fff4dc', '#ffc88a', '#e8f0ff'][Math.floor(rnd() * 5)];
        cells.push({ x: c * cw + cw * 0.18, y: r * ch + ch * 0.2, w: cw * 0.64, h: ch * 0.56, lit, warm, ac: !!o.ac && rnd() < 0.35, curtain: rnd() });
      }
    }
    return { cells, cw, ch };
  };
  const map = canvasTex(`facade:${key}`, S, S, (ctx) => {
    const rnd = seeded(o.seed);
    const { cells, ch } = layout(rnd);
    ctx.fillStyle = o.wall;
    ctx.fillRect(0, 0, S, S);
    // a little grime and tile texture
    const r2 = seeded(o.seed + 99);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + r2() * 0.04})`;
      ctx.fillRect(r2() * S, r2() * S, 2 + r2() * 6, 1 + r2() * 3);
    }
    for (let r = 1; r < o.rows; r++) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, r * ch - 2, S, 3);
    }
    for (const c of cells) {
      ctx.fillStyle = o.frame ?? '#d8d4cc';
      ctx.fillRect(c.x - 4, c.y - 4, c.w + 8, c.h + 8);
      ctx.fillStyle = c.lit ? c.warm : '#2b3442';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      if (c.lit && c.curtain < 0.5) {
        ctx.fillStyle = 'rgba(160,90,60,0.35)';
        ctx.fillRect(c.x, c.y, c.w * (0.2 + c.curtain * 0.5), c.h);
      }
      ctx.fillStyle = o.frame ?? '#d8d4cc';
      ctx.fillRect(c.x + c.w / 2 - 2, c.y, 4, c.h);
      if (o.balcony) {
        ctx.fillStyle = 'rgba(70,70,75,0.9)';
        ctx.fillRect(c.x - 8, c.y + c.h * 0.62, c.w + 16, 4);
        for (let k = 0; k <= 8; k++) ctx.fillRect(c.x - 8 + ((c.w + 16) * k) / 8, c.y + c.h * 0.62, 2, c.h * 0.42);
      }
      if (c.ac) {
        ctx.fillStyle = '#eceae4';
        ctx.fillRect(c.x + c.w * 0.1, c.y + c.h + 8, c.w * 0.5, ch * 0.16);
        ctx.fillStyle = '#9a9a96';
        ctx.beginPath();
        ctx.arc(c.x + c.w * 0.25, c.y + c.h + 8 + ch * 0.08, ch * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, { repeat: true });
  const emissive = canvasTex(`facade-e:${key}`, S, S, (ctx) => {
    const rnd = seeded(o.seed);
    const { cells } = layout(rnd);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, S, S);
    for (const c of cells) {
      if (!c.lit) continue;
      ctx.fillStyle = c.warm;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      if (c.curtain < 0.5) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(c.x, c.y, c.w * (0.2 + c.curtain * 0.5), c.h);
      }
    }
  }, { repeat: true });
  return { map, emissive };
}

/** The dusk sky: deep blue overhead, rose, then a warm glow at the horizon (v = 0 bottom … 1 top). */
export function skyTex(): CanvasTexture {
  return canvasTex('sky:dusk', 8, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1c2a52');
    g.addColorStop(0.3, '#3d4f86');
    g.addColorStop(0.43, '#8d6f9e');
    g.addColorStop(0.49, '#e39a86');
    g.addColorStop(0.52, '#f7c08a');
    g.addColorStop(0.56, '#d9927c');
    g.addColorStop(1, '#5a4a52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Rows of goods on a shop shelf, drawn as one picture (the grabbable packets sit in front of it). */
export function goodsTex(key: string, seed: number, kind: 'snacks' | 'drinks'): CanvasTexture {
  const W = 512;
  const H = 128;
  const names = kind === 'drinks'
    ? ['水', '茶', '果汁', '可乐', '汽水', '酸奶', '咖啡', '牛奶']
    : ['薯片', '饼干', '面', '糖', '瓜子', '面包', '辣条', '米饼', '豆干', '果冻'];
  const colours = ['#d9342b', '#f2b134', '#2b7bd9', '#3aa655', '#e66a2c', '#8e4fc2', '#e8e1d2', '#1d3e6e', '#f28cb1', '#5bc0c9'];
  return canvasTex(`goods:${key}`, W, H, (ctx) => {
    const rnd = seeded(seed);
    ctx.fillStyle = '#e9e7e2';
    ctx.fillRect(0, 0, W, H);
    let x = 2;
    while (x < W - 8) {
      const w = kind === 'drinks' ? 26 + rnd() * 10 : 36 + rnd() * 30;
      const h = kind === 'drinks' ? H * (0.72 + rnd() * 0.22) : H * (0.55 + rnd() * 0.4);
      const c = colours[Math.floor(rnd() * colours.length)];
      const y = H - h;
      if (kind === 'drinks') {
        ctx.fillStyle = c;
        ctx.fillRect(x + w * 0.15, y + h * 0.18, w * 0.7, h * 0.82);
        ctx.fillRect(x + w * 0.32, y, w * 0.36, h * 0.2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x + w * 0.15, y + h * 0.45, w * 0.7, h * 0.22);
      } else {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, w - 3, h);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(x + 3, y + h * 0.3, w - 9, h * 0.3);
      }
      ctx.fillStyle = '#222';
      const name = names[Math.floor(rnd() * names.length)];
      ctx.font = font(Math.min(16, w * 0.4));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, x + w / 2 - 1, kind === 'drinks' ? y + h * 0.56 : y + h * 0.45);
      x += w + 2;
    }
    // price strip
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(0, H - 10, W, 10);
  }, { text: names.join('') });
}

/** The pedestrian signal: a standing red man or a walking green man (on black). */
export function walkerTex(green: boolean): CanvasTexture {
  return canvasTex(`walker:${green}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = green ? '#3dff8a' : '#ff3b30';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineCap = 'round';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(64, 26, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (green) {
      ctx.moveTo(62, 42); ctx.lineTo(56, 74); // body
      ctx.moveTo(60, 50); ctx.lineTo(78, 64); // arm forward
      ctx.moveTo(60, 50); ctx.lineTo(44, 62); // arm back
      ctx.moveTo(56, 74); ctx.lineTo(74, 104); // leg forward
      ctx.moveTo(56, 74); ctx.lineTo(40, 100); // leg back
    } else {
      ctx.moveTo(64, 42); ctx.lineTo(64, 76);
      ctx.moveTo(64, 48); ctx.lineTo(50, 72);
      ctx.moveTo(64, 48); ctx.lineTo(78, 72);
      ctx.moveTo(64, 76); ctx.lineTo(56, 108);
      ctx.moveTo(64, 76); ctx.lineTo(72, 108);
    }
    ctx.stroke();
  });
}

/** White road paint (characters painted on the asphalt, transparent around them). */
export function roadPaintTex(text: string, color = '#f4f1e8'): CanvasTexture {
  return canvasTex(`roadpaint:${text}:${color}`, 256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.88;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(h * 0.42 / Math.max(1, [...text].length) * 1.6);
    const chars = [...text];
    chars.forEach((c, i) => ctx.fillText(c, w / 2, (h * (i + 0.5)) / chars.length));
  }, { text, srgb: true });
}

/** Asphalt: dark grey with fine speckle and a few repaired patches. */
export function asphaltTex(): CanvasTexture {
  return canvasTex('asphalt', 256, 256, (ctx, w, h) => {
    const rnd = seeded(41);
    ctx.fillStyle = '#4a4b4f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = 50 + Math.floor(rnd() * 60);
      ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    ctx.fillStyle = 'rgba(30,30,32,0.35)';
    ctx.fillRect(40, 120, 70, 50);
  }, { repeat: true });
}

/** Pavement: square grey-red concrete pavers. */
export function paverTex(): CanvasTexture {
  return canvasTex('pavers', 256, 256, (ctx, w, h) => {
    const rnd = seeded(43);
    ctx.fillStyle = '#7d7671';
    ctx.fillRect(0, 0, w, h);
    const n = 4;
    const s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const base = (i + j) % 2 === 0 ? [176, 164, 154] : [168, 150, 142];
        const f = 0.92 + rnd() * 0.12;
        ctx.fillStyle = `rgb(${base[0] * f},${base[1] * f},${base[2] * f})`;
        ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
        for (let k = 0; k < 40; k++) {
          ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
          ctx.fillRect(i * s + rnd() * s, j * s + rnd() * s, 2, 2);
        }
      }
    }
  }, { repeat: true });
}

/** The yellow tactile paving strip (盲道) for blind walkers: ridges. */
export function tactileTex(): CanvasTexture {
  return canvasTex('tactile', 64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#d8a823';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2c537';
    for (let i = 0; i < 4; i++) ctx.fillRect(6 + i * 15, 4, 8, h - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, 0, 2, h);
  }, { repeat: true });
}
