/**
 * <ExplorableText> (docs/LANGUAGE_EXPLORER.md): which parts of a text are tappable and what
 * each opens. By WORD when the place has word segments that line up with the text (reader
 * words, chat words, a breakdown), by CHARACTER otherwise. Pure; ported to the Lab app
 * (core/…/explorer/ExplorableSegments.kt, parity-tested).
 */
import { isHanCodePoint } from '../progress/known';
import { itemForText, type ExplorerItem } from './stack';

export interface WordSegmentInput {
  text: string;
  pinyin?: string | null;
  gloss?: string | null;
}

export interface ExplorableSegment {
  text: string;
  /** null = plain text (punctuation, spaces, Latin, line breaks). */
  item: ExplorerItem | null;
}

function hasHan(text: string): boolean {
  for (const ch of text) if (isHanCodePoint(ch.codePointAt(0)!)) return true;
  return false;
}

/** True when the segments' texts concatenate to the text exactly. */
export function segmentsMatch(text: string, segments: readonly WordSegmentInput[] | null | undefined): boolean {
  return !!segments && segments.length > 0 && segments.map((s) => s.text).join('') === text;
}

/** One segment per Han character; runs of anything else stay together as plain text. */
export function charSegments(text: string): ExplorableSegment[] {
  const out: ExplorableSegment[] = [];
  let plain = '';
  for (const ch of text) {
    if (isHanCodePoint(ch.codePointAt(0)!)) {
      if (plain) out.push({ text: plain, item: null });
      plain = '';
      out.push({ text: ch, item: { kind: 'char', char: ch } });
    } else plain += ch;
  }
  if (plain) out.push({ text: plain, item: null });
  return out;
}

/**
 * The text's tappable pieces: word segments when they match the text (a one-character word
 * opens the Character view, a longer one the Word view with its pinyin / gloss and the
 * sentence it sits in), else one per character.
 */
export function explorableSegments(
  text: string,
  segments?: readonly WordSegmentInput[] | null,
  sentenceOf?: (start: number, end: number) => string,
): ExplorableSegment[] {
  if (!segmentsMatch(text, segments)) return charSegments(text);
  const out: ExplorableSegment[] = [];
  let offset = 0;
  for (const s of segments!) {
    const start = offset;
    offset += s.text.length;
    if (!hasHan(s.text)) {
      out.push({ text: s.text, item: null });
      continue;
    }
    const item = itemForText(s.text, {
      pinyin: s.pinyin || undefined,
      gloss: s.gloss || undefined,
      sentence: sentenceOf ? sentenceOf(start, offset) : undefined,
    });
    out.push({ text: s.text, item });
  }
  return out;
}
