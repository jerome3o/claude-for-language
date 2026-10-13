/**
 * Cutting a podcast transcript into segments to listen to one at a time (docs/PODCASTS.md):
 * Soniox's timed tokens → segments of about 3–15 s that end at a sentence end, a pause or a
 * change of speaker, each with its pinyin (the app's automatic pinyin: pinyin-pro + the card
 * standard's 一 / 不 tone changes, never Claude) and, later, its English (translate.ts).
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';

/** One timed token of a Soniox async transcript. */
export interface SttToken {
  text: string;
  start_ms: number;
  end_ms: number;
  /** With speaker diarization: "1", "2"… */
  speaker?: string | number | null;
  language?: string | null;
}

/** What the apps get per segment. */
export interface PodcastSegment {
  i: number;
  start_ms: number;
  end_ms: number;
  text: string;
  /** Diarization label ("1", "2"…), null when unknown. */
  speaker: string | null;
  lang: 'zh' | 'en' | 'mixed';
  pinyin: string | null;
  /** Filled in by the translation step; null until then. */
  english: string | null;
}

export interface SegmentOptions {
  /** A segment shorter than this never ends at a short pause or a comma. */
  minMs: number;
  /** Past this, a comma or any pause ends it. */
  targetMaxMs: number;
  /** Never longer than this (cut at the next token). */
  hardMaxMs: number;
  /** A pause this long ends a segment once it is minMs long. */
  pauseMs: number;
  /** A pause this long always ends a segment. */
  longPauseMs: number;
}

export const SEGMENT_OPTIONS: SegmentOptions = { minMs: 3000, targetMaxMs: 12_000, hardMaxMs: 20_000, pauseMs: 550, longPauseMs: 1200 };

const SENTENCE_END = /[。？！?!…；;]["”’」』）)]*\s*$|[^\d]\.\s*$/;
const CLAUSE_END = /[，,、：:]\s*$/;
const HAN = /[㐀-鿿豈-﫿]/;

export function segmentLang(text: string): PodcastSegment['lang'] {
  const han = HAN.test(text);
  const latin = /[A-Za-z]{2,}/.test(text);
  if (han && latin) return 'mixed';
  return han ? 'zh' : 'en';
}

/** "shì “ qǐng … ”， bú" tidied like the apps' devicePinyinLine. */
export function tidyPinyin(s: string): string {
  return s
    .replace(/\s+([，。！？、：；”’）」』,.!?;:)])/g, '$1')
    .replace(/([“‘（「『(])\s+/g, '$1')
    .replace(/([，。！？、：；])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The app's automatic pinyin of a line (null when it has no Chinese). */
export function pinyinLine(text: string): string | null {
  if (!HAN.test(text)) return null;
  try {
    const raw = pinyinPro(text, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' });
    return tidyPinyin(applyYiBuToneChanges(text, raw)) || null;
  } catch {
    return null;
  }
}

function speakerOf(t: SttToken): string | null {
  return t.speaker === undefined || t.speaker === null || t.speaker === '' ? null : String(t.speaker);
}

/** Tokens → segments (no pinyin / English yet). Tokens out of order or without times are skipped. */
export function tokensToSegments(tokens: readonly SttToken[], opts: SegmentOptions = SEGMENT_OPTIONS): PodcastSegment[] {
  type Cur = { start: number; end: number; text: string; speaker: string | null };
  const raw: Cur[] = [];
  let cur: Cur | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) raw.push({ ...cur, text: cur.text.replace(/\s+/g, ' ').trim() });
    cur = null;
  };
  for (const t of tokens) {
    if (!t || typeof t.text !== 'string' || !Number.isFinite(t.start_ms) || !Number.isFinite(t.end_ms)) continue;
    if (!t.text.trim() && !cur) continue;
    const speaker = speakerOf(t);
    if (cur) {
      const c: Cur = cur;
      const gap = t.start_ms - c.end;
      const dur = c.end - c.start;
      const speakerChanged = speaker !== null && c.speaker !== null && speaker !== c.speaker && t.text.trim() !== '';
      if (speakerChanged || gap >= opts.longPauseMs || (gap >= opts.pauseMs && dur >= opts.minMs) || dur >= opts.hardMaxMs || (gap >= 250 && dur >= opts.targetMaxMs)) flush();
    }
    if (!cur) {
      if (!t.text.trim()) continue;
      cur = { start: t.start_ms, end: t.end_ms, text: '', speaker };
    }
    const c: Cur = cur;
    c.text += t.text;
    c.end = Math.max(c.end, t.end_ms);
    if (c.speaker === null && speaker !== null) c.speaker = speaker;
    const dur = c.end - c.start;
    if ((SENTENCE_END.test(c.text) && dur >= opts.minMs) || (CLAUSE_END.test(c.text) && dur >= opts.targetMaxMs)) flush();
  }
  flush();
  // A scrap (under 1.2 s: "嗯。", "对。") joins the segment before it when that stays short enough.
  const merged: Cur[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && s.end - s.start < 1200 && s.speaker === prev.speaker && s.start - prev.end < 1000 && s.end - prev.start <= opts.hardMaxMs) {
      prev.text = joinText(prev.text, s.text);
      prev.end = s.end;
      continue;
    }
    merged.push({ ...s });
  }
  return merged.map((s, i) => ({
    i,
    start_ms: Math.max(0, Math.round(s.start)),
    end_ms: Math.round(s.end),
    text: s.text,
    speaker: s.speaker,
    lang: segmentLang(s.text),
    pinyin: null,
    english: null,
  }));
}

/** Join two pieces of transcript: a space only between two Latin words. */
function joinText(a: string, b: string): string {
  return /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b;
}

/** Every segment with its pinyin; an English-only segment is its own translation. */
export function withPinyin(segments: PodcastSegment[]): PodcastSegment[] {
  return segments.map((s) => ({
    ...s,
    pinyin: s.pinyin ?? pinyinLine(s.text),
    english: s.english ?? (s.lang === 'en' ? s.text : null),
  }));
}

/** Indices of the segments still waiting for an English translation. */
export function untranslated(segments: readonly PodcastSegment[]): number[] {
  return segments.filter((s) => s.english === null || s.english === undefined).map((s) => s.i);
}
