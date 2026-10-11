/**
 * The deterministic pinyin check: line a pinyin string up with its Chinese (one syllable per Han
 * character; a word + 儿 may be one syllable, nǎr) and test each syllable against the readings its
 * character can have — pinyin-pro's dictionary, and for a character it doesn't accept, the character
 * dictionary's CC-CEDICT readings (`charReadings`, worker assets). No model call, no network.
 *
 * Two users:
 * - the call board's tab-complete (services/calls/gloss-pinyin.ts, `checkGlossPinyin`), which
 *   replaces a whole wrong word and applies the 一 / 不 rule to its line;
 * - authored lessons and readers (`checkAuthoredPinyin` + `fixSpecPinyin`, below), which only touch
 *   what is IMPOSSIBLE: a syllable no reading of its character allows (扶梯 "fúqī" → "fútī"; 梯 is
 *   only ever tī), or pinyin whose syllables can't be lined up with the characters at all (one
 *   missing / extra → the line is rebuilt). A reading the character really has is never changed,
 *   even when another one fits the context better (还 hái / huán, 得 de / dé / děi, 长 cháng /
 *   zhǎng) — that needs a reader of the sentence, not a dictionary. The hanzi is never touched.
 *
 * Neutral tones: a syllable without a mark is fine when the character has that syllable with any
 * tone (东西 dōngxi, 觉得 juéde) — the neutral tone is a property of the word. 一 / 不 only need to be
 * yi / bu: their tone is the 一 / 不 rule's.
 */

import { pinyin as pinyinPro, segment as pinyinSegment, OutputFormat } from 'pinyin-pro';
import { applyYiBuToneChanges, pinyinSyllables, syllableTone, toneless } from '@shared/pinyin/toneChange';
import type { PinyinFix, PinyinWordFix } from '@shared/pinyin/fixes';
import { isChinesePunct, isHanChar } from '@shared/calls';
import { glossReadingSources } from './calls/gloss-sources';

export type { PinyinFix, PinyinWordFix } from '@shared/pinyin/fixes';

export interface PinyinReadingSources {
  /** CC-CEDICT readings of characters pinyin-pro doesn't accept a syllable for (asked only for those). */
  charReadings?: (chars: string[]) => Promise<Record<string, string[]>>;
  /** The dictionary pinyin of whole words (2–6 characters), e.g. 银行 → yínháng. */
  wordPinyin?: (words: string[]) => Promise<Record<string, string>>;
}

