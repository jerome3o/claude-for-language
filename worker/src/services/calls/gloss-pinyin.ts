/**
 * A deterministic safety net under the board tab-complete's pinyin (services/calls/gloss.ts).
 *
 * Claude writes the pinyin of the Chinese (typed, or its own translation of typed English). Each
 * syllable is lined up with its character (one syllable per Han character; a word + 儿 may be one
 * syllable, nǎr) and checked against the readings that character can have — pinyin-pro's
 * dictionary, and for a character it doesn't accept, the character dictionary's CC-CEDICT readings
 * (`charReadings`). A reading the character NEVER has (行 as "xìng", 了 as "lè", 绿 as "lù" without
 * the ü…) means the model got that word wrong: the word is replaced with the dictionary's reading
 * of it (`wordPinyin`, CC-CEDICT word records), else pinyin-pro's reading in this sentence. When
 * the syllables can't be lined up at all (one left out or added) the whole line comes from
 * pinyin-pro, word by word. Last, every result goes through applyYiBuToneChanges — the one 一 / 不
 * rule every automatic pinyin follows.
 *
 * What it can't catch: a reading the character DOES have but not in this context (还 hái for
 * huán) — that is the model's job, which is why the prompt names those characters.
 *
 * Neutral tones: a syllable written without a mark is fine when the character has that syllable
 * with any tone (东西 dōngxi, 觉得 juéde) — the neutral tone is a property of the word.
 * 一 / 不 only need to be yi / bu: their tone is the 一 / 不 rule's.
 */

import { pinyin as pinyinPro, segment as pinyinSegment, OutputFormat } from 'pinyin-pro';
import { applyYiBuToneChanges, pinyinSyllables, syllableTone, toneless } from '@shared/pinyin/toneChange';
import { isChinesePunct, isHanChar } from '@shared/calls';

export interface GlossReadingSources {
  /** CC-CEDICT readings of characters pinyin-pro doesn't accept a syllable for (asked only for those). */
  charReadings?: (chars: string[]) => Promise<Record<string, string[]>>;
  /** The dictionary pinyin of whole words (2–6 characters), e.g. 银行 → yínháng. */
  wordPinyin?: (words: string[]) => Promise<Record<string, string>>;
}

export interface GlossPinyinFix {
  hanzi: string;
  from: string;
  to: string;
}

export interface GlossPinyinResult {
  pinyin: string;
  /** What was replaced (logged; empty when the model's pinyin passed). */
  fixes: GlossPinyinFix[];
}

/** A pinyin word: its place in the pinyin string and the characters its syllables cover. */
interface PinyinWord {
  start: number;
  end: number;
  text: string;
  syllables: string[];
  /** Index of the first Han character it covers, and one past the last. */
  hanFrom: number;
  hanTo: number;
  /** Han indexes of a 儿 folded into the syllable before it (nǎr). */
  erhua: number[];
}

const WORD_RE = /[\p{L}\p{M}'’]+/gu;

/** Readings pinyin-pro knows for one character ("行" → xíng, háng, hàng, héng). */
function proReadings(ch: string): string[] {
  try {
    return pinyinPro(ch, { multiple: true, type: 'array' }) as string[];
  } catch {
    return [];
  }
}

/** Is `syllable` a reading `ch` can have, given its readings? */
export function syllableFits(ch: string, syllable: string, readings: readonly string[]): boolean {
  const base = toneless(syllable);
  if (ch === '一') return base === 'yi';
  if (ch === '不') return base === 'bu';
  const tone = syllableTone(syllable);
  return readings.some((r) => toneless(r) === base && (tone === 5 || syllableTone(r) === tone));
}

/** Line the pinyin's words / syllables up with the Han characters, or null when they don't line up. */
export function alignPinyin(han: readonly string[], pinyin: string): PinyinWord[] | null {
  const words: PinyinWord[] = [];
  let h = 0;
  const total = (() => {
    let n = 0;
    for (const m of pinyin.matchAll(WORD_RE)) {
      const s = pinyinSyllables(m[0]);
      if (!s) return -1;
      n += s.length;
    }
    return n;
  })();
  if (total < 0) return null;
  let sylLeft = total;
  for (const m of pinyin.matchAll(WORD_RE)) {
    const syllables = pinyinSyllables(m[0])!;
    const hanFrom = h;
    const erhua: number[] = [];
    for (const s of syllables) {
      if (h >= han.length) return null;
      const base = toneless(s);
      // 儿 folded into the syllable before it: only when the counts say a character has no syllable of its own.
      if (han[h + 1] === '儿' && base.length > 1 && base.endsWith('r') && base !== 'er' && han.length - h > sylLeft) {
        erhua.push(h + 1);
        h += 2;
      } else h += 1;
      sylLeft--;
    }
    words.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], syllables, hanFrom, hanTo: h, erhua });
  }
  return h === han.length ? words : null;
}

