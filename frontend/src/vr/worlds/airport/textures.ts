/**
 * The airport's canvas textures (docs/VR_WORLDS.md "The helper library" — kept in this folder): the
 * departures board, the café menu, magazine covers, the vending machine's window, the plane's livery,
 * the x-ray monitor, pictogram signs and a few posters. Drawn once, cached by key, redrawn when the
 * Chinese font's slices have loaded. Every airline, brand and place name here is INVENTED (云雀航空,
 * 青鸟航空, 星河航空, 星湖国际机场, 豆香咖啡) — no real company, logo or livery.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

const FONT = '"Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", sans-serif';
const LATIN = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const cache = new Map<string, CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, opts: { text?: string; repeat?: [number, number] } = {}): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const paint = () => {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
  };
  paint();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  cache.set(key, t);
  if (opts.text && typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`700 40px "Noto Sans SC Variable"`, opts.text).then(() => {
      paint();
      t.needsUpdate = true;
    }).catch(() => undefined);
  }
  return t;
}

function zh(px: number, weight = 700) {
  return `${weight} ${px}px ${FONT}`;
}
function en(px: number, weight = 600) {
  return `${weight} ${px}px ${LATIN}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── the departures board ───────────────────────────────────────────────

export const FLIGHTS: ReadonlyArray<{ time: string; flight: string; zh: string; en: string; gate: string; status: string; statusEn: string; color: string }> = [
  { time: '08:15', flight: 'YQ 1286', zh: '成都', en: 'Chengdu', gate: '12', status: '正在登机', statusEn: 'Boarding', color: '#5fe08a' },
  { time: '08:40', flight: 'QN 5021', zh: '上海', en: 'Shanghai', gate: '08', status: '准时', statusEn: 'On time', color: '#e8eef7' },
  { time: '09:05', flight: 'XH 3307', zh: '西安', en: "Xi'an", gate: '15', status: '延误', statusEn: 'Delayed', color: '#ffc24a' },
  { time: '09:20', flight: 'YQ 1690', zh: '广州', en: 'Guangzhou', gate: '03', status: '准时', statusEn: 'On time', color: '#e8eef7' },
  { time: '09:45', flight: 'QN 5133', zh: '昆明', en: 'Kunming', gate: '10', status: '取消', statusEn: 'Cancelled', color: '#ff6b6b' },
  { time: '10:10', flight: 'XH 3412', zh: '杭州', en: 'Hangzhou', gate: '12', status: '准时', statusEn: 'On time', color: '#e8eef7' },
  { time: '10:35', flight: 'YQ 1702', zh: '哈尔滨', en: 'Harbin', gate: '06', status: '值机', statusEn: 'Check-in', color: '#7fc8ff' },
];

const BOARD_TEXT = `出发时间航班目的地登机口状态${FLIGHTS.map((f) => f.zh + f.status).join('')}国内出发`;

/** The departures board: header, column titles, one row per flight (zebra rows, coloured status). */
export function departuresTexture(): CanvasTexture {
  return canvasTexture('dep-board', 1024, 448, (ctx) => {
    ctx.fillStyle = '#0d1524';
    ctx.fillRect(0, 0, 1024, 448);
    ctx.fillStyle = '#16305a';
    ctx.fillRect(0, 0, 1024, 70);
    ctx.fillStyle = '#ffd24a';
    ctx.font = zh(40);
    ctx.textBaseline = 'middle';
    ctx.fillText('✈ 出发', 24, 37);
    ctx.fillStyle = '#c9d7ee';
    ctx.font = en(28);
    ctx.fillText('Departures', 168, 39);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = en(34, 700);
    ctx.fillText('08:02', 1000, 38);
    ctx.textAlign = 'left';
    const cols = [24, 140, 300, 640, 760];
    const heads: Array<[string, string]> = [['时间', 'Time'], ['航班', 'Flight'], ['目的地', 'Destination'], ['登机口', 'Gate'], ['状态', 'Status']];
    heads.forEach(([a, b], i) => {
      ctx.fillStyle = '#8fa6c9';
      ctx.font = zh(22, 600);
      ctx.fillText(a, cols[i], 92);
      ctx.font = en(15, 500);
      ctx.fillText(b, cols[i] + a.length * 23 + 6, 93);
    });
    FLIGHTS.forEach((f, i) => {
      const y = 112 + i * 47;
      ctx.fillStyle = i % 2 ? '#111c2f' : '#152238';
      ctx.fillRect(0, y, 1024, 47);
      ctx.fillStyle = '#ffe9a6';
      ctx.font = en(28, 700);
      ctx.fillText(f.time, cols[0], y + 25);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(f.flight, cols[1], y + 25);
      ctx.font = zh(28);
      ctx.fillText(f.zh, cols[2], y + 24);
      ctx.fillStyle = '#9fb3d1';
      ctx.font = en(20, 500);
      ctx.fillText(f.en, cols[2] + f.zh.length * 30 + 12, y + 26);
      ctx.fillStyle = '#ffffff';
      ctx.font = en(30, 800);
      ctx.fillText(f.gate, cols[3] + 10, y + 25);
      ctx.fillStyle = f.color;
      ctx.font = zh(26);
      ctx.fillText(f.status, cols[4], y + 24);
      ctx.font = en(18, 500);
      ctx.fillText(f.statusEn, cols[4] + f.status.length * 27 + 10, y + 26);
    });
  }, { text: BOARD_TEXT });
}

