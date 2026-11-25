/**
 * The market's own procedural textures (canvas, cached, seeded — like kit/textures.ts, which they
 * complement): watermelon rind, an invented QR code, the chalk price board, the hanging scale's dial,
 * tartan for the shopping trolley, woven sacks, the scales' LCD. Chinese text uses the VR font
 * (Noto Sans SC, self-hosted) and redraws once its slices are in.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { seeded } from '../kit';

const FONT = '"Noto Sans SC Variable", "Noto Sans SC", sans-serif';
const cache = new Map<string, CanvasTexture>();

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, text?: string): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  if (text && ctx && typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, text).then(() => {
      draw(ctx);
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}

/** Watermelon rind: dark wavy stripes running pole to pole (u wraps around the sphere). */
export function watermelonTexture(): CanvasTexture {
  return make('melon', 256, 128, (ctx) => {
    const rnd = seeded(31);
    ctx.fillStyle = '#5f9a3a';
    ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 16; i++) {
      const x0 = (i / 16) * 256;
      ctx.fillStyle = '#1f4a1c';
      ctx.beginPath();
      for (let y = 0; y <= 128; y += 4) {
        const x = x0 + Math.sin(y * 0.22 + i) * 3 + (rnd() - 0.5) * 2;
        if (y === 0) ctx.moveTo(x - 4, y);
        ctx.lineTo(x - 4 - Math.sin(y * 0.4 + i) * 1.5, y);
      }
      for (let y = 128; y >= 0; y -= 4) ctx.lineTo(x0 + 5 + Math.sin(y * 0.22 + i) * 3, y);
      ctx.fill();
    }
  });
}

/** An invented QR code (random modules + the three finder squares) — no real payment brand. */
export function qrTexture(): CanvasTexture {
  return make('qr', 256, 340, (ctx) => {
    const rnd = seeded(2026);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 340);
    ctx.fillStyle = '#1aa260';
    ctx.fillRect(0, 0, 256, 56);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText('扫码付款', 128, 30);
    const n = 25;
    const cell = 7.6;
    const ox = 128 - (n * cell) / 2;
    const oy = 72;
    ctx.fillStyle = '#111111';
    const finder = (fx: number, fy: number) => {
      ctx.fillStyle = '#111';
      ctx.fillRect(ox + fx * cell, oy + fy * cell, 7 * cell, 7 * cell);
      ctx.fillStyle = '#fff';
      ctx.fillRect(ox + (fx + 1) * cell, oy + (fy + 1) * cell, 5 * cell, 5 * cell);
      ctx.fillStyle = '#111';
      ctx.fillRect(ox + (fx + 2) * cell, oy + (fy + 2) * cell, 3 * cell, 3 * cell);
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inFinder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
        if (inFinder) continue;
        if (rnd() < 0.48) {
          ctx.fillStyle = '#111';
          ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.3, cell + 0.3);
        }
      }
    }
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
    ctx.fillStyle = '#333';
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText('支持各种付款方式', 128, 300);
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = '#c8102e';
    ctx.fillText('平安菜市场 12号摊', 128, 326);
  }, '扫码付款支持各种方式平安菜市场号摊');
}

