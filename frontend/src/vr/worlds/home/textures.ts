/**
 * The apartment's own canvas textures (docs/VR_WORLDS.md "The helper library" — local to this world):
 * the city outside the windows, the wall calendar, the TV's weather forecast, book covers, a hanging
 * scroll, a 山水 painting, the doormat and small displays. Drawn once, cached, seeded; Chinese text is
 * drawn in the VR font and drawn AGAIN once its slices have loaded (like kit/textures.ts).
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import { seeded } from '../kit';

const cache = new Map<string, CanvasTexture>();
const FONT = '"Noto Sans SC Variable", "Noto Sans SC", sans-serif';

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, fontText?: string): CanvasTexture {
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
  if (fontText && ctx && typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, fontText).then(() => {
      ctx.clearRect(0, 0, w, h);
      draw(ctx);
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}

/** The view out of a window: sky, far towers with lit windows, near blocks, a row of trees. */
export function cityViewTexture(seed = 1, evening = false): CanvasTexture {
  return canvasTexture(`city:${seed}:${evening}`, 512, 384, (ctx) => {
    const W = 512;
    const H = 384;
    const rnd = seeded(seed * 101);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, evening ? '#f0a56f' : '#7fb3e6');
    sky.addColorStop(0.6, evening ? '#f7d3a6' : '#cfe3f3');
    sky.addColorStop(1, evening ? '#fbe6c8' : '#eef4f7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // a few soft clouds
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 4; i++) {
      const x = rnd() * W;
      const y = 30 + rnd() * 80;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(x + k * 22, y + (k % 2) * 6, 30, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // far towers (hazy), then nearer blocks with windows
    const layers: Array<[string, number, number, number]> = [
      ['#a9bccb', 0.45, 0.85, 26],
      ['#7f93a6', 0.55, 0.8, 34],
      ['#5d6c7c', 0.66, 0.92, 46],
    ];
    for (const [colour, top, bottom, wMax] of layers) {
      let x = -10;
      while (x < W) {
        const w = 20 + rnd() * wMax;
        const h = H * (bottom - top) * (0.4 + rnd() * 0.9);
        const y = H * bottom - h;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, w, H - y);
        if (colour !== '#a9bccb') {
          for (let wy = y + 6; wy < H * bottom - 6; wy += 9) {
            for (let wx = x + 4; wx < x + w - 4; wx += 7) {
              if (rnd() < (evening ? 0.35 : 0.12)) {
                ctx.fillStyle = evening ? 'rgba(255,214,140,0.9)' : 'rgba(220,235,245,0.7)';
                ctx.fillRect(wx, wy, 3, 4);
              }
            }
          }
        }
        x += w + 2 + rnd() * 6;
      }
    }
    // trees along the bottom
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * W + rnd() * 10;
      ctx.fillStyle = i % 3 === 0 ? '#4b7a3a' : '#5d8f47';
      ctx.beginPath();
      ctx.ellipse(x, H * 0.95, 16 + rnd() * 10, 22 + rnd() * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** A wall calendar page: 2026 年 · 十一月, the week from 日 (Sunday), today (25th) circled. */
export function calendarTexture(): CanvasTexture {
  const text = '二〇二六年十一月日一二三四五六今天';
  return canvasTexture('calendar', 256, 360, (ctx) => {
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, 256, 360);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#ffe7a8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText('二〇二六年', 128, 28);
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText('十一月', 128, 68);
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const cw = 256 / 7;
    ctx.font = `700 18px ${FONT}`;
    days.forEach((d, i) => {
      ctx.fillStyle = i === 0 || i === 6 ? '#c8102e' : '#333333';
      ctx.fillText(d, cw * (i + 0.5), 116);
    });
    // 1 Nov 2026 is a Sunday.
    ctx.font = `600 20px ${FONT}`;
    for (let n = 1; n <= 30; n++) {
      const idx = n - 1;
      const col = idx % 7;
      const row = Math.floor(idx / 7);
      const x = cw * (col + 0.5);
      const y = 150 + row * 40;
      if (n === 25) {
        ctx.strokeStyle = '#c8102e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = col === 0 || col === 6 ? '#c8102e' : '#222222';
      ctx.fillText(String(n), x, y);
    }
    ctx.fillStyle = '#c8102e';
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText('今天', cw * 3.5, 150 + 3 * 40 + 24);
  }, text);
}

/** The TV: a weather forecast (天气预报) — cities, weather, temperatures. */
export function tvScreenTexture(): CanvasTexture {
  const rows: Array<[string, string, string]> = [['北京', '晴', '12°'], ['上海', '多云', '17°'], ['广州', '小雨', '24°'], ['成都', '阴', '15°']];
  const text = `天气预报明天${rows.map((r) => r.join('')).join('')}`;
  return canvasTexture('tv', 512, 288, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 288);
    g.addColorStop(0, '#1f5fa8');
    g.addColorStop(1, '#0e2f63');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.ellipse(420, 70, 120, 90, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd35c';
    ctx.beginPath();
    ctx.arc(440, 64, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText('天气预报', 28, 46);
    ctx.font = `500 20px ${FONT}`;
    ctx.fillStyle = '#cfe2ff';
    ctx.fillText('明天', 30, 84);
    rows.forEach(([city, weather, temp], i) => {
      const y = 126 + i * 38;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.16)';
      ctx.fillRect(24, y - 17, 360, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 24px ${FONT}`;
      ctx.fillText(city, 40, y);
      ctx.fillText(weather, 160, y);
      ctx.fillStyle = '#ffd35c';
      ctx.fillText(temp, 290, y);
    });
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(0, 270, 512, 18);
  }, text);
}

/** A book cover with its title (and a band in a second colour). */
export function bookCoverTexture(title: string, bg: string, fg: string): CanvasTexture {
  return canvasTexture(`book:${title}:${bg}:${fg}`, 256, 360, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 360);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, 224, 328);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = title.length > 3 ? 46 : 60;
    ctx.font = `700 ${size}px ${FONT}`;
    // Vertical title, read top to bottom like a classic cover.
    [...title].forEach((c, i) => ctx.fillText(c, 128, 90 + i * (size + 8) - ((title.length - 3) * (size + 8)) / 2));
  }, title);
}

/** A vertical hanging scroll with brush-style characters (家和万事兴). */
export function scrollTexture(text: string): CanvasTexture {
  return canvasTexture(`scroll:${text}`, 160, 512, (ctx) => {
    ctx.fillStyle = '#efe4c8';
    ctx.fillRect(0, 0, 160, 512);
    ctx.fillStyle = '#7a5a2a';
    ctx.fillRect(0, 0, 160, 10);
    ctx.fillRect(0, 502, 160, 10);
    ctx.fillStyle = '#1d1a16';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 74px ${FONT}`;
    const step = 440 / text.length;
    [...text].forEach((c, i) => ctx.fillText(c, 80, 42 + step * (i + 0.5)));
    // a red seal
    ctx.fillStyle = '#b3261e';
    ctx.fillRect(98, 452, 30, 30);
  }, text);
}

/** A 山水 landscape painting: misty mountains, a river, a boat, a red seal. */
export function paintingTexture(): CanvasTexture {
  return canvasTexture('painting', 512, 220, (ctx) => {
    const rnd = seeded(808);
    ctx.fillStyle = '#f1ead8';
    ctx.fillRect(0, 0, 512, 220);
    const ranges: Array<[string, number, number]> = [['rgba(90,110,110,0.35)', 70, 60], ['rgba(60,80,80,0.55)', 110, 70], ['rgba(30,45,45,0.8)', 150, 60]];
    for (const [colour, base, amp] of ranges) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(0, 220);
      for (let x = 0; x <= 512; x += 8) {
        const y = base - Math.abs(Math.sin(x / 70 + rnd() * 0.2) * amp * (0.5 + rnd() * 0.5));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(512, 220);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(241,234,216,0.85)';
    ctx.fillRect(0, 168, 512, 22);
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(300, 178, 16, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b3261e';
    ctx.fillRect(470, 20, 22, 22);
  });
}

/** The doormat: 出入平安 (safe coming and going), one row. */
export function doormatTexture(): CanvasTexture {
  return canvasTexture('doormat', 384, 256, (ctx) => {
    ctx.fillStyle = '#8c2f24';
    ctx.fillRect(0, 0, 384, 256);
    ctx.strokeStyle = '#e8c27a';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, 356, 228);
    ctx.fillStyle = '#e8c27a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 70px ${FONT}`;
    ctx.fillText('出入平安', 192, 132);
  }, '出入平安');
}

/** A night picture for the bedroom: a full moon over plum branches and hills. */
export function moonTexture(): CanvasTexture {
  return canvasTexture('moon', 384, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#132544');
    g.addColorStop(1, '#3b4f73');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 384, 256);
    ctx.fillStyle = '#fff2c4';
    ctx.beginPath();
    ctx.arc(250, 90, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b2a40';
    ctx.beginPath();
    ctx.moveTo(0, 256);
    for (let x = 0; x <= 384; x += 12) ctx.lineTo(x, 200 - Math.sin(x / 50) * 26 - Math.sin(x / 17) * 6);
    ctx.lineTo(384, 256);
    ctx.fill();
    ctx.strokeStyle = '#0d1626';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.quadraticCurveTo(90, 70, 170, 40);
    ctx.moveTo(60, 64);
    ctx.quadraticCurveTo(80, 100, 120, 110);
    ctx.stroke();
    ctx.fillStyle = '#f2a7b8';
    for (const [x, y] of [[100, 52], [140, 46], [118, 98], [160, 42], [78, 66]]) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** A small LCD: green text on black (the air conditioner, the washing machine). */
export function lcdTexture(text: string): CanvasTexture {
  return canvasTexture(`lcd:${text}`, 128, 48, (ctx) => {
    ctx.fillStyle = '#0c1410';
    ctx.fillRect(0, 0, 128, 48);
    ctx.fillStyle = '#7dffb0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(text, 64, 25);
  }, text);
}

/** The laptop's screen: a page of Chinese practice. */
export function laptopScreenTexture(): CanvasTexture {
  const lines = ['今天的生词', '遥控器 yáokòngqì', '拖鞋 tuōxié', '闹钟 nàozhōng', '洗衣机 xǐyījī'];
  return canvasTexture('laptop', 320, 200, (ctx) => {
    ctx.fillStyle = '#f7f9fc';
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#2f6fd6';
    ctx.fillRect(0, 0, 320, 26);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1d2433';
    lines.forEach((l, i) => {
      ctx.font = `${i === 0 ? 700 : 500} ${i === 0 ? 22 : 18}px ${FONT}`;
      ctx.fillText(l, 18, 50 + i * 32);
    });
  }, lines.join(''));
}

/** A thin radial glow (the TV's light on the wall around it). */
export function glowTexture(colour = '#8cc0ff'): CanvasTexture {
  return canvasTexture(`glow:${colour}`, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** The front door's number plate, seen from the stairwell. */
export function plateTexture(text: string): CanvasTexture {
  return canvasTexture(`plate:${text}`, 128, 64, (ctx) => {
    ctx.fillStyle = '#d9b45a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#3a2a10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(text, 64, 34);
  }, text);
}