/** pinyin-pro's reading of every Han character in this text (context-aware), or null. */
function contextReadings(han: readonly string[]): string[] | null {
  try {
    const arr = pinyinPro(han.join(''), { type: 'array' }) as string[];
    return arr.length === han.length ? arr : null;
  } catch {
    return null;
  }
}

const PUNCT_PINYIN: Record<string, string> = { '，': ',', '、': ',', '？': '?', '！': '!', '；': ';', '：': ':' };

/** The whole line from pinyin-pro, word by word ("他长大了" → "tā zhǎngdà le"). */
export function pinyinProLine(hanzi: string): string {
  let out = '';
  try {
    const segs = pinyinSegment(hanzi, { format: OutputFormat.AllSegment }) as Array<{ origin: string; result: string }>;
    for (const s of segs) {
      if (Array.from(s.origin).some(isHanChar)) out += (out ? ' ' : '') + s.result.replace(/\s+/g, '');
      else {
        const p = Array.from(s.origin).map((ch) => PUNCT_PINYIN[ch] ?? '').join('');
        out += p;
      }
    }
  } catch {
    out = (pinyinPro(hanzi.replace(/[^\p{Script=Han}]/gu, ''), { type: 'array' }) as string[]).join(' ');
  }
  return out.trim();
}

function keepCapital(like: string, word: string): string {
  return like[0] && like[0] !== like[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * Check `pinyin` (Claude's) against `hanzi` and repair it; see the file comment. Never throws:
 * a dictionary that can't be read just means pinyin-pro's readings alone decide.
 */
export async function checkGlossPinyin(hanzi: string, pinyin: string, sources: GlossReadingSources = {}): Promise<GlossPinyinResult> {
  const chars = Array.from(hanzi);
  const han = chars.filter(isHanChar);
  // Only a run of Chinese (and its punctuation) can be lined up with its pinyin.
  if (han.length === 0 || !chars.every((ch) => isHanChar(ch) || isChinesePunct(ch) || /\s/.test(ch))) {
    return { pinyin: applyYiBuToneChanges(hanzi, pinyin), fixes: [] };
  }
  const nfc = pinyin.normalize('NFC');
  const words = alignPinyin(han, nfc);
  if (!words) {
    const to = applyYiBuToneChanges(hanzi, pinyinProLine(hanzi));
    return { pinyin: to || pinyin, fixes: to ? [{ hanzi, from: pinyin, to }] : [] };
  }

  // Which syllables does no reading of their character allow?
  type Slot = { word: number; ch: string; syllable: string };
  const slots: Slot[] = [];
  words.forEach((w, wi) => {
    let h = w.hanFrom;
    for (const s of w.syllables) {
      const erhua = w.erhua.includes(h + 1);
      slots.push({ word: wi, ch: han[h], syllable: erhua ? s.replace(/r$/i, '') : s });
      h += erhua ? 2 : 1;
    }
  });
  let suspect = slots.filter((s) => !syllableFits(s.ch, s.syllable, proReadings(s.ch)));
  if (suspect.length && sources.charReadings) {
    const extra = await sources.charReadings([...new Set(suspect.map((s) => s.ch))]).catch(() => ({}) as Record<string, string[]>);
    suspect = suspect.filter((s) => !syllableFits(s.ch, s.syllable, [...proReadings(s.ch), ...(extra[s.ch] ?? [])]));
  }
  if (!suspect.length) return { pinyin: applyYiBuToneChanges(hanzi, nfc), fixes: [] };

  // Replace each bad word: the dictionary's reading of the word, else pinyin-pro's in this sentence.
  const bad = [...new Set(suspect.map((s) => s.word))];
  const spans = bad.map((wi) => han.slice(words[wi].hanFrom, words[wi].hanTo).join(''));
  const lookup = spans.filter((w) => Array.from(w).length >= 2 && Array.from(w).length <= 6 && !w.endsWith('儿'));
  const dict = lookup.length && sources.wordPinyin ? await sources.wordPinyin(lookup).catch(() => ({}) as Record<string, string>) : {};
  const context = contextReadings(han);
  const fixes: GlossPinyinFix[] = [];
  let out = nfc;
  // Right to left, so earlier positions stay valid.
  for (let k = bad.length - 1; k >= 0; k--) {
    const w = words[bad[k]];
    const span = spans[k];
    const fromDict = dict[span];
    const dictOk = fromDict && pinyinSyllables(fromDict)?.length === Array.from(span).length;
    let to: string;
    if (dictOk) to = fromDict.replace(/\s+/g, '');
    else {
      if (!context) continue;
      to = '';
      for (let h = w.hanFrom; h < w.hanTo; h++) {
        if (w.erhua.includes(h)) to += 'r';
        else to += context[h];
      }
    }
    to = keepCapital(w.text, to);
    if (to === w.text) continue;
    fixes.unshift({ hanzi: span, from: w.text, to });
    out = out.slice(0, w.start) + to + out.slice(w.end);
  }
  return { pinyin: applyYiBuToneChanges(hanzi, out), fixes };
}