/** The gate's own little screen: the flight boarding now. */
export function gateScreenTexture(): CanvasTexture {
  const f = FLIGHTS[0];
  return canvasTexture('gate-screen', 512, 288, (ctx) => {
    ctx.fillStyle = '#0d1a33';
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#1e4fa3';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.font = zh(32);
    ctx.fillText('云雀航空', 20, 34);
    ctx.font = en(20);
    ctx.fillText('Skylark Air', 170, 36);
    ctx.font = en(54, 800);
    ctx.fillText(f.flight, 20, 112);
    ctx.font = zh(52);
    ctx.fillText(`${f.zh}`, 260, 110);
    ctx.fillStyle = '#5fe08a';
    ctx.font = zh(44);
    ctx.fillText('正在登机', 20, 186);
    ctx.font = en(26);
    ctx.fillText('Now boarding', 220, 190);
    ctx.fillStyle = '#c9d7ee';
    ctx.font = zh(26, 500);
    ctx.fillText('登机口 12 · 08:15 起飞', 20, 250);
  }, { text: '云雀航空成都正在登机登机口起飞' });
}

/** A screen over the check-in desk. */
export function checkinScreenTexture(): CanvasTexture {
  return canvasTexture('checkin-screen', 512, 192, (ctx) => {
    ctx.fillStyle = '#1e4fa3';
    ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.font = zh(46);
    ctx.fillText('云雀航空 值机', 22, 56);
    ctx.font = en(24);
    ctx.fillText('Skylark Air · Check-in', 24, 104);
    ctx.fillStyle = '#ffd24a';
    ctx.font = zh(30);
    ctx.fillText('YQ 1286 成都  YQ 1702 哈尔滨', 24, 152);
  }, { text: '云雀航空值机成都哈尔滨' });
}

// ── pictogram signs (Chinese airports: yellow on dark grey) ────────────

export type SignIcon = 'wc' | 'exit' | 'baggage' | 'plane' | 'security' | 'info' | 'checkin' | 'coffee' | 'lost' | 'none';