/** The chalk price board: one line per item, "西红柿  三块五一斤". */
export function priceBoardTexture(lines: ReadonlyArray<readonly [string, string]>, title: string): CanvasTexture {
  const text = title + lines.map(([a, b]) => a + b).join('');
  return make(`board:${text}`, 512, 384, (ctx) => {
    const rnd = seeded(9);
    ctx.fillStyle = '#23302a';
    ctx.fillRect(0, 0, 512, 384);
    // chalk dust
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.05})`;
      ctx.fillRect(rnd() * 512, rnd() * 384, 2 + rnd() * 6, 1 + rnd() * 2);
    }
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe28a';
    ctx.textAlign = 'center';
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(title, 256, 40);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 72);
    ctx.lineTo(472, 72);
    ctx.stroke();
    const step = (384 - 100) / lines.length;
    lines.forEach(([name, price], i) => {
      const y = 100 + step * (i + 0.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f4f4ee';
      ctx.font = `700 36px ${FONT}`;
      ctx.fillText(name, 36, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = i % 2 ? '#9fe0ff' : '#ffb3a8';
      ctx.fillText(price, 478, y);
    });
  }, text);
}

/** The hanging scale's dial: 0–20 斤, a red needle drawn separately. */
export function dialTexture(): CanvasTexture {
  return make('dial', 256, 256, (ctx) => {
    ctx.fillStyle = '#fbf8ef';
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineCap = 'round';
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI * 0.75 + (i / 40) * Math.PI * 1.5;
      const r0 = i % 5 === 0 ? 92 : 102;
      ctx.lineWidth = i % 5 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
      ctx.lineTo(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
      ctx.stroke();
      if (i % 10 === 0) {
        ctx.fillStyle = '#222';
        ctx.font = `700 22px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i / 2), 128 + Math.sin(a) * 74, 128 - Math.cos(a) * 74);
      }
    }
    ctx.fillStyle = '#c8102e';
    ctx.font = `700 30px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('斤', 128, 186);
  }, '斤');
}

/** A red-and-green tartan (the shopping trolley's bag). */
export function tartanTexture(): CanvasTexture {
  return make('tartan', 128, 128, (ctx) => {
    ctx.fillStyle = '#7a1f24';
    ctx.fillRect(0, 0, 128, 128);
    ctx.globalAlpha = 0.55;
    for (const [pos, w, c] of [[16, 14, '#1d4d3a'], [56, 6, '#e8c45a'], [88, 18, '#1d4d3a'], [118, 4, '#f3efe4']] as const) {
      ctx.fillStyle = c;
      ctx.fillRect(pos, 0, w, 128);
      ctx.fillRect(0, pos, 128, w);
    }
    ctx.globalAlpha = 1;
  });
}

/** A woven sack with a printed name (大米, 黄豆 …). */
export function sackTexture(text: string, ink = '#c8102e'): CanvasTexture {
  return make(`sack:${text}:${ink}`, 256, 256, (ctx) => {
    const rnd = seeded(text.length * 7 + 3);
    ctx.fillStyle = '#eee6d2';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      ctx.fillStyle = `rgba(120,100,60,${0.06 + rnd() * 0.06})`;
      ctx.fillRect(0, y, 256, 1.5);
    }
    for (let x = 0; x < 256; x += 4) {
      ctx.fillStyle = `rgba(120,100,60,${0.04 + rnd() * 0.05})`;
      ctx.fillRect(x, 0, 1.5, 256);
    }
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${text.length > 2 ? 58 : 78}px ${FONT}`;
    ctx.fillText(text, 128, 118);
    ctx.fillStyle = '#2b5fa8';
    ctx.fillRect(40, 176, 176, 8);
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText('新货', 128, 214);
  }, text + '新货');
}

/** The plastic crate's walls: grey-blue with rows of slots. */
export function crateTexture(color = '#2f6fb3'): CanvasTexture {
  return make(`crate:${color}`, 128, 128, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    for (let y = 14; y < 120; y += 26) for (let x = 8; x < 120; x += 24) ctx.fillRect(x, y, 16, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, 128, 6);
  });
}

/** A terrazzo-ish wet floor: grey with chips (the shine comes from a low roughness). */
export function floorTexture(): CanvasTexture {
  return make('floor', 512, 512, (ctx) => {
    const rnd = seeded(77);
    ctx.fillStyle = '#7f8580';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const g = 90 + Math.floor(rnd() * 110);
      ctx.fillStyle = `rgba(${g},${g + 4},${g},${0.35 + rnd() * 0.4})`;
      const s = 1 + rnd() * 5;
      ctx.fillRect(rnd() * 512, rnd() * 512, s, s * (0.5 + rnd()));
    }
    ctx.strokeStyle = 'rgba(60,64,60,0.6)';
    ctx.lineWidth = 3;
    for (let k = 0; k <= 512; k += 128) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k, 512);
      ctx.moveTo(0, k);
      ctx.lineTo(512, k);
      ctx.stroke();
    }
  });
}

/** Corrugated roof sheeting: soft light / dark bands. */
export function corrugatedTexture(): CanvasTexture {
  return make('corrugated', 128, 16, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    for (let i = 0; i <= 8; i++) {
      g.addColorStop(i / 8, i % 2 ? '#9aa4ab' : '#d5dbdf');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 16);
  });
}

/**
 * The electronic scale's LCD: a live canvas (not cached) the model redraws when the weight changes.
 */
export function lcdCanvas(): { texture: CanvasTexture; draw(reading: string): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  let last = '0.00';
  const draw = (reading: string) => {
    last = reading;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0d1f14';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#7dff9a';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = '700 64px "Noto Sans SC Variable", "Noto Sans SC", Arial, sans-serif';
    ctx.fillText(reading, 196, 54);
    ctx.font = `700 30px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('斤', 204, 54);
    ctx.font = `500 16px ${FONT}`;
    ctx.fillStyle = '#4fbf6a';
    ctx.fillText('重量', 10, 16);
    texture.needsUpdate = true;
  };
  draw('0.00');
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 30px "Noto Sans SC Variable"`, '斤重量').then(() => draw(last)).catch(() => undefined);
  }
  return { texture, draw };
}
