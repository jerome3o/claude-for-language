/**
 * Procedural textures for VR worlds (docs/VR_WORLDS.md "The helper library"): drawn once on a canvas,
 * cached by their parameters, shared by every mesh that asks — no image files, nothing downloaded.
 * Deterministic (a seeded random), so a world looks the same every time.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

const cache = new Map<string, CanvasTexture>();

/** A small seeded PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, opts: { repeat?: [number, number]; srgb?: boolean; fontText?: string } = {}): CanvasTexture {
  const k = `${key}|${opts.repeat?.join('x') ?? ''}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const t = new CanvasTexture(canvas);
  if (opts.srgb !== false) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.anisotropy = 4;
  cache.set(k, t);
  // Chinese text: the VR font's slices load on demand — draw again once they are in.
  if (opts.fontText && ctx && typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, opts.fontText).then(() => {
      draw(ctx, size);
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

/** Wood grain: long wavy streaks along U. */
export function woodTexture(color = '#a87447', repeat: [number, number] = [1, 1]): Texture {
  return make(`wood:${color}`, 256, (ctx, s) => {
    const rnd = seeded(7);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const y = rnd() * s;
      const amp = 2 + rnd() * 5;
      const f = 0.78 + rnd() * 0.32;
      ctx.strokeStyle = shade(color, f);
      ctx.globalAlpha = 0.25 + rnd() * 0.4;
      ctx.lineWidth = 0.6 + rnd() * 2.2;
      ctx.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const yy = y + Math.sin((x / s) * Math.PI * 2 * (1 + (i % 3)) + i) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, { repeat });
}

/** Square tiles with grout lines. */
export function tileTexture(color = '#e9e6df', grout = '#b9b4aa', tiles = 4, repeat: [number, number] = [1, 1]): Texture {
  return make(`tile:${color}:${grout}:${tiles}`, 256, (ctx, s) => {
    const rnd = seeded(11);
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, s, s);
    const step = s / tiles;
    for (let i = 0; i < tiles; i++) {
      for (let j = 0; j < tiles; j++) {
        ctx.fillStyle = shade(color, 0.95 + rnd() * 0.08);
        ctx.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
      }
    }
  }, { repeat });
}

/** A two-colour checker (floors). */
export function checkerTexture(a = '#d8d2c6', b = '#b8ae9e', n = 4, repeat: [number, number] = [1, 1]): Texture {
  return make(`checker:${a}:${b}:${n}`, 256, (ctx, s) => {
    const step = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? a : b;
      ctx.fillRect(i * step, j * step, step, step);
    }
  }, { repeat });
}

/** Planks (wooden floors): rows of boards with joints. */
export function plankTexture(color = '#9c7550', repeat: [number, number] = [1, 1]): Texture {
  return make(`plank:${color}`, 512, (ctx, s) => {
    const rnd = seeded(23);
    const rows = 6;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * s * 0.5;
      while (x < s) {
        const w = s * (0.35 + rnd() * 0.4);
        ctx.fillStyle = shade(color, 0.85 + rnd() * 0.25);
        ctx.fillRect(x, r * h, w, h);
        ctx.strokeStyle = shade(color, 0.6);
        ctx.lineWidth = 2;
        ctx.strokeRect(x, r * h, w, h);
        for (let k = 0; k < 6; k++) {
          ctx.strokeStyle = shade(color, 0.75 + rnd() * 0.2);
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          const yy = r * h + rnd() * h;
          ctx.beginPath();
          ctx.moveTo(x, yy);
          ctx.lineTo(x + w, yy + (rnd() - 0.5) * 6);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        x += w;
      }
    }
  }, { repeat });
}

/** Soft noise (plaster, fabric, paper, stone): the base colour with gentle speckle. */
export function noiseTexture(color = '#eeeae2', amount = 0.06, repeat: [number, number] = [1, 1]): Texture {
  return make(`noise:${color}:${amount}`, 128, (ctx, s) => {
    const rnd = seeded(5);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const f = 1 + (rnd() - 0.5) * 2 * amount;
      img.data[i] = Math.min(255, img.data[i] * f);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * f);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * f);
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat });
}

/** Horizontal stripes (awnings, towels, packaging). */
export function stripeTexture(a = '#d9534f', b = '#f5f0e6', n = 8, repeat: [number, number] = [1, 1]): Texture {
  return make(`stripe:${a}:${b}:${n}`, 128, (ctx, s) => {
    const step = s / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 === 0 ? a : b;
      ctx.fillRect(0, i * step, s, step);
    }
  }, { repeat });
}

/** A packaging label: a colour band with Chinese text (milk cartons, bottles, boxes). */
export function labelTexture(text: string, bg = '#ffffff', fg = '#1d4f91', band = '#3b7ff2'): Texture {
  return make(`label:${text}:${bg}:${fg}:${band}`, 256, (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = band;
    ctx.fillRect(0, s * 0.62, s, s * 0.2);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(s * 0.26)}px "Noto Sans SC Variable", "Noto Sans SC", sans-serif`;
    ctx.fillText(text, s / 2, s * 0.36);
  }, { fontText: text });
}

/** Text on a sign (shop signs, notices): drawn in the VR font once it is loaded. */
export function signTexture(text: string, opts: { bg?: string; fg?: string; width?: number; height?: number; font?: number } = {}): CanvasTexture {
  const w = opts.width ?? 512;
  const h = opts.height ?? 128;
  const key = `sign:${text}:${opts.bg}:${opts.fg}:${w}x${h}:${opts.font}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = opts.bg ?? '#7a2121';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = opts.fg ?? '#ffe7a8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${opts.font ?? Math.round(h * 0.62)}px "Noto Sans SC Variable", "Noto Sans SC", sans-serif`;
    ctx.fillText(text, w / 2, h / 2 + h * 0.03);
  };
  draw();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  // The CJK font slices load on demand: draw again once they are in.
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, text).then(() => {
      draw();
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}
