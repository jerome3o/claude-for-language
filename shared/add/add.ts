/**
 * The learner's ＋ Add tab (`/add`; docs/ADD_TAB.md). Jerome, Nov 2026: "a landing page where it's
 * super easy to add a new card, super easy to ask for new content".
 *
 * - "Add a word": 📷 a photo (OCR → the Chinese lines as word chips → the explorer's Word view →
 *   + Add as card / ⚡ Study it today), ✏️ type it, 🎤 say it in Chinese or English.
 * - "Ask for new content": one tile per thing the app can make; each opens ONE voice-first box
 *   ("Say or type what it should be about") and creates it through the existing creation path.
 *
 * Pure rules shared by the web page (frontend/src/pages/AddPage.tsx), the worker's OCR route
 * (worker/src/routes/add-words.ts) and the Lab app (core/…/add/AddTab.kt, parity-tested by
 * android-lab/parity/fixtures/add-tab.ts).
 */
import { isHanCodePoint } from '../progress/known';

// ---------------- content tiles ----------------

export type AddContentKind = 'reader' | 'lesson' | 'audio' | 'clips' | 'picture_hunt' | 'deck' | 'ask';

export interface AddContentTile {
  kind: AddContentKind;
  icon: string;
  title: string;
  subtitle: string;
  /** The box's placeholder ("Say or type what it should be about"). */
  placeholder: string;
  /** The create button's word. */
  submitLabel: string;
  /** What is being made, for "✓ Making your reader…". */
  noun: string;
}

export const ADD_CONTENT_TILES: readonly AddContentTile[] = [
  { kind: 'reader', icon: '📖', title: 'Graded reader', subtitle: 'A short story at your level', placeholder: 'What should the story be about?', submitLabel: 'Write it', noun: 'reader' },
  { kind: 'lesson', icon: '🎯', title: 'Mini lesson', subtitle: 'Exercises on a topic or a grammar point', placeholder: 'What should the lesson practise?', submitLabel: 'Make it', noun: 'mini lesson' },
  { kind: 'audio', icon: '🎧', title: 'Audio lesson', subtitle: 'A dialogue, a sleep lesson or a story to listen to', placeholder: 'What situation should the dialogue be about?', submitLabel: 'Make it', noun: 'audio lesson' },
  { kind: 'clips', icon: '🎬', title: 'Clips', subtitle: 'Short videos on a topic', placeholder: 'What should the clips be about?', submitLabel: 'Make it', noun: 'clip' },
  { kind: 'picture_hunt', icon: '🖼', title: 'Picture hunt', subtitle: 'Find the words in a picture', placeholder: 'What should the picture show?', submitLabel: 'Draw it', noun: 'picture hunt' },
  { kind: 'deck', icon: '🃏', title: 'Deck of cards', subtitle: 'New words on a topic', placeholder: 'What topic should the cards cover?', submitLabel: 'Make it', noun: 'deck' },
  { kind: 'ask', icon: '✦', title: 'Just ask Claude', subtitle: 'Anything at all', placeholder: 'Ask Claude anything…', submitLabel: 'Ask', noun: 'chat' },
];

export function addContentTile(kind: string): AddContentTile | null {
  return ADD_CONTENT_TILES.find((t) => t.kind === kind) ?? null;
}

/** The audio lesson tile's formats: a dialogue is described; sleep / story take a pasted text. */
export type AddAudioFormat = 'dialogue' | 'sleep' | 'story';

export const ADD_AUDIO_FORMATS: readonly { format: AddAudioFormat; label: string; placeholder: string }[] = [
  { format: 'dialogue', label: 'Dialogue', placeholder: 'What situation should the dialogue be about?' },
  { format: 'sleep', label: 'Sleep', placeholder: 'Paste or say a Chinese text — its new words, very slowly' },
  { format: 'story', label: 'Story', placeholder: 'Paste or say a Chinese story to listen to and repeat' },
];

/** The box's placeholder for a tile (the audio tile's follows its format). */
export function addContentPlaceholder(kind: AddContentKind, format: AddAudioFormat = 'dialogue'): string {
  if (kind === 'audio') return ADD_AUDIO_FORMATS.find((f) => f.format === format)?.placeholder ?? ADD_CONTENT_TILES[2].placeholder;
  return addContentTile(kind)?.placeholder ?? '';
}

/** The box's language for dictation: a pasted sleep / story text is Chinese, a topic may be either. */
export function addContentLang(kind: AddContentKind, format: AddAudioFormat = 'dialogue'): 'zh' | 'en' {
  return kind === 'audio' && format !== 'dialogue' ? 'zh' : 'en';
}

export type AddResultStatus = 'making' | 'ready' | 'failed';

/** "✓ Making your reader…" / "✓ Your deck is ready" / "Couldn't make the clip — try again". */
export function addResultLine(kind: AddContentKind, status: AddResultStatus): string {
  const noun = addContentTile(kind)?.noun ?? 'it';
  if (status === 'failed') return `Couldn't make the ${noun} — try again`;
  if (status === 'ready') return `✓ Your ${noun} is ready`;
  return `✓ Making your ${noun}…`;
}

/** A topic is enough once it has 2 characters (sleep / story need a real text: 4+ Chinese characters). */
export function addContentReady(kind: AddContentKind, text: string, format: AddAudioFormat = 'dialogue'): boolean {
  const t = text.trim();
  if (kind === 'audio' && format !== 'dialogue') return hanCount(t) >= 4;
  return [...t].length >= 2;
}

// ---------------- word input ----------------

export type WordInputKind = 'chinese' | 'other' | 'empty';

/** Chinese (any Han character) → the explorer's Word view; anything else (English, pinyin) → candidates. */
export function classifyWordInput(text: string): WordInputKind {
  const t = text.trim();
  if (!t) return 'empty';
  for (const ch of t) if (isHanCodePoint(ch.codePointAt(0)!)) return 'chinese';
  return 'other';
}

