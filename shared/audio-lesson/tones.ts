/**
 * Sleep lessons: each new word's characters with their tones, spoken in Chinese
 * (docs/AUDIO_LESSONS.md "Sleep"). Claude gives every Han character of the word its
 * CITATION tone (`char_tones`: 导 dǎo 3, 航 háng 2); this file turns that into the
 * spoken lines — "导，第三声。" per character — and, where the word itself is said
 * differently, one short line saying so: "在‘任务’里，‘务’读轻声。" (a neutral second
 * syllable written in the word's pinyin), "在‘你好’里，‘你’读第二声。" (third-tone
 * sandhi, never written in pinyin), "在‘一样’里，‘一’读第二声。" (一 / 不 changes,
 * applied with `applyYiBuToneChanges`).
 *
 * The pinyin syllable is SHOWN in the transcript ("导，dǎo，第三声。") but not spoken: a
 * Chinese voice reads Latin pinyin as English letters, and the character on its own IS
 * that syllable. When the voice would read the character alone with another reading (a
 * polyphone: 行 alone is xíng, in 银行 it is háng), it is spoken inside the word instead:
 * "银行的行，第二声。" — the default reading comes from pinyin-pro, a stand-in for what
 * the TTS voice picks.
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import { applyYiBuToneChanges, pinyinSyllables, syllableTone, toneless } from '../pinyin/toneChange';
import type { SleepCharTone } from './types';
import { fillPhrase, pickVariant, TONE_CHANGE_LINES, TONE_LINES } from './phrases';

export type ToneNumber = 1 | 2 | 3 | 4 | 5;

/** How the tones are named aloud. */
export const TONE_NAMES_ZH: Record<ToneNumber, string> = {
  1: '第一声',
  2: '第二声',
  3: '第三声',
  4: '第四声',
  5: '轻声',
};

const ORDINALS = ['第一个', '第二个', '第三个', '第四个', '第五个', '第六个'];

/** The Han characters of a word, in order. */
export function hanCharsOf(hanzi: string): string[] {
  return Array.from(hanzi.normalize('NFC')).filter((c) => /^\p{Script=Han}$/u.test(c));
}

/**
 * How the word is SPOKEN, per Han character: its written pinyin (with the 一 / 不 changes
 * applied, in case they weren't written), neutral tones as written, then third-tone sandhi
 * (in a run of 3rd tones every one but the last is said as a 2nd: 你好 → ní hǎo). Null when
 * the pinyin can't be lined up with the characters (tone numbers, erhua, a typo).
 */
export function spokenWordTones(
  hanzi: string,
  pinyin: string,
  /** The characters' own syllables (char_tones): how to split joined pinyin that reads two ways ("fāngàn"). */
  hint?: string[],
): { syllables: string[]; written: ToneNumber[]; spoken: ToneNumber[] } | null {
  const chars = hanCharsOf(hanzi);
  const syllables = splitWordPinyin(hanzi, pinyin, hint);
  if (!syllables || syllables.length !== chars.length || chars.length === 0) return null;
  const written = syllables.map((s) => syllableTone(s) as ToneNumber);
  const spoken = [...written];
  for (let i = 0; i < spoken.length - 1; i++) {
    if (written[i] === 3 && written[i + 1] === 3) spoken[i] = 2;
  }
  return { syllables, written, spoken };
}

/**
 * The word's pinyin as syllables, 一 / 不 changes applied. When the characters' own syllables
 * spell the same letters, the word is split where they say (joined pinyin can read two ways);
 * otherwise by the pinyin segmenter.
 */
