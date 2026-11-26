/**
 * The restaurant's own canvas textures (drawn once, cached): the menu board on the wall, the bill, the
 * "scan to pay" card with a QR-like pattern (random modules, NOT a working code), a hanging scroll and
 * the tea-and-noodles price cards. Chinese is drawn in the VR font (Noto Sans SC, self-hosted) and
 * redrawn once its slices are in, like the kit's sign texture.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import { seeded } from '../kit';

const cache = new Map<string, CanvasTexture>();
const FONT = '"Noto Sans SC Variable", "Noto Sans SC", sans-serif';

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, text: string): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  if (ctx && typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, text).then(() => {
      draw(ctx);
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}

export const MENU: Array<[string, string]> = [
  ['小笼包', '18'], ['饺子', '22'], ['红烧鱼', '58'], ['宫保鸡丁', '32'],
  ['麻婆豆腐', '16'], ['酸辣汤', '15'], ['米饭', '2'], ['啤酒', '8'],
];

/** The menu board: 菜单 in gold on dark red, two columns of dishes with prices in 元. */
export function menuTexture(): CanvasTexture {
  const text = `菜单${MENU.map(([a, b]) => a + b).join('')}元今日特价`;
  return make('menu', 1024, 448, (ctx) => {
    ctx.fillStyle = '#5b1414';
    ctx.fillRect(0, 0, 1024, 448);
    ctx.strokeStyle = '#d9a845';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, 996, 420);
    ctx.lineWidth = 2;
    ctx.strokeRect(26, 26, 972, 396);
    ctx.fillStyle = '#ffd66b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 78px ${FONT}`;
    ctx.fillText('菜 单', 512, 82);
    ctx.font = `600 50px ${FONT}`;
    MENU.forEach(([dish, price], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x0 = col === 0 ? 80 : 560;
      const y = 172 + row * 68;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff2d2';
      ctx.fillText(dish, x0, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd66b';
      ctx.fillText(`${price}元`, x0 + 390, y);
      ctx.fillStyle = 'rgba(255,214,107,0.35)';
      ctx.fillRect(x0 + 210, y + 4, 90, 3);
    });
    // a "today's special" stamp
    ctx.save();
    ctx.translate(900, 80);
    ctx.rotate(-0.18);
    ctx.fillStyle = '#ffd66b';
    ctx.fillRect(-82, -26, 164, 52);
    ctx.fillStyle = '#9a1a1a';
    ctx.textAlign = 'center';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText('今日特价', 0, 2);
    ctx.restore();
  }, text);
}

/** The bill (账单): a till receipt with the dishes on the table and the total. */
export function billTexture(): CanvasTexture {
  const lines: Array<[string, string]> = [['小笼包', '18'], ['饺子', '22'], ['红烧鱼', '58'], ['米饭 ×2', '4'], ['啤酒 ×2', '16']];
  const text = `账单${lines.map(([a]) => a).join('')}合计桌号谢谢光临`;
  return make('bill', 256, 384, (ctx) => {
    ctx.fillStyle = '#fbfaf4';
    ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText('账单', 128, 40);
    ctx.font = `400 18px ${FONT}`;
    ctx.fillText('桌号 3', 128, 76);
    ctx.fillRect(20, 92, 216, 2);
    ctx.font = `500 22px ${FONT}`;
    lines.forEach(([a, b], i) => {
      ctx.textAlign = 'left';
      ctx.fillText(a, 24, 120 + i * 34);
      ctx.textAlign = 'right';
      ctx.fillText(b, 232, 120 + i * 34);
    });
    ctx.fillRect(20, 292, 216, 2);
    ctx.font = `700 28px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('合计', 24, 320);
    ctx.textAlign = 'right';
    ctx.fillText('¥118', 232, 320);
    ctx.textAlign = 'center';
    ctx.font = `400 18px ${FONT}`;
    ctx.fillText('谢谢光临', 128, 360);
  }, text);
}

/** "Scan to pay" card: a QR-like pattern (random modules + three finder squares) under 扫码付款. */
export function qrTexture(): CanvasTexture {
  return make('qr', 256, 320, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText('扫码付款', 128, 34);
    const n = 21;
    const cell = 8;
    const x0 = 128 - (n * cell) / 2;
    const y0 = 84;
    const rnd = seeded(2026);
    ctx.fillStyle = '#111';
    const finder = (fx: number, fy: number) => fx < 7 && fy < 7;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inF = finder(x, y) || finder(n - 1 - x, y) || finder(x, n - 1 - y);
        if (inF) continue;
        if (rnd() < 0.47) ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
      }
    }
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const px = x0 + fx * cell;
      const py = y0 + fy * cell;
      ctx.fillStyle = '#111';
      ctx.fillRect(px, py, 7 * cell, 7 * cell);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px + cell, py + cell, 5 * cell, 5 * cell);
      ctx.fillStyle = '#111';
      ctx.fillRect(px + 2 * cell, py + 2 * cell, 3 * cell, 3 * cell);
    }
    ctx.fillStyle = '#555';
    ctx.font = `400 20px ${FONT}`;
    ctx.fillText('请扫这里', 128, 296);
  }, '扫码付款请扫这里');
}

/** A vertical hanging scroll with four characters (书法 on the wall). */
export function scrollTexture(text: string): CanvasTexture {
  return make(`scroll:${text}`, 160, 512, (ctx) => {
    ctx.fillStyle = '#efe4c8';
    ctx.fillRect(0, 0, 160, 512);
    ctx.fillStyle = '#7a5a2a';
    ctx.fillRect(0, 0, 160, 12);
    ctx.fillRect(0, 500, 160, 12);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 92px ${FONT}`;
    [...text].forEach((ch, i) => ctx.fillText(ch, 80, 80 + i * 112));
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(108, 452, 28, 28);
  }, text);
}

/** A small notice card: two lines (营业时间 / 10:00–22:00), dark text on cream. */
export function noticeTexture(line1: string, line2: string, bg = '#fff8e6', fg = '#3a2a1a'): CanvasTexture {
  return make(`notice:${line1}:${line2}:${bg}`, 512, 256, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, 488, 232);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(line1, 256, 88);
    ctx.font = `500 52px ${FONT}`;
    ctx.fillText(line2, 256, 176);
  }, line1 + line2);
}
