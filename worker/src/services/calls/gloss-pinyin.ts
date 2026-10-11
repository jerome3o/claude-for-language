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

import { applyYiBuToneChanges, pinyinSyllables } from '@shared/pinyin/toneChange';
import { isChinesePunct, isHanChar } from '@shared/calls';
import {
  alignPinyin,
  contextReadings,
  impossibleSlots,
  keepCapital,
  pinyinProLine,
  pinyinSlots,
  proReadings,
  syllableFits,
  type PinyinReadingSources,
} from '../pinyin-check';

// The aligner and reading checks live in services/pinyin-check.ts (shared with the lesson / reader check).
export { alignPinyin, pinyinProLine, syllableFits } from '../pinyin-check';

export type GlossReadingSources = PinyinReadingSources;

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
  // A word that can be cut more than one way ("dàrén": dàr|én or dà|rén) is cut the way that fits.
  const words = alignPinyin(han, nfc, (h, s) => syllableFits(han[h], s, proReadings(han[h])));
  if (!words) {
    const to = applyYiBuToneChanges(hanzi, pinyinProLine(hanzi));
    return { pinyin: to || pinyin, fixes: to ? [{ hanzi, from: pinyin, to }] : [] };
  }

  // Which syllables does no reading of their character allow?
  const suspect = await impossibleSlots(pinyinSlots(han, words), sources);
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