function splitWordPinyin(hanzi: string, pinyin: string, hint?: string[]): string[] | null {
  const letters = Array.from(pinyin.normalize('NFC')).filter((c) => /\p{L}/u.test(c));
  let parts: string[] | null = null;
  if (hint && hint.length > 0 && hint.every((h) => typeof h === 'string' && h.trim())) {
    const hs = hint.map((h) => Array.from(h.trim().normalize('NFC')).filter((c) => /\p{L}/u.test(c)));
    if (toneless(hs.flat().join('')) === toneless(letters.join(''))) {
      parts = [];
      let at = 0;
      for (const h of hs) {
        parts.push(letters.slice(at, at + h.length).join(''));
        at += h.length;
      }
    }
  }
  if (!parts) parts = pinyinSyllables(pinyin);
  if (!parts) return null;
  return applyYiBuToneChanges(hanzi, parts.join(' ')).split(' ');
}

/** Would a voice reading the character on its own say this syllable with this tone? */
export function readsAloneAs(char: string, syllable: string): boolean {
  let alone = '';
  try {
    alone = pinyinPro(char, { toneType: 'symbol' });
  } catch {
    return true;
  }
  if (!alone || !/[a-zü]/i.test(alone)) return true;
  return alone.normalize('NFC').toLowerCase() === syllable.normalize('NFC').toLowerCase();
}

export interface CharToneLine {
  /** What the voice says. */
  spoken: string;
  /** What the transcript shows. */
  display: string;
  /** The character a per-character line is about (absent on a "在‘任务’里…" line). */
  char?: string;
}

function validTone(t: unknown): t is ToneNumber {
  return t === 1 || t === 2 || t === 3 || t === 4 || t === 5;
}

/**
 * The spoken lines for a word's characters: one per distinct character ("导，第三声。",
 * shown "导，dǎo，第三声。"), then one line per character the word says with another tone
 * ("在‘任务’里，‘务’读轻声。"). Empty without `char_tones` (plans written before them).
 */
export function charToneLines(
  word: { hanzi: string; pinyin: string; char_tones?: SleepCharTone[] },
  /** The lesson's seed and the word's index: which wording each line gets (phrases.ts); none = the plain one. */
  variation: { seed?: string; index?: number } = {},
): CharToneLine[] {
  const slot = variation.index ?? 0;
  const entries = Array.isArray(word.char_tones) ? word.char_tones.filter((e) => e && typeof e.char === 'string' && validTone(e.tone)) : [];
  if (entries.length === 0) return [];
  const hanzi = word.hanzi.trim();
  const chars = hanCharsOf(hanzi);
  const lines: CharToneLine[] = [];
  const said = new Set<string>();
  for (const e of entries) {
    const syllable = (e.pinyin ?? '').trim();
    const key = `${e.char}|${toneless(syllable)}|${e.tone}`;
    if (said.has(key)) continue; // 姐姐: the second 姐 is the same line
    said.add(key);
    const name = TONE_NAMES_ZH[e.tone];
    const inWord = chars.length > 1 && syllable && !readsAloneAs(e.char, syllable);
    const template = pickVariant(TONE_LINES, variation.seed, `toneLine:${lines.length}`, slot);
    lines.push({
      spoken: fillPhrase(template, { x: inWord ? `${hanzi}的${e.char}` : e.char, tone: name }),
      display: fillPhrase(template, { x: syllable ? `${e.char}，${syllable}` : e.char, tone: name }),
      char: e.char,
    });
  }
  // Where the word is said with another tone than the characters' own.
  const aligned = entries.length === chars.length && entries.every((e, k) => e.char === chars[k]);
  const spoken = aligned ? spokenWordTones(hanzi, word.pinyin, entries.map((e) => e.pinyin)) : null;
  if (spoken) {
    entries.forEach((e, k) => {
      const actual = spoken.spoken[k];
      if (actual === e.tone) return;
      const count = chars.filter((c) => c === e.char).length;
      const nth = count > 1 ? ORDINALS[chars.slice(0, k).filter((c) => c === e.char).length] ?? '' : '';
      const template = pickVariant(TONE_CHANGE_LINES, variation.seed, `toneChange:${k}`, slot);
      const text = fillPhrase(template, { w: hanzi, c: `${nth}‘${e.char}’`, tone: TONE_NAMES_ZH[actual] });
      lines.push({ spoken: text, display: text });
    });
  }
  return lines;
}