function icon(ctx: CanvasRenderingContext2D, kind: SignIcon, x: number, y: number, s: number, fg: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = 'round';
  const person = (cx: number, dress: boolean) => {
    ctx.beginPath();
    ctx.arc(cx, -s * 0.3, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    if (dress) {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.05, -s * 0.18);
      ctx.lineTo(cx + s * 0.05, -s * 0.18);
      ctx.lineTo(cx + s * 0.15, s * 0.12);
      ctx.lineTo(cx - s * 0.15, s * 0.12);
      ctx.fill();
      ctx.fillRect(cx - s * 0.08, s * 0.1, s * 0.05, s * 0.25);
      ctx.fillRect(cx + s * 0.03, s * 0.1, s * 0.05, s * 0.25);
    } else {
      ctx.fillRect(cx - s * 0.1, -s * 0.18, s * 0.2, s * 0.3);
      ctx.fillRect(cx - s * 0.09, s * 0.1, s * 0.07, s * 0.25);
      ctx.fillRect(cx + s * 0.02, s * 0.1, s * 0.07, s * 0.25);
    }
  };
  switch (kind) {
    case 'wc':
      person(-s * 0.2, false);
      person(s * 0.2, true);
      ctx.fillRect(-s * 0.02, -s * 0.42, s * 0.04, s * 0.8);
      break;
    case 'exit': {
      // a running figure into a door
      ctx.strokeRect(s * 0.05, -s * 0.38, s * 0.3, s * 0.76);
      ctx.beginPath();
      ctx.arc(-s * 0.12, -s * 0.28, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, -s * 0.16);
      ctx.lineTo(-s * 0.2, s * 0.05);
      ctx.lineTo(-s * 0.36, s * 0.32);
      ctx.moveTo(-s * 0.2, s * 0.05);
      ctx.lineTo(-s * 0.02, s * 0.32);
      ctx.moveTo(-s * 0.16, -s * 0.12);
      ctx.lineTo(-s * 0.36, -s * 0.02);
      ctx.moveTo(-s * 0.16, -s * 0.12);
      ctx.lineTo(0, -s * 0.06);
      ctx.stroke();
      break;
    }
    case 'baggage':
      roundRect(ctx, -s * 0.3, -s * 0.2, s * 0.6, s * 0.45, s * 0.06);
      ctx.fill();
      ctx.lineWidth = s * 0.06;
      ctx.strokeRect(-s * 0.12, -s * 0.34, s * 0.24, s * 0.14);
      ctx.fillRect(-s * 0.42, s * 0.33, s * 0.84, s * 0.05);
      break;
    case 'plane':
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-s * 0.05, -s * 0.42, s * 0.1, s * 0.84);
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, s * 0.05);
      ctx.lineTo(0, -s * 0.15);
      ctx.lineTo(s * 0.4, s * 0.05);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, s * 0.42);
      ctx.lineTo(0, s * 0.28);
      ctx.lineTo(s * 0.18, s * 0.42);
      ctx.fill();
      break;
    case 'security':
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4);
      ctx.lineTo(s * 0.32, -s * 0.26);
      ctx.lineTo(s * 0.28, s * 0.12);
      ctx.lineTo(0, s * 0.4);
      ctx.lineTo(-s * 0.28, s * 0.12);
      ctx.lineTo(-s * 0.32, -s * 0.26);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.14, 0);
      ctx.lineTo(-s * 0.02, s * 0.12);
      ctx.lineTo(s * 0.16, -s * 0.12);
      ctx.stroke();
      break;
    case 'info':
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `800 ${Math.round(s * 0.52)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('i', 0, s * 0.03);
      break;
    case 'checkin':
      roundRect(ctx, -s * 0.38, -s * 0.05, s * 0.76, s * 0.3, s * 0.04);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-s * 0.12, -s * 0.28, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-s * 0.2, -s * 0.18, s * 0.16, s * 0.13);
      ctx.fillRect(s * 0.06, -s * 0.22, s * 0.2, s * 0.17);
      break;
    case 'coffee':
      roundRect(ctx, -s * 0.26, -s * 0.12, s * 0.42, s * 0.38, s * 0.08);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.2, s * 0.04, s * 0.1, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      for (const dx of [-0.12, 0, 0.12]) {
        ctx.beginPath();
        ctx.moveTo(s * dx - s * 0.02, -s * 0.38);
        ctx.quadraticCurveTo(s * dx + s * 0.06, -s * 0.28, s * dx - s * 0.02, -s * 0.18);
        ctx.stroke();
      }
      break;
    case 'lost':
      ctx.beginPath();
      ctx.arc(-s * 0.06, -s * 0.06, s * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(s * 0.1, s * 0.1);
      ctx.lineTo(s * 0.32, s * 0.32);
      ctx.stroke();
      ctx.font = `800 ${Math.round(s * 0.3)}px ${LATIN}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', -s * 0.06, -s * 0.04);
      break;
    default:
      break;
  }
  ctx.restore();
}

/**
 * A wayfinding sign: an optional pictogram, the Chinese big, the English small under it, an optional
 * arrow. `aspect` = width / height of the board it goes on.
 */
