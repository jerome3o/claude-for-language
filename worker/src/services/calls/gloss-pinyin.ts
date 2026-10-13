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
 * A reading the character DOES have but not in this word (直觉 "zhíjiào", 睡觉 "shuìjué" — Minghui's
 * board, 11 Oct 2026) is caught when TWO sources agree against the model: the word dictionary's
 * reading of the word and pinyin-pro's reading in this sentence (`misreadWords`, toneless, so a
 * neutral tone or a tone change is never "wrong"). One source alone is not enough (大夫 dàifu / dàfū).
 * What it still can't catch: a reading both sources allow but the context doesn't (还 hái for huán)
 * — that is the model's job, which is why the prompt names those characters.
 *
 * When the syllables can't be lined up, the whole line is rebuilt from the dictionaries
 * (`dictionaryLine`): dictionary words joined with their dictionary reading, 儿 folded (wánr), a
 * lone particle neutral (得 de) — pinyin-pro's own line splits most words into characters ("wán ér
 * dé zěn me yàng" for 你玩儿得怎么样).
 *
 * Neutral tones: a syllable written without a mark is fine when the character has that syllable
 * with any tone (东西 dōngxi, 觉得 juéde) — the neutral tone is a property of the word.
 * 一 / 不 only need to be yi / bu: their tone is the 一 / 不 rule's.
 */

import { applyYiBuToneChanges, pinyinSyllables, toneless } from '@shared/pinyin/toneChange';
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
    const to = applyYiBuToneChanges(hanzi, (await dictionaryLine(hanzi, sources)) || pinyinProLine(hanzi));
    return { pinyin: to || pinyin, fixes: to ? [{ hanzi, from: pinyin, to }] : [] };
  }

  // Which syllables does no reading of their character allow? Which words do the dictionary AND
  // pinyin-pro both read otherwise?
  const context = contextReadings(han);
  const suspect = await impossibleSlots(pinyinSlots(han, words), sources);
  const wordSpan = (wi: number) => han.slice(words[wi].hanFrom, words[wi].hanTo).join('');
  const checkable = (w: string) => Array.from(w).length >= 2 && Array.from(w).length <= 6 && !w.endsWith('儿');
  const allSpans = [...new Set(words.map((_, wi) => wordSpan(wi)).filter(checkable))];
  const dict = allSpans.length && sources.wordPinyin ? await sources.wordPinyin(allSpans).catch(() => ({}) as Record<string, string>) : {};
  const misread = misreadWords(words, han, dict, context);
  const bad = [...new Set([...suspect.map((s) => s.word), ...misread])].sort((a, b) => a - b);
  if (!bad.length) return { pinyin: applyYiBuToneChanges(hanzi, nfc), fixes: [] };

  // Replace each bad word: the dictionary's reading of the word, else pinyin-pro's in this sentence.
  const spans = bad.map(wordSpan);
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

/**
 * Words (by index) whose toneless syllables differ from BOTH the word dictionary's reading and
 * pinyin-pro's reading in this sentence at the same character (直觉 "zhíjiào": the dictionary says
 * zhíjué, pinyin-pro jué). Words with a folded 儿 are left alone.
 */
export function misreadWords(
  words: ReadonlyArray<{ syllables: string[]; hanFrom: number; hanTo: number; erhua: number[] }>,
  han: readonly string[],
  dict: Record<string, string>,
  context: readonly string[] | null,
): number[] {
  if (!context) return [];
  const out: number[] = [];
  words.forEach((w, wi) => {
    if (w.erhua.length) return;
    const span = han.slice(w.hanFrom, w.hanTo).join('');
    const ref = dict[span] ? pinyinSyllables(dict[span]) : null;
    if (!ref || ref.length !== w.syllables.length) return;
    for (let k = 0; k < w.syllables.length; k++) {
      const ch = han[w.hanFrom + k];
      if (ch === '一' || ch === '不') continue;
      const mine = toneless(w.syllables[k]);
      if (mine !== toneless(ref[k]) && mine !== toneless(context[w.hanFrom + k] ?? '')) {
        out.push(wi);
        return;
      }
    }
  });
  return out;
}

const PUNCT_PLAIN: Record<string, string> = { '，': ',', '、': ',', '？': '?', '！': '!', '；': ';', '：': ':' };
/** Particles that, standing alone (not inside a dictionary word), are neutral: 跑得快 pǎo de kuài. */
const NEUTRAL_ALONE: Record<string, string> = { 得: 'de', 的: 'de', 了: 'le', 吗: 'ma', 呢: 'ne', 吧: 'ba', 们: 'men' };
/** 儿 after these is its own syllable (女儿 nǚ'ér), never a folded r. */
const ER_SYLLABLE_AFTER = new Set(Array.from('女婴儿幼孤健'));

/**
 * The line rebuilt from the dictionaries: the longest dictionary word at each place (2–4
 * characters, its dictionary reading, joined), else pinyin-pro's reading in this sentence; 儿 after
 * a character folds into it (玩儿 → wánr); a lone particle is neutral (得 de). '' when there is
 * nothing to go on (no word dictionary, or pinyin-pro failed).
 */
export async function dictionaryLine(hanzi: string, sources: GlossReadingSources = {}): Promise<string> {
  const chars = Array.from(hanzi);
  const han = chars.filter(isHanChar);
  const context = contextReadings(han);
  if (!context || !sources.wordPinyin) return '';
  // Every 2–4 character piece inside a run of Han characters.
  const pieces = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    for (let n = 2; n <= 4 && i + n <= chars.length; n++) {
      const piece = chars.slice(i, i + n);
      if (piece.every(isHanChar)) pieces.add(piece.join(''));
    }
  }
  const dict = pieces.size ? await sources.wordPinyin([...pieces]).catch(() => ({}) as Record<string, string>) : {};
  let out = '';
  const push = (word: string) => {
    out += (out && !out.endsWith(' ') ? ' ' : '') + word;
  };
  let h = 0; // index into han / context
  for (let i = 0; i < chars.length; ) {
    const c = chars[i];
    if (!isHanChar(c)) {
      const p = PUNCT_PLAIN[c];
      if (p) out += p;
      else if (/\s/.test(c) && out && !out.endsWith(' ')) out += ' ';
      i++;
      continue;
    }
    let taken = 0;
    for (let n = 4; n >= 2 && !taken; n--) {
      const piece = chars.slice(i, i + n);
      if (piece.length < n || !piece.every(isHanChar)) continue;
      const read = dict[piece.join('')];
      const syl = read ? pinyinSyllables(read) : null;
      if (syl && (syl.length === n || (syl.length === n - 1 && piece[n - 1] === '儿'))) {
        push(read.replace(/\s+/g, ''));
        taken = n;
      }
    }
    if (taken) {
      i += taken;
      h += taken;
      continue;
    }
    let word = NEUTRAL_ALONE[c] ?? context[h];
    if (chars[i + 1] === '儿' && !ER_SYLLABLE_AFTER.has(c)) {
      word += 'r';
      i++;
      h++;
    }
    push(word);
    i++;
    h++;
  }
  return out.trim();
}