/** Problems with a word's `char_tones` (validateSleepPlan). */
export function charToneProblems(where: string, word: { hanzi?: unknown; pinyin?: unknown; char_tones?: unknown }): string[] {
  const problems: string[] = [];
  const hanzi = typeof word.hanzi === 'string' ? word.hanzi : '';
  const chars = hanCharsOf(hanzi);
  const field = `${where}.char_tones`;
  const example = '[{ "char": "导", "pinyin": "dǎo", "tone": 3 }, { "char": "航", "pinyin": "háng", "tone": 2 }]';
  if (!Array.isArray(word.char_tones)) {
    problems.push(`${field}: required — one entry per character of "${hanzi || 'the word'}", in order, with its citation tone, e.g. for 导航 ${example}`);
    return problems;
  }
  const list = word.char_tones as unknown[];
  if (list.length !== chars.length) {
    problems.push(`${field}: one entry per character of "${hanzi}" — ${chars.length} expected (${chars.join(' ')}), got ${list.length}`);
  }
  const hints = list.length === chars.length ? list.map((e) => (e && typeof e === 'object' && typeof (e as SleepCharTone).pinyin === 'string' ? (e as SleepCharTone).pinyin : '')) : undefined;
  const wordTones = typeof word.pinyin === 'string' ? spokenWordTones(hanzi, word.pinyin, hints) : null;
  list.forEach((raw, k) => {
    const at = `${field}[${k}]`;
    if (!raw || typeof raw !== 'object') {
      problems.push(`${at}: { char, pinyin, tone } required`);
      return;
    }
    const e = raw as Record<string, unknown>;
    if (chars[k] !== undefined && e.char !== chars[k]) problems.push(`${at}.char: expected "${chars[k]}" (the characters of "${hanzi}", in order)`);
    if (!validTone(e.tone)) {
      problems.push(`${at}.tone: 1, 2, 3, 4, or 5 for 轻声 (got ${JSON.stringify(e.tone)})`);
      return;
    }
    const py = typeof e.pinyin === 'string' ? e.pinyin.trim() : '';
    const syl = py ? pinyinSyllables(py) : null;
    if (!py) problems.push(`${at}.pinyin: required — the character's syllable with a tone mark`);
    else if (/[0-9]/.test(py)) problems.push(`${at}.pinyin: use a tone mark, not a number ("dǎo", not "dao3")`);
    else if (!syl || syl.length !== 1) problems.push(`${at}.pinyin: ONE syllable for one character (got "${py}")`);
    else if (syllableTone(py) !== e.tone) {
      const marked = syllableTone(py);
      problems.push(`${at}: "${py}" is ${marked === 5 ? 'unmarked (轻声)' : `a tone ${marked}`} but tone is ${e.tone} — make them agree`);
    } else {
      if (e.char === '一' && (toneless(py) !== 'yi' || e.tone !== 1)) problems.push(`${at}: give 一 its citation tone, yī (1) — the word's own tone change is said for you`);
      if (e.char === '不' && (toneless(py) !== 'bu' || e.tone !== 4)) problems.push(`${at}: give 不 its citation tone, bù (4) — the word's own tone change is said for you`);
      if (wordTones && k < wordTones.syllables.length && chars[k] === e.char) {
        const inWord = wordTones.syllables[k];
        if (toneless(inWord) !== toneless(py)) {
          problems.push(`${at}: "${py}" doesn't match "${inWord}" in the word's pinyin "${String(word.pinyin)}" — the reading used in this word`);
        } else if (wordTones.written[k] !== e.tone && wordTones.written[k] !== 5 && e.char !== '一' && e.char !== '不') {
          problems.push(`${at}: tone ${e.tone} here but "${inWord}" in the word's pinyin — fix whichever is wrong (a 轻声 in the word is fine: write the word's pinyin without the mark and give the character its own tone)`);
        }
      }
    }
  });
  return problems;
}
