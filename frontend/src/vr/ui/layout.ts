/**
 * The VR panel UI kit (docs/VR.md "How a window is drawn"): a window's content is a small tree of
 * trusted node types (text, button, row, list, image, …) that this module lays out into draw
 * operations + hit regions on a canvas. The canvas becomes the window's texture; a ray (or the
 * mouse) hitting the window is turned into canvas pixels and matched against the hit regions.
 *
 * Text goes through the browser's own font stack (Noto Sans SC, self-hosted and loaded slice by
 * slice for the characters on screen), so every Chinese character renders — no glyph atlas to
 * build, nothing fetched from a CDN. Pure given `measure` (unit-tested with a fake one).
 */

export type UiTone = 'primary' | 'plain' | 'again' | 'hard' | 'good' | 'easy' | 'danger' | 'chip' | 'ghost';
export type UiColor = 'ink' | 'muted' | 'accent' | 'good' | 'bad' | 'warn' | 'zh';

export interface UiText {
  t: 'text';
  text: string;
  /** Pixels (the canvas is 1600 px a metre: 30 ≈ 1.9 cm). */
  size?: number;
  weight?: 400 | 600 | 700;
  color?: UiColor;
  align?: 'left' | 'center';
  /** Chinese in it opens the explorer when tapped, by word when `segments` match the text, else by character. */
  explore?: boolean;
  segments?: readonly string[];
  /** The whole text is one tap target. */
  action?: string;
  maxLines?: number;
}

export interface UiButton {
  t: 'button';
  label: string;
  action: string;
  tone?: UiTone;
  /** A second, smaller line (the rating's interval). */
  sub?: string;
  disabled?: boolean;
  size?: number;
  selected?: boolean;
}

export interface UiRow {
  t: 'row';
  children: Array<UiButton | UiText>;
  gap?: number;
  /** fill = the buttons share the width equally; wrap = natural widths, wrapping like chips. */
  mode?: 'fill' | 'wrap';
  align?: 'left' | 'center';
}

export interface UiListItem {
  title: string;
  sub?: string;
  right?: string;
  icon?: string;
  action: string;
  disabled?: boolean;
}

export type UiNode =
  | UiText
  | UiButton
  | UiRow
  | { t: 'list'; items: UiListItem[] }
  /** A title bar: the title on the left, small buttons on the right (a window's grab bar). */
  | { t: 'bar'; title: string; buttons: UiButton[]; color?: UiColor }
  | { t: 'image'; key: string; height: number }
  | { t: 'spacer'; h: number }
  | { t: 'divider' }
  | { t: 'progress'; value: number; max: number };

export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string; stroke?: string; hit?: number }
  | { op: 'text'; x: number; y: number; text: string; font: string; color: string }
  | { op: 'image'; x: number; y: number; w: number; h: number; key: string };

export interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  /** Index of the background rect drawn for this region (hover highlight), if any. */
  rect?: number;
}

export interface UiLayout {
  ops: DrawOp[];
  hits: HitRegion[];
  height: number;
  /** Every text drawn, by font (fonts to load before the final draw). */
  texts: Map<string, string>;
}

export type Measure = (text: string, font: string) => number;

export const UI_FONT = '"Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "WenQuanYi Zen Hei", system-ui, sans-serif';
/**
 * Latin text (English, pinyin) in a Latin-first stack: CJK fonts draw curly quotes and some
 * punctuation full-width (“I’ m”). Chinese characters always take UI_FONT.
 */
export const UI_LATIN_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans SC Variable", sans-serif';
export const UI_EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