/** A pinyin word: its place in the pinyin string and the characters its syllables cover. */
export interface PinyinWord {
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

/** One syllable lined up with its character. */
export interface PinyinSlot {
  /** Index into the words. */
  word: number;
  /** Index of the syllable inside its word. */
  index: number;
  /** Index of its Han character. */
  han: number;
  ch: string;
  /** The syllable as written, without a folded 儿's r. */
  syllable: string;
  erhua: boolean;
}

const WORD_RE = /[\p{L}\p{M}'’]+/gu;

/** Readings pinyin-pro knows for one character ("行" → xíng, háng, hàng, héng). */
export function proReadings(ch: string): string[] {
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

/** Every syllable with its character, in order. */
export function pinyinSlots(han: readonly string[], words: readonly PinyinWord[]): PinyinSlot[] {
  const slots: PinyinSlot[] = [];
  words.forEach((w, wi) => {
    let h = w.hanFrom;
    w.syllables.forEach((s, si) => {
      const erhua = w.erhua.includes(h + 1);
      slots.push({ word: wi, index: si, han: h, ch: han[h], syllable: erhua ? s.replace(/r$/i, '') : s, erhua });
      h += erhua ? 2 : 1;
    });
  });
  return slots;
}

/** The slots no reading of their character allows (pinyin-pro first, then the character dictionary). */
export async function impossibleSlots(slots: readonly PinyinSlot[], sources: PinyinReadingSources = {}): Promise<PinyinSlot[]> {
  let suspect = slots.filter((s) => !syllableFits(s.ch, s.syllable, proReadings(s.ch)));
  if (suspect.length && sources.charReadings) {
    const extra = await sources.charReadings([...new Set(suspect.map((s) => s.ch))]).catch(() => ({}) as Record<string, string[]>);
    suspect = suspect.filter((s) => !syllableFits(s.ch, s.syllable, [...proReadings(s.ch), ...(extra[s.ch] ?? [])]));
  }
  return suspect;
}

/** pinyin-pro's reading of every Han character in this text (context-aware), or null. */
export function contextReadings(han: readonly string[]): string[] | null {
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

/** `word` with an upper-case first letter when `like` has one. */
export function keepCapital(like: string, word: string): string {
  return like[0] && like[0] !== like[0].toLowerCase() && word ? word[0].toUpperCase() + word.slice(1) : word;
}

// ---------------------------------------------------------------------------------------------
// Authored content: lessons, library lessons, readers
// ---------------------------------------------------------------------------------------------

/** Characters a line may carry and still be lined up: Han, Chinese / ASCII punctuation, spaces. */
const ASCII_PUNCT = new Set(Array.from(`.,!?;:'"()[]-~/…`));

function checkable(hanzi: string): boolean {
  const chars = Array.from(hanzi);
  return chars.some(isHanChar) && chars.every((ch) => isHanChar(ch) || isChinesePunct(ch) || ASCII_PUNCT.has(ch) || /\s/.test(ch));
}

/**
 * Readings in everyday use that the dictionaries leave out: 一 said yāo in numbers (phone / room /
 * bus numbers: 幺), 喂 wéi answering the phone.
 */
const COLLOQUIAL: Record<string, string[]> = { 一: ['yāo'], 喂: ['wéi'] };

function colloquialFits(ch: string, syllable: string): boolean {
  const extra = COLLOQUIAL[ch];
  return !!extra && extra.some((r) => toneless(r) === toneless(syllable) && (syllableTone(syllable) === 5 || syllableTone(r) === syllableTone(syllable)));
}

export interface AuthoredPinyinResult {
  pinyin: string;
  /** null = unchanged. */
  reason: PinyinFix['reason'] | null;
  words: PinyinWordFix[];
}

const UNCHANGED = (pinyin: string): AuthoredPinyinResult => ({ pinyin, reason: null, words: [] });

/**
 * Check authored pinyin against its hanzi and correct only what is impossible (see the file
 * comment). Never throws: a dictionary that can't be read just means pinyin-pro alone decides.
 * Skipped (unchanged): blank pinyin or hanzi, hanzi without Han characters, and hanzi mixing in
 * Latin letters or digits (A: 你好, 3个人) — those can't be lined up syllable by syllable.
 */
export async function checkAuthoredPinyin(hanzi: string, pinyin: string, sources: PinyinReadingSources = {}): Promise<AuthoredPinyinResult> {
  if (!hanzi?.trim() || !pinyin?.trim() || !checkable(hanzi)) return UNCHANGED(pinyin);
  const han = Array.from(hanzi).filter(isHanChar);
  const nfc = pinyin.normalize('NFC');
  // A word that isn't pinyin syllables (嗯 ǹg, hm, an English word) — can't be judged.
  // The IPA "ɡ" some sources print looks like g and means g: read it as g (same length, so every
  // position below is a position in `nfc` too).
  const probe = nfc.replace(/ɡ/g, 'g');
  for (const m of probe.matchAll(WORD_RE)) if (!pinyinSyllables(m[0])) return UNCHANGED(pinyin);
  const words = alignPinyin(han, probe);

  if (!words) {
    // A syllable missing or extra: the whole line from the dictionary.
    let rebuilt = applyYiBuToneChanges(hanzi, pinyinProLine(hanzi));
    if (!rebuilt) return UNCHANGED(pinyin);
    // Same letters, only cut differently (Xīān for Xī'ān): a segmentation question, not a missing syllable.
    const letters = (p: string) => Array.from(p.replace(/ɡ/g, 'g').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()).filter((c) => /[a-zü]/.test(c)).join('');
    if (letters(probe) === letters(rebuilt)) return UNCHANGED(pinyin);
    const lead = nfc.trimStart();
    rebuilt = keepCapital(lead, rebuilt);
    const endPunct = /[.?!。？！]$/.exec(nfc.trimEnd());
    if (endPunct && !/[.?!]$/.test(rebuilt)) rebuilt += ({ '。': '.', '？': '?', '！': '!' } as Record<string, string>)[endPunct[0]] ?? endPunct[0];
    if (rebuilt === pinyin) return UNCHANGED(pinyin);
    return { pinyin: rebuilt, reason: 'syllable_count', words: [] };
  }

  const bad = (await impossibleSlots(pinyinSlots(han, words), sources)).filter((s) => !colloquialFits(s.ch, s.syllable));
  if (!bad.length) return UNCHANGED(pinyin);

  // The replacement for each bad syllable: the dictionary's reading of its word at that place, else
  // pinyin-pro's reading of the character in this sentence. Only that syllable changes.
  const badWords = [...new Set(bad.map((s) => s.word))];
  const spanOf = (wi: number) => han.slice(words[wi].hanFrom, words[wi].hanTo).join('');
  const lookup = badWords
    .filter((wi) => !words[wi].erhua.length)
    .map(spanOf)
    .filter((w) => Array.from(w).length >= 2 && Array.from(w).length <= 6);
  const dict = lookup.length && sources.wordPinyin ? await sources.wordPinyin([...new Set(lookup)]).catch(() => ({}) as Record<string, string>) : {};
  const context = contextReadings(han);

  const fixesByWord = new Map<number, string>();
  for (const wi of badWords) {
    const w = words[wi];
    const span = spanOf(wi);
    const dictSyls = !w.erhua.length && dict[span] ? pinyinSyllables(dict[span]) : null;
    const fromDict = dictSyls && dictSyls.length === Array.from(span).length ? dictSyls : null;
    // Each syllable's position inside the word text (syllables are substrings, in order).
    let cursor = 0;
    let text = '';
    let changed = false;
    w.syllables.forEach((syl, si) => {
      const at = w.text.indexOf(syl, cursor);
      const slot = bad.find((s) => s.word === wi && s.index === si);
      if (at < 0) return;
      text += w.text.slice(cursor, at);
      let out = syl;
      if (slot) {
        const local = slot.han - w.hanFrom;
        const candidate = fromDict?.[local] ?? context?.[slot.han];
        if (candidate) {
          out = keepCapital(syl, candidate.toLowerCase()) + (slot.erhua ? 'r' : '');
          if (out !== syl) changed = true;
        }
      }
      text += out;
      cursor = at + syl.length;
    });
    text += w.text.slice(cursor);
    // A run like "réngōng" can also be cut "réng|ōng"; when the replacement spells the word the same
    // way, the syllables were only cut wrongly — nothing to fix.
    if (changed && text !== w.text) fixesByWord.set(wi, text);
  }
  if (!fixesByWord.size) return UNCHANGED(pinyin);

  let out = nfc;
  const fixes: PinyinWordFix[] = [];
  for (const wi of [...fixesByWord.keys()].sort((a, b) => b - a)) {
    const w = words[wi];
    const to = fixesByWord.get(wi)!;
    out = out.slice(0, w.start) + to + out.slice(w.end);
    fixes.unshift({ hanzi: spanOf(wi), from: w.text, to });
  }
  return { pinyin: out, reason: 'reading', words: fixes };
}

/** hanzi-key → pinyin-key pairs a lesson / reader / plan object can carry. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['hanzi', 'pinyin'],
  ['reference_hanzi', 'reference_pinyin'],
  ['content_chinese', 'content_pinyin'],
  ['sentence_clue', 'sentence_clue_pinyin'],
];

const PLURALS: Record<string, string> = {
  sections: 'section', exercises: 'exercise', lines: 'line', pages: 'page', options: 'option', pairs: 'pair', words: 'word',
  hints: 'hint', sentences: 'sentence', vocabulary_used: 'vocabulary', questions: 'question', points: 'point',
};

function label(key: string, index: number | null, node: unknown): string {
  const type = node && typeof node === 'object' && typeof (node as { type?: unknown }).type === 'string' ? ` (${(node as { type: string }).type})` : '';
  if (index === null) return key.replace(/_/g, ' ') + type;
  return `${PLURALS[key] ?? key.replace(/s$/, '')} ${index + 1}${type}`;
}

/**
 * Run `checkAuthoredPinyin` over every hanzi + pinyin pair of a spec (any JSON: a lesson, a
 * reader, an audio-lesson plan), writing the corrected pinyin IN PLACE. Returns the fixes made.
 */
export async function fixSpecPinyin(spec: unknown, sources: PinyinReadingSources = {}): Promise<PinyinFix[]> {
  const fixes: PinyinFix[] = [];
  const visit = async (node: unknown, path: string, where: string[]): Promise<void> => {
    if (Array.isArray(node)) return;
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [hk, pk] of PAIRS) {
      const hz = obj[hk];
      const py = obj[pk];
      if (typeof hz !== 'string' || typeof py !== 'string' || !py.trim()) continue;
      const r = await checkAuthoredPinyin(hz, py, sources);
      if (!r.reason) continue;
      obj[pk] = r.pinyin;
      fixes.push({ path: path ? `${path}.${pk}` : pk, where: where.join(' · ') || 'top', hanzi: hz, before: py, after: r.pinyin, reason: r.reason, words: r.words });
    }
    // A multiple-choice exercise's wrong options are distractors, sometimes on purpose with the wrong
    // tones (押金 "yàjǐn" next to "yājīn"): only the right answer is checked.
    const correct = typeof obj.correct === 'number' ? obj.correct : null;
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (key === 'options' && correct !== null && i !== correct) continue;
          await visit(value[i], `${path ? `${path}.` : ''}${key}[${i}]`, [...where, label(key, i, value[i])]);
        }
      } else if (value && typeof value === 'object') {
        await visit(value, `${path ? `${path}.` : ''}${key}`, [...where, label(key, null, value)]);
      }
    }
  };
  await visit(spec, '', []);
  return fixes;
}

/** Log how often the check fires (counts only — no content in the logs). */
export function logPinyinFixes(what: string, fixes: readonly PinyinFix[]): void {
  if (fixes.length) console.log(`[pinyin-check] ${what}: ${fixes.length} pinyin line(s) corrected`);
}

/** The dictionaries for a worker request / queue job (pinyin-pro alone without the CHAR_DICT binding). */
export function pinyinSources(env: { CHAR_DICT?: Fetcher }): PinyinReadingSources {
  return glossReadingSources(env.CHAR_DICT);
}