export function wayfindingTexture(opts: { zh: string; en: string; icon?: SignIcon; arrow?: '←' | '→' | '↑' | '↓' | ''; bg?: string; fg?: string; aspect?: number }): CanvasTexture {
  const { zh: text, en: sub, icon: ic = 'none', arrow = '', bg = '#2b2f36', fg = '#ffd24a', aspect = 3 } = opts;
  const h = 160;
  const w = Math.min(1024, Math.round(h * aspect));
  return canvasTexture(`way:${text}:${sub}:${ic}:${arrow}:${bg}:${fg}:${w}`, w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    let x = 24;
    if (ic !== 'none') {
      icon(ctx, ic, x + 56, h / 2, 104, fg);
      x += 128;
    }
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    const big = Math.min(76, Math.floor((w - x - (arrow ? 110 : 24)) / Math.max(1, text.length)));
    ctx.font = zh(big);
    ctx.fillText(text, x, h * 0.4);
    ctx.font = en(Math.round(big * 0.42));
    ctx.fillText(sub, x + 2, h * 0.8);
    if (arrow) {
      ctx.font = en(96, 800);
      ctx.textAlign = 'right';
      ctx.fillText(arrow, w - 20, h / 2 + 4);
    }
  }, { text });
}

/** The big gate number board: "12" huge, 登机口 Gate under it. */
export function gateNumberTexture(): CanvasTexture {
  return canvasTexture('gate-number', 512, 288, (ctx) => {
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#20242b';
    ctx.fillRect(0, 0, 200, 288);
    ctx.fillStyle = '#ffd24a';
    ctx.font = en(150, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('12', 100, 150);
    ctx.fillStyle = '#20242b';
    ctx.font = zh(84);
    ctx.fillText('登机口', 356, 120);
    ctx.font = en(40, 700);
    ctx.fillText('Gate', 356, 215);
  }, { text: '登机口' });
}

// ── the café ───────────────────────────────────────────────────────────

export function menuTexture(): CanvasTexture {
  const items: Array<[string, string, string]> = [
    ['美式咖啡', 'Americano', '18'],
    ['拿铁', 'Latte', '22'],
    ['卡布奇诺', 'Cappuccino', '22'],
    ['热巧克力', 'Hot chocolate', '20'],
    ['绿茶', 'Green tea', '15'],
    ['三明治', 'Sandwich', '26'],
  ];
  return canvasTexture('cafe-menu', 512, 512, (ctx) => {
    ctx.fillStyle = '#25221f';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#c9a86a';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, 488, 488);
    ctx.fillStyle = '#f3e3c3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = zh(54);
    ctx.fillText('豆香咖啡', 256, 70);
    ctx.font = en(22, 500);
    ctx.fillStyle = '#c9a86a';
    ctx.fillText('BEAN & AROMA CAFÉ · 菜单 MENU', 256, 118);
    ctx.textBaseline = 'middle';
    items.forEach(([a, b, p], i) => {
      const y = 175 + i * 52;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f7efe0';
      ctx.font = zh(34, 600);
      ctx.fillText(a, 40, y);
      ctx.fillStyle = '#b9a98c';
      ctx.font = en(18, 500);
      ctx.fillText(b, 44 + a.length * 35, y + 3);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd27a';
      ctx.font = en(32, 700);
      ctx.fillText(`¥${p}`, 470, y);
    });
  }, { text: '豆香咖啡菜单美式咖啡拿铁卡布奇诺热巧克力绿茶三明治' });
}

/** A paper coffee cup's sleeve: kraft brown with the café's name. */
export function cupSleeveTexture(): CanvasTexture {
  return canvasTexture('cup-sleeve', 256, 128, (ctx) => {
    ctx.fillStyle = '#b4875a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#f6ecd9';
    ctx.font = zh(40);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('豆香', 64, 66);
    ctx.fillText('咖啡', 192, 66);
  }, { text: '豆香咖啡' });
}

// ── the vending machine and the newsstand ──────────────────────────────

/** The vending machine's window: rows of drinks and snacks with price tags, lit from inside. */
export function vendingTexture(): CanvasTexture {
  const colors = ['#d8342c', '#2c7ad8', '#f2b52f', '#3aa35b', '#f07a2a', '#8a4bd2', '#e9e4da', '#1a1a1a'];
  return canvasTexture('vending', 256, 512, (ctx) => {
    const gr = ctx.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#fbfdff');
    gr.addColorStop(1, '#dfe9f3');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < 6; row++) {
      const y = 14 + row * 82;
      ctx.fillStyle = '#9aa6b2';
      ctx.fillRect(6, y + 64, 244, 5);
      for (let k = 0; k < 5; k++) {
        const x = 12 + k * 48;
        const c = colors[(row * 3 + k * 5) % colors.length];
        ctx.fillStyle = c;
        if (row < 3) {
          // bottles
          roundRect(ctx, x + 10, y + 12, 22, 52, 6);
          ctx.fill();
          ctx.fillRect(x + 16, y + 4, 10, 10);
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillRect(x + 10, y + 32, 22, 12);
        } else if (row < 5) {
          // cans
          roundRect(ctx, x + 7, y + 22, 28, 42, 5);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillRect(x + 7, y + 36, 28, 6);
        } else {
          // snacks
          roundRect(ctx, x + 4, y + 18, 36, 46, 4);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(x + 22, y + 40, 8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 6, y + 69, 32, 10);
        ctx.fillStyle = '#d12b2b';
        ctx.font = en(9, 700);
        ctx.textAlign = 'center';
        ctx.fillText(`¥${3 + ((row + k) % 4)}`, x + 22, y + 77);
      }
    }
  });
}

/** The vending machine's header: 自动售货机 + a cold-drinks wave. */
export function vendingHeaderTexture(): CanvasTexture {
  return canvasTexture('vending-head', 512, 128, (ctx) => {
    const gr = ctx.createLinearGradient(0, 0, 512, 0);
    gr.addColorStop(0, '#1f6fd1');
    gr.addColorStop(1, '#27b0d9');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = zh(52);
    ctx.fillText('冰爽饮料', 256, 52);
    ctx.font = en(22, 600);
    ctx.fillText('COLD DRINKS · 扫码支付', 256, 102);
  }, { text: '冰爽饮料扫码支付' });
}

export const MAGAZINES: ReadonlyArray<{ title: string; sub: string; bg: string; fg: string }> = [
  { title: '旅行', sub: 'TRAVEL', bg: '#2a8bb6', fg: '#ffffff' },
  { title: '美食', sub: 'FOOD', bg: '#d65b3a', fg: '#fff6e8' },
  { title: '科技', sub: 'TECH', bg: '#1b1f2a', fg: '#7fe0ff' },
  { title: '时尚', sub: 'STYLE', bg: '#e9dfd3', fg: '#a12b48' },
  { title: '汽车', sub: 'CARS', bg: '#c32727', fg: '#ffffff' },
  { title: '摄影', sub: 'PHOTO', bg: '#3c4b2e', fg: '#f3e6b0' },
  { title: '读书', sub: 'BOOKS', bg: '#f2c14e', fg: '#2a2a2a' },
  { title: '健康', sub: 'HEALTH', bg: '#4aa36b', fg: '#ffffff' },
];

/** One magazine cover (a title, a band, an abstract "photo"). */
export function coverTexture(i: number): CanvasTexture {
  const m = MAGAZINES[i % MAGAZINES.length];
  return canvasTexture(`cover:${i}`, 128, 176, (ctx) => {
    ctx.fillStyle = m.bg;
    ctx.fillRect(0, 0, 128, 176);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(80, 110, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 128, 128, 48);
    ctx.fillStyle = m.fg;
    ctx.font = zh(44);
    ctx.textBaseline = 'top';
    ctx.fillText(m.title, 10, 8);
    ctx.font = en(14, 700);
    ctx.fillText(m.sub, 12, 58);
    ctx.font = zh(13, 500);
    ctx.fillText('第 11 期', 12, 150);
  }, { text: `${m.title}第期` });
}

/** The newsstand's shelf fronts: a row of covers in one texture (one draw per shelf). */
export function coverRowTexture(start: number): CanvasTexture {
  return canvasTexture(`cover-row:${start}`, 512, 176, (ctx) => {
    for (let k = 0; k < 4; k++) {
      const src = coverTexture(start + k).image as HTMLCanvasElement;
      ctx.drawImage(src, k * 128, 0);
    }
  }, { text: MAGAZINES.map((m) => m.title).join('') + '第期' });
}

/** A newspaper's front page. */
export function newspaperTexture(): CanvasTexture {
  return canvasTexture('newspaper', 256, 320, (ctx) => {
    ctx.fillStyle = '#f1ede2';
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = zh(40);
    ctx.textAlign = 'center';
    ctx.fillText('星湖晚报', 128, 48);
    ctx.fillRect(12, 60, 232, 3);
    ctx.textAlign = 'left';
    ctx.font = zh(22);
    ctx.fillText('新航线今天开通', 14, 92);
    ctx.fillStyle = '#8c8c86';
    ctx.fillRect(14, 104, 120, 80);
    ctx.fillStyle = '#555';
    for (let i = 0; i < 18; i++) ctx.fillRect(i < 7 ? 142 : 14, 108 + (i < 7 ? i : i - 7 + 11) * 10 - (i < 7 ? 0 : 0), i < 7 ? 100 : 228, 4);
  }, { text: '星湖晚报新航线今天开通' });
}

// ── documents ──────────────────────────────────────────────────────────

/** The passport's cover: dark red, gold emblem ring and 护照 / PASSPORT. (A generic design, no real emblem.) */
export function passportTexture(): CanvasTexture {
  return canvasTexture('passport', 128, 180, (ctx) => {
    ctx.fillStyle = '#6e1420';
    ctx.fillRect(0, 0, 128, 180);
    ctx.strokeStyle = '#d9b15a';
    ctx.fillStyle = '#d9b15a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 82, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const r = 12;
      if (i === 0) ctx.moveTo(64 + Math.cos(a) * r, 82 + Math.sin(a) * r);
      else ctx.lineTo(64 + Math.cos(a) * r, 82 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = zh(28);
    ctx.fillText('护照', 64, 36);
    ctx.font = en(12, 700);
    ctx.fillText('PASSPORT', 64, 138);
  }, { text: '护照' });
}

export function boardingPassTexture(): CanvasTexture {
  const f = FLIGHTS[0];
  return canvasTexture('boarding-pass', 384, 160, (ctx) => {
    ctx.fillStyle = '#fbfbf7';
    ctx.fillRect(0, 0, 384, 160);
    ctx.fillStyle = '#1e4fa3';
    ctx.fillRect(0, 0, 384, 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = zh(22);
    ctx.textBaseline = 'middle';
    ctx.fillText('云雀航空 登机牌', 12, 19);
    ctx.font = en(12, 600);
    ctx.fillText('BOARDING PASS', 254, 20);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = zh(16, 500);
    ctx.fillText('航班 Flight', 12, 54);
    ctx.fillText('登机口 Gate', 130, 54);
    ctx.fillText('座位 Seat', 240, 54);
    ctx.font = en(26, 800);
    ctx.fillText(f.flight, 12, 82);
    ctx.fillText('12', 130, 82);
    ctx.fillText('23A', 240, 82);
    ctx.font = zh(24);
    ctx.fillText('星湖 → 成都', 12, 122);
    for (let i = 0; i < 40; i++) ctx.fillRect(240 + i * 3.4, 108, (i * 7) % 3 === 0 ? 2.4 : 1.2, 40);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.moveTo(300, 36);
    ctx.lineTo(300, 100);
    ctx.stroke();
  }, { text: '云雀航空登机牌航班登机口座位星湖成都' });
}

export function idCardTexture(): CanvasTexture {
  return canvasTexture('id-card', 256, 160, (ctx) => {
    const gr = ctx.createLinearGradient(0, 0, 256, 160);
    gr.addColorStop(0, '#dfeaf4');
    gr.addColorStop(1, '#f4ede0');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#9eb3c7';
    ctx.fillRect(170, 30, 70, 90);
    ctx.fillStyle = '#c9d6e2';
    ctx.beginPath();
    ctx.arc(205, 64, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(184, 86, 42, 34);
    ctx.fillStyle = '#26323e';
    ctx.font = zh(16, 600);
    ctx.textBaseline = 'middle';
    ctx.fillText('身份证', 14, 22);
    ctx.font = zh(14, 500);
    ['姓名  李明', '性别  男', '出生  1995.03.12', '住址  星湖市'].forEach((l, i) => ctx.fillText(l, 14, 50 + i * 24));
    ctx.font = en(14, 700);
    ctx.fillText('0000 0000 0000 0000', 14, 146);
  }, { text: '身份证姓名李明性别男出生住址星湖市' });
}

export function luggageTagTexture(): CanvasTexture {
  return canvasTexture('bag-tag', 128, 64, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#1e4fa3';
    ctx.fillRect(0, 0, 128, 18);
    ctx.fillStyle = '#111';
    ctx.font = en(26, 900);
    ctx.fillText('CTU', 8, 48);
    for (let i = 0; i < 16; i++) ctx.fillRect(72 + i * 3.3, 26, i % 3 ? 1.2 : 2.4, 30);
  });
}

// ── the x-ray monitor and the scale display ────────────────────────────

/** What the x-ray monitor shows while the machine runs: an orange / blue / green scan of a bag. */
export function scanTexture(): CanvasTexture {
  return canvasTexture('xray-scan', 256, 160, (ctx) => {
    ctx.fillStyle = '#f2f4f6';
    ctx.fillRect(0, 0, 256, 160);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#f0a050';
    roundRect(ctx, 30, 30, 196, 100, 10);
    ctx.fill();
    ctx.fillStyle = '#3d7fd9';
    roundRect(ctx, 52, 48, 60, 34, 6);
    ctx.fill();
    ctx.fillStyle = '#58b368';
    roundRect(ctx, 130, 58, 70, 52, 6);
    ctx.fill();
    ctx.fillStyle = '#28323c';
    ctx.fillRect(66, 92, 40, 8);
    ctx.beginPath();
    ctx.arc(160, 84, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1b2733';
    ctx.font = en(14, 700);
    ctx.fillText('LANE 2  ●  SCAN', 10, 152);
  });
}

/** The scale's LED display: a fresh canvas per scale, redrawn when the weight changes. */
export function makeScaleDisplay(): { texture: CanvasTexture; show(kg: number): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const show = (kg: number) => {
    if (!ctx) return;
    ctx.fillStyle = '#0b1410';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#132a1e';
    ctx.font = '700 64px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('88.8', 200, 50);
    ctx.fillStyle = kg > 23 ? '#ff6b5a' : '#56ff9a';
    ctx.fillText(kg.toFixed(1), 200, 50);
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText('kg', 246, 62);
    texture.needsUpdate = true;
  };
  show(0);
  return { texture, show };
}

// ── outside: the plane's livery, the sky ───────────────────────────────

/** The fuselage band: the airline's name and a row of windows (u = along the plane). */
export function fuselageTexture(): CanvasTexture {
  return canvasTexture('fuselage', 1024, 128, (ctx) => {
    ctx.fillStyle = '#f7f9fb';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#1e4fa3';
    ctx.font = zh(64);
    ctx.textBaseline = 'middle';
    ctx.fillText('云雀航空', 330, 44);
    ctx.font = en(34, 800);
    ctx.fillText('SKYLARK AIR', 620, 48);
    ctx.fillStyle = '#26303b';
    for (let i = 0; i < 46; i++) {
      const x = 120 + i * 18.5;
      if (x > 300 && x < 320) continue;
      roundRect(ctx, x, 86, 9, 14, 4);
      ctx.fill();
    }
    // cockpit windows at the front (u = 1)
    ctx.fillRect(985, 70, 18, 14);
    ctx.fillRect(1006, 72, 14, 12);
    // doors
    ctx.strokeStyle = '#b8c2cc';
    ctx.lineWidth = 2;
    ctx.strokeRect(930, 62, 22, 58);
    ctx.strokeRect(80, 62, 22, 58);
  }, { text: '云雀航空' });
}

/** The tail: a sky-blue fin with a stylised lark (a circle and a swoosh — an invented mark). */
export function tailTexture(): CanvasTexture {
  return canvasTexture('tail', 256, 256, (ctx) => {
    const gr = ctx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#2d7fe0');
    gr.addColorStop(1, '#1e4fa3');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(128, 110, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(70, 150);
    ctx.quadraticCurveTo(128, 70, 196, 92);
    ctx.quadraticCurveTo(140, 104, 104, 160);
    ctx.closePath();
    ctx.fill();
  });
}

/** A sky backdrop for outside the windows: gradient + a few soft clouds. */
export function skyTexture(): CanvasTexture {
  return canvasTexture('sky', 512, 256, (ctx) => {
    const gr = ctx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#6fa6dc');
    gr.addColorStop(0.65, '#bcd8ef');
    gr.addColorStop(1, '#e9eef0');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [x, y, r] of [[80, 70, 26], [110, 64, 32], [140, 74, 22], [330, 50, 20], [356, 44, 28], [384, 52, 20], [450, 110, 16], [470, 104, 22]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // distant hills
    ctx.fillStyle = '#8fa7a0';
    ctx.beginPath();
    ctx.moveTo(0, 256);
    for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, 214 - 18 * Math.sin(x / 60) - 10 * Math.sin(x / 23));
    ctx.lineTo(512, 256);
    ctx.fill();
  });
}

/** The apron: concrete slabs with a yellow taxi line and a stand's lead-in line. */
export function apronTexture(): CanvasTexture {
  return canvasTexture('apron', 512, 512, (ctx) => {
    ctx.fillStyle = '#a7a59f';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let k = 0; k < 40; k++) ctx.fillRect((k * 97) % 512, (k * 151) % 512, 30, 18);
  }, { repeat: [10, 6] });
}

/** A poster on a column: an invented tourism ad. */
export function posterTexture(kind: 'lake' | 'panda'): CanvasTexture {
  return canvasTexture(`poster:${kind}`, 256, 384, (ctx) => {
    if (kind === 'lake') {
      const gr = ctx.createLinearGradient(0, 0, 0, 384);
      gr.addColorStop(0, '#f6c27a');
      gr.addColorStop(0.55, '#e7816a');
      gr.addColorStop(0.56, '#3d6f8f');
      gr.addColorStop(1, '#203e57');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 256, 384);
      ctx.fillStyle = '#2b3a33';
      ctx.beginPath();
      ctx.moveTo(0, 215);
      ctx.lineTo(60, 160);
      ctx.lineTo(110, 200);
      ctx.lineTo(170, 140);
      ctx.lineTo(256, 215);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = zh(52);
      ctx.fillText('星湖', 24, 300);
      ctx.font = zh(24, 500);
      ctx.fillText('欢迎您再来', 26, 340);
    } else {
      ctx.fillStyle = '#c7e3b0';
      ctx.fillRect(0, 0, 256, 384);
      ctx.fillStyle = '#4f8f3a';
      for (let i = 0; i < 9; i++) ctx.fillRect(14 + i * 28, 0, 8, 240);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(128, 170, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      for (const [x, y, r] of [[82, 120, 22], [174, 120, 22], [104, 166, 13], [152, 166, 13], [128, 196, 9]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = zh(46);
      ctx.fillText('去看熊猫', 34, 300);
      ctx.font = zh(22, 500);
      ctx.fillText('成都 · 每天 6 个航班', 30, 340);
    }
  }, { text: '星湖欢迎您再来去看熊猫成都每天个航班' });
}

/** The welcome banner over the hall. */
export function bannerTexture(): CanvasTexture {
  return canvasTexture('banner', 1024, 128, (ctx) => {
    const gr = ctx.createLinearGradient(0, 0, 1024, 0);
    gr.addColorStop(0, '#123f86');
    gr.addColorStop(1, '#1f6fd1');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.font = zh(58);
    ctx.fillText('星湖国际机场 欢迎您', 36, 62);
    ctx.font = en(26, 600);
    ctx.fillStyle = '#cfe0ff';
    ctx.fillText('Xinghu International Airport · Welcome', 610, 66);
  }, { text: '星湖国际机场欢迎您' });
}

/** A gate-area carpet: dark blue-grey with a faint pattern. */
export function carpetTexture(): CanvasTexture {
  return canvasTexture('carpet', 256, 256, (ctx) => {
    ctx.fillStyle = '#39465a';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 3;
    for (let i = -256; i < 512; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 256, 256);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let k = 0; k < 600; k++) ctx.fillRect((k * 53) % 256, (k * 97) % 256, 2, 2);
  }, { repeat: [4, 3] });
}

/** Polished terrazzo floor slabs. */
export function terrazzoTexture(): CanvasTexture {
  return canvasTexture('terrazzo', 512, 512, (ctx) => {
    ctx.fillStyle = '#dcd8d0';
    ctx.fillRect(0, 0, 512, 512);
    let s = 17;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const chips = ['#bfb8ac', '#e9e5dd', '#a9a398', '#cfc7b8', '#8d8a84'];
    for (let k = 0; k < 2600; k++) {
      ctx.fillStyle = chips[k % chips.length];
      ctx.globalAlpha = 0.55;
      const r = 1 + rnd() * 3.2;
      ctx.beginPath();
      ctx.ellipse(rnd() * 512, rnd() * 512, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#b9b3a7';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 512, 512);
  }, { repeat: [12, 10] });
}

/** A conveyor / x-ray belt's rubber: dark with cross ribs (scrolled by the model while it runs). */
export function beltTexture(): CanvasTexture {
  return canvasTexture('belt', 64, 256, (ctx) => {
    ctx.fillStyle = '#26282b';
    ctx.fillRect(0, 0, 64, 256);
    ctx.fillStyle = '#3a3d41';
    for (let y = 0; y < 256; y += 16) ctx.fillRect(0, y, 64, 5);
  }, { repeat: [1, 1] });
}