export const UI_THEME = {
  bg: '#1a2131',
  card: '#242d41',
  line: '#343f58',
  ink: '#eef2f8',
  muted: '#9aa6bd',
  accent: '#86b9ff',
  good: '#63d394',
  bad: '#ff8585',
  warn: '#f4bd63',
  zh: '#ffffff',
  hover: 'rgba(134, 185, 255, 0.22)',
  tones: {
    primary: { bg: '#3b7ff2', fg: '#ffffff', stroke: undefined },
    plain: { bg: '#2f3a52', fg: '#eef2f8', stroke: undefined },
    again: { bg: '#b9403a', fg: '#ffffff', stroke: undefined },
    hard: { bg: '#a86f1d', fg: '#ffffff', stroke: undefined },
    good: { bg: '#2c9257', fg: '#ffffff', stroke: undefined },
    easy: { bg: '#2a72c9', fg: '#ffffff', stroke: undefined },
    danger: { bg: '#5a2a30', fg: '#ffb4b4', stroke: undefined },
    chip: { bg: '#2a3449', fg: '#eef2f8', stroke: '#45526e' },
    ghost: { bg: 'rgba(0,0,0,0)', fg: '#86b9ff', stroke: undefined },
  },
} as const;

export function fontOf(size: number, weight: number = 400, family: string = UI_FONT): string {
  return `${weight} ${size}px ${family}`;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const HAN_RE = /\p{Script=Han}/u;
/** Characters that break anywhere (CJK, kana, full-width punctuation). */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

interface Token {
  text: string;
  font: string;
  width: number;
  /** Segment index this token belongs to (explorable text), else -1. */
  seg: number;
  space: boolean;
}

function colorOf(c: UiColor | undefined): string {
  switch (c) {
    case 'muted': return UI_THEME.muted;
    case 'accent': return UI_THEME.accent;
    case 'good': return UI_THEME.good;
    case 'bad': return UI_THEME.bad;
    case 'warn': return UI_THEME.warn;
    case 'zh': return UI_THEME.zh;
    default: return UI_THEME.ink;
  }
}

/** The text cut into explorable segments: `segments` when they concatenate to it, else one per character. */
export function exploreSegments(text: string, segments?: readonly string[]): string[] {
  if (segments && segments.length > 0 && segments.join('') === text) return [...segments];
  return [...text];
}

/** Splits text into wrap tokens: one per CJK character / emoji, Latin words with their trailing space. */
export function tokenize(text: string, size: number, weight: number, measure: Measure, segments?: string[]): Token[] {
  const font = fontOf(size, weight);
  const latinFont = fontOf(size, weight, UI_LATIN_FONT);
  const emojiFont = fontOf(size, weight, UI_EMOJI_FONT);
  const tokens: Token[] = [];
  // Map every code point index to its segment.
  const chars = [...text];
  const segOf: number[] = [];
  if (segments) {
    segments.forEach((s, i) => { for (const _ of s) segOf.push(i); });
  }
  let word = '';
  let wordSeg = -1;
  const flushWord = () => {
    if (!word) return;
    tokens.push({ text: word, font: latinFont, width: measure(word, latinFont), seg: wordSeg, space: false });
    word = '';
    wordSeg = -1;
  };
  chars.forEach((ch, i) => {
    const seg = segments ? (segOf[i] ?? -1) : -1;
    if (ch === '\n') {
      flushWord();
      tokens.push({ text: '\n', font, width: 0, seg: -1, space: true });
      return;
    }
    if (ch === ' ' || ch === '\t') {
      flushWord();
      tokens.push({ text: ' ', font: latinFont, width: measure(' ', latinFont), seg, space: true });
      return;
    }
    if (EMOJI_RE.test(ch)) {
      flushWord();
      tokens.push({ text: ch, font: emojiFont, width: measure(ch, emojiFont), seg, space: false });
      return;
    }
    if (CJK_RE.test(ch)) {
      flushWord();
      tokens.push({ text: ch, font, width: measure(ch, font), seg, space: false });
      return;
    }
    if (word && seg !== wordSeg) flushWord();
    if (!word) wordSeg = seg;
    word += ch;
  });
  flushWord();
  // Zero-width joiners / variation selectors stay with the emoji before them.
  return tokens;
}

interface Line { tokens: Token[]; width: number }

/** Greedy line filling; a token wider than the line is put on a line of its own. */
export function wrapTokens(tokens: Token[], maxWidth: number): Line[] {
  const lines: Line[] = [];
  let cur: Line = { tokens: [], width: 0 };
  for (const tok of tokens) {
    if (tok.text === '\n') {
      lines.push(cur);
      cur = { tokens: [], width: 0 };
      continue;
    }
    if (tok.space && cur.tokens.length === 0) continue; // no leading space on a line
    if (cur.width + tok.width > maxWidth && cur.tokens.length > 0 && !tok.space) {
      // drop the trailing space of the line we close
      while (cur.tokens.length && cur.tokens[cur.tokens.length - 1].space) {
        cur.width -= cur.tokens.pop()!.width;
      }
      lines.push(cur);
      cur = { tokens: [], width: 0 };
    }
    cur.tokens.push(tok);
    cur.width += tok.width;
  }
  while (cur.tokens.length && cur.tokens[cur.tokens.length - 1].space) cur.width -= cur.tokens.pop()!.width;
  if (cur.tokens.length > 0 || lines.length === 0) lines.push(cur);
  return lines;
}

export interface LayoutOptions {
  width: number;
  padding?: number;
  measure: Measure;
  maxHeight?: number;
}

const DEFAULT_TEXT = 30;

export function layoutUi(nodes: readonly UiNode[], opts: LayoutOptions): UiLayout {
  const pad = opts.padding ?? 36;
  const inner = opts.width - pad * 2;
  const ops: DrawOp[] = [];
  const hits: HitRegion[] = [];
  const texts = new Map<string, string>();
  const noteText = (font: string, text: string) => texts.set(font, (texts.get(font) ?? '') + text);
  let y = pad;

  const addHit = (x: number, yy: number, w: number, h: number, action: string, rect?: number) => {
    hits.push({ x, y: yy, w, h, action, rect });
  };

  /** Draw one wrapped line as runs of the same font (emoji in their own font). */
  const pushLine = (line: Line, x: number, baseline: number, color: string, ellipsis = false) => {
    let run = '';
    let runFont = '';
    let runX = x;
    let cx = x;
    for (const tok of line.tokens) {
      if (tok.font !== runFont) {
        if (run) { ops.push({ op: 'text', x: runX, y: baseline, text: run, font: runFont, color }); noteText(runFont, run); }
        run = '';
        runFont = tok.font;
        runX = cx;
      }
      run += tok.text;
      cx += tok.width;
    }
    if (ellipsis) run = `${run.trimEnd()}…`;
    if (run) { ops.push({ op: 'text', x: runX, y: baseline, text: run, font: runFont, color }); noteText(runFont, run); }
  };

  const textBlock = (n: UiText, x0: number, width: number, yy: number): number => {
    const size = n.size ?? DEFAULT_TEXT;
    const weight = n.weight ?? 400;
    const segs = n.explore ? exploreSegments(n.text, n.segments) : undefined;
    const lines = wrapTokens(tokenize(n.text, size, weight, opts.measure, segs), width);
    const shown = n.maxLines ? lines.slice(0, n.maxLines) : lines;
    const lineH = Math.round(size * 1.4);
    const color = colorOf(n.color);
    const top = yy;
    shown.forEach((line, li) => {
      const lineX = n.align === 'center' ? x0 + (width - line.width) / 2 : x0;
      const baseline = yy + Math.round(size * 1.05);
      let x = lineX;
      // explorable pieces: consecutive tokens of the same Han segment on this line
      let pieceStart = -1;
      let pieceSeg = -1;
      const closePiece = (endX: number) => {
        if (pieceSeg >= 0 && segs && HAN_RE.test(segs[pieceSeg])) {
          addHit(pieceStart - 4, yy, endX - pieceStart + 8, lineH, `explore:${segs[pieceSeg]}`);
        }
        pieceSeg = -1;
      };
      let pending = '';
      let pendingFont = '';
      let pendingX = x;
      const flush = () => {
        if (!pending) return;
        ops.push({ op: 'text', x: pendingX, y: baseline, text: pending, font: pendingFont, color });
        noteText(pendingFont, pending);
        pending = '';
      };
      for (const tok of line.tokens) {
        if (segs && tok.seg !== pieceSeg) {
          closePiece(x);
          if (tok.seg >= 0 && !tok.space) {
            pieceStart = x;
            pieceSeg = tok.seg;
          }
        }
        if (tok.font !== pendingFont) {
          flush();
          pendingFont = tok.font;
          pendingX = x;
        }
        pending += tok.text;
        x += tok.width;
      }
      flush();
      if (segs) closePiece(x);
      yy += lineH;
      if (li === shown.length - 1 && n.maxLines && lines.length > n.maxLines) {
        ops.push({ op: 'text', x: lineX + line.width + 4, y: baseline, text: '…', font: fontOf(size, weight), color });
      }
    });
    if (n.action) addHit(x0, top, width, yy - top, n.action);
    return yy;
  };

  const buttonBox = (b: UiButton, x: number, yy: number, w: number): number => {
    const size = b.size ?? 30;
    const h = Math.round(size * (b.sub ? 3 : 2.4));
    const tone = UI_THEME.tones[b.tone ?? 'plain'];
    const fill = b.disabled ? '#262d3d' : b.selected ? '#4a5a7d' : tone.bg;
    const rectIndex = ops.length;
    ops.push({ op: 'rect', x, y: yy, w, h, r: Math.min(18, h / 2), fill, stroke: b.selected ? UI_THEME.accent : tone.stroke, hit: hits.length });
    const fg = b.disabled ? '#6b7690' : tone.fg;
    const lines = wrapTokens(tokenize(b.label, size, 600, opts.measure), w - 24);
    const label = lines[0];
    const baseY = yy + (b.sub ? h * 0.46 : h / 2 + size * 0.36);
    pushLine(label, x + (w - label.width) / 2, baseY, fg, lines.length > 1);
    if (b.sub) {
      const subSize = Math.round(size * 0.7);
      const subFont = fontOf(subSize, 400);
      const sw = opts.measure(b.sub, subFont);
      ops.push({ op: 'text', x: x + (w - sw) / 2, y: yy + h * 0.78, text: b.sub, font: subFont, color: b.disabled ? '#6b7690' : 'rgba(255,255,255,0.8)' });
      noteText(subFont, b.sub);
    }
    if (!b.disabled) addHit(x, yy, w, h, b.action, rectIndex);
    return h;
  };

  const naturalWidth = (c: UiButton | UiText): number => {
    if (c.t === 'button') {
      const size = c.size ?? 30;
      const w = wrapTokens(tokenize(c.label, size, 600, opts.measure), 1e9)[0]?.width ?? 0;
      return Math.ceil(w + size * 1.3);
    }
    const size = c.size ?? DEFAULT_TEXT;
    return Math.ceil(wrapTokens(tokenize(c.text, size, c.weight ?? 400, opts.measure), 1e9)[0]?.width ?? 0);
  };

  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        y = textBlock(n, pad, inner, y) + 8;
        break;
      case 'button':
        y += buttonBox(n, pad, y, inner) + 14;
        break;
      case 'row': {
        const gap = n.gap ?? 14;
        if (n.mode === 'wrap') {
          let x = pad;
          let rowH = 0;
          const widths = n.children.map((c) => Math.min(inner, naturalWidth(c)));
          // centre each line of chips when asked
          const linesOf: Array<{ items: number[]; width: number }> = [{ items: [], width: 0 }];
          widths.forEach((w, i) => {
            const line = linesOf[linesOf.length - 1];
            const need = line.items.length ? line.width + gap + w : w;
            if (need > inner && line.items.length) linesOf.push({ items: [i], width: w });
            else { line.items.push(i); line.width = need; }
          });
          for (const line of linesOf) {
            x = n.align === 'center' ? pad + (inner - line.width) / 2 : pad;
            rowH = 0;
            for (const i of line.items) {
              const c = n.children[i];
              const w = widths[i];
              const h = c.t === 'button' ? buttonBox(c, x, y, w) : textBlock(c, x, w + 2, y) - y;
              rowH = Math.max(rowH, h);
              x += w + gap;
            }
            y += rowH + gap;
          }
        } else {
          const count = n.children.length;
          if (count === 0) break;
          const w = (inner - gap * (count - 1)) / count;
          let rowH = 0;
          n.children.forEach((c, i) => {
            const x = pad + i * (w + gap);
            const h = c.t === 'button' ? buttonBox(c, x, y, w) : textBlock({ ...c, align: c.align ?? 'center' }, x, w, y) - y;
            rowH = Math.max(rowH, h);
          });
          y += rowH + 14;
        }
        break;
      }
      case 'list': {
        for (const item of n.items) {
          const h = item.sub ? 104 : 80;
          const rectIndex = ops.length;
          ops.push({ op: 'rect', x: pad, y, w: inner, h, r: 16, fill: item.disabled ? '#20283a' : UI_THEME.card, hit: hits.length });
          let tx = pad + 22;
          if (item.icon) {
            const f = fontOf(40, 400, UI_EMOJI_FONT);
            ops.push({ op: 'text', x: tx, y: y + h / 2 + 14, text: item.icon, font: f, color: UI_THEME.ink });
            noteText(f, item.icon);
            tx += 62;
          }
          const rightW = item.right ? opts.measure(item.right, fontOf(26, 600)) : 0;
          const titleLines = wrapTokens(tokenize(item.title, 30, 600, opts.measure), inner - (tx - pad) - rightW - 50);
          pushLine(titleLines[0], tx, y + (item.sub ? 44 : 51), item.disabled ? UI_THEME.muted : UI_THEME.ink, titleLines.length > 1);
          if (item.sub) {
            const subLines = wrapTokens(tokenize(item.sub, 24, 400, opts.measure), inner - (tx - pad) - rightW - 50);
            pushLine(subLines[0], tx, y + 82, UI_THEME.muted, subLines.length > 1);
          }
          if (item.right) {
            const rf = fontOf(26, 600);
            ops.push({ op: 'text', x: pad + inner - 22 - rightW, y: y + h / 2 + 9, text: item.right, font: rf, color: UI_THEME.accent });
            noteText(rf, item.right);
          }
          if (!item.disabled) addHit(pad, y, inner, h, item.action, rectIndex);
          y += h + 12;
        }
        break;
      }
      case 'bar': {
        const size = 28;
        const gap = 10;
        const widths = n.buttons.map((b) => Math.max(64, naturalWidth({ ...b, size: b.size ?? size })));
        const buttonsW = widths.reduce((a, w) => a + w + gap, 0);
        let x = pad + inner - buttonsW + gap;
        n.buttons.forEach((b, i) => {
          buttonBox({ ...b, size: b.size ?? size }, x, y, widths[i]);
          x += widths[i] + gap;
        });
        const lines = wrapTokens(tokenize(n.title, size, 600, opts.measure), inner - buttonsW - 30);
        pushLine(lines[0], pad, y + Math.round(size * 2.4) / 2 + size * 0.36, colorOf(n.color), lines.length > 1);
        y += Math.round(size * 2.4);
        break;
      }
      case 'image':
        ops.push({ op: 'image', x: pad, y, w: inner, h: n.height, key: n.key });
        y += n.height + 16;
        break;
      case 'spacer':
        y += n.h;
        break;
      case 'divider':
        ops.push({ op: 'rect', x: pad, y: y + 8, w: inner, h: 2, r: 0, fill: UI_THEME.line });
        y += 26;
        break;
      case 'progress': {
        const frac = n.max > 0 ? Math.max(0, Math.min(1, n.value / n.max)) : 0;
        ops.push({ op: 'rect', x: pad, y, w: inner, h: 12, r: 6, fill: UI_THEME.line });
        if (frac > 0) ops.push({ op: 'rect', x: pad, y, w: Math.max(12, inner * frac), h: 12, r: 6, fill: UI_THEME.accent });
        y += 30;
        break;
      }
    }
  }
  let height = Math.ceil(y + pad - 14);
  if (opts.maxHeight && height > opts.maxHeight) height = opts.maxHeight;
  return { ops, hits: hits.filter((h) => h.y < height), height, texts };
}

/** The hit region under a canvas pixel (the topmost one), or null. */
export function hitAt(layout: Pick<UiLayout, 'hits'>, x: number, y: number): HitRegion | null {
  for (let i = layout.hits.length - 1; i >= 0; i--) {
    const h = layout.hits[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
  }
  return null;
}