export function hanCount(text: string): number {
  let n = 0;
  for (const ch of text) if (isHanCodePoint(ch.codePointAt(0)!)) n++;
  return n;
}

// ---------------- photo → OCR ----------------

/** The client resizes a photo so its longer edge is at most this (a fast upload, enough for subtitles). */
export const OCR_MAX_EDGE = 1280;
export const OCR_JPEG_QUALITY = 0.82;
/** The server refuses bigger uploads (413). */
export const OCR_MAX_BYTES = 4 * 1024 * 1024;
/** Lines returned at most. */
export const OCR_MAX_LINES = 12;

export function ocrResizeDims(width: number, height: number, maxEdge = OCR_MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / edge;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** A line of text read from a photo; `box` = [ymin, xmin, ymax, xmax] on a 0–1000 grid (Gemini's convention). */
export interface OcrLine {
  text: string;
  box?: readonly [number, number, number, number] | null;
  /** The reader's own guess: the line the photo is about (a subtitle, a sign). */
  main?: boolean;
}

const CJK_PUNCT = new Set([...'。，、！？：；“”‘’（）《》〈〉【】「」『』—…·～']);

/**
 * The Chinese of a read line: Han characters, Chinese punctuation and digits; English words, tab
 * titles and other UI noise dropped (a dropped run leaves one space), spaces between two Han
 * characters removed. '' when no Han character is left.
 */
export function ocrChineseText(raw: string): string {
  const parts: string[] = [];
  let gap = false;
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    const keep = isHanCodePoint(cp) || CJK_PUNCT.has(ch) || (ch >= '0' && ch <= '9') || (cp >= 0xff10 && cp <= 0xff19);
    if (keep) {
      if (gap && parts.length > 0) parts.push(' ');
      parts.push(ch);
      gap = false;
    } else {
      gap = true;
    }
  }
  const chars = parts;
  // Drop a space whose neighbours are both Han (OCR spacing inside a line of Chinese).
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ' ') {
      const prev = out[out.length - 1];
      const next = chars[i + 1];
      if (prev && next && isHanCodePoint(prev.codePointAt(0)!) && isHanCodePoint(next.codePointAt(0)!)) continue;
    }
    out.push(chars[i]);
  }
  const text = out.join('').trim();
  // A comma / colon left at either end of a line (its English neighbour dropped) is noise.
  const trimmed = text.replace(/^[\s、，。：；]+|[\s、，：；]+$/gu, '');
  return hanCount(trimmed) > 0 ? trimmed : '';
}

function clamp01k(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : null;
}

/** A usable box ([ymin, xmin, ymax, xmax], 0–1000, non-empty), else null. */
export function cleanOcrBox(box: unknown): [number, number, number, number] | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const v = box.map(clamp01k);
  if (v.some((x) => x === null)) return null;
  const [y0, x0, y1, x1] = v as number[];
  const ymin = Math.min(y0, y1);
  const ymax = Math.max(y0, y1);
  const xmin = Math.min(x0, x1);
  const xmax = Math.max(x0, x1);
  if (ymax - ymin <= 0 || xmax - xmin <= 0) return null;
  return [ymin, xmin, ymax, xmax];
}

/**
 * How much a line looks like what the photo is about: big text (a subtitle, a sign) near the middle
 * first; the reader's own `main` guess wins. Lines without a box score 0.5 (kept in reading order).
 */
export function ocrLineScore(line: OcrLine): number {
  const main = line.main ? 10 : 0;
  const box = line.box ? cleanOcrBox(line.box) : null;
  if (!box) return main + 0.5;
  const [ymin, xmin, ymax, xmax] = box;
  const height = (ymax - ymin) / 1000;
  const cx = (xmin + xmax) / 2000;
  const cy = (ymin + ymax) / 2000;
  const dist = Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / Math.SQRT1_2);
  const length = Math.min(hanCount(line.text), 8) * 0.02;
  return main + height * 4 + (1 - dist) + length;
}

/**
 * The lines to show, most prominent first: each cleaned to its Chinese (`ocrChineseText`), lines
 * with none dropped, duplicates (same text) kept once, at most `max`. Ties keep the reading order.
 */
export function orderOcrLines(lines: readonly OcrLine[], max = OCR_MAX_LINES): OcrLine[] {
  const seen = new Set<string>();
  const kept: Array<{ line: OcrLine; score: number; index: number }> = [];
  lines.forEach((raw, index) => {
    const text = ocrChineseText(typeof raw?.text === 'string' ? raw.text : '');
    if (!text || seen.has(text)) return;
    seen.add(text);
    const box = raw.box ? cleanOcrBox(raw.box) : null;
    const line: OcrLine = { text, box, main: !!raw.main };
    kept.push({ line, score: ocrLineScore(line), index });
  });
  kept.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return kept.slice(0, Math.max(0, max)).map((k) => k.line);
}

/**
 * A span of a line picked by hand (✂ Pick characters: tap the first character, then the last):
 * the characters from `a` to `b` (either order, code-point indexes, clamped). '' when out of range.
 */
export function ocrSpan(text: string, a: number, b: number): string {
  const chars = [...text];
  if (chars.length === 0) return '';
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(chars.length - 1, Math.max(a, b));
  if (lo > hi) return '';
  return chars.slice(lo, hi + 1).join('');
}

/** "3 lines of Chinese" / "No Chinese found in this photo". */
export function ocrFoundLine(count: number): string {
  if (count <= 0) return 'No Chinese found in this photo — try again closer up.';
  return count === 1 ? 'Tap a word to look it up' : `${count} lines of Chinese — tap a word to look it up`;
}
