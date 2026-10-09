/**
 * Dialogue lessons: each point's tones, said by the English host right after the word
 * (docs/AUDIO_LESSONS.md "Dialogue" → "Tones"). Jerome (Oct 2026): "when we go over the
 * individual words, also explain what the tones are."
 *
 * The same facts as a sleep lesson's tone lines (tones.ts), but in English and taken from the
 * point's own pinyin — never written by the model: "打, third tone." per character (the character
 * by the Chinese voice, the pinyin only SHOWN: "打, dǎ, third tone."), then where the word says a
 * character differently: "In 打扰了, 打 is said with a second tone, before another third tone." /
 * "In 任务, 务 is neutral tone here." / "In 一杯, 一 is said with a fourth tone, before a first tone."
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import { applyYiBuToneChanges, pinyinSyllables, syllableTone, toneless } from '../pinyin/toneChange';
import { hanCharsOf, readsAloneAs, type ToneNumber } from './tones';

/** How the English host names the tones. */
export const TONE_NAMES_EN: Record<ToneNumber, string> = {
  1: 'first tone',
  2: 'second tone',
  3: 'third tone',
  4: 'fourth tone',
  5: 'neutral tone',
};

const ORDINALS_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** One Han character of a word: its own (citation) tone and how this word says it. */
export interface WordCharTone {
  char: string;
  /** Position among the word's Han characters. */
  index: number;
  /** The character's own syllable with its citation tone ("dǎ", "wù", "yī", "le"). */
  citation: string;
  citationTone: ToneNumber;
  /** The syllable as the word's pinyin writes it (一 / 不 changes applied). */
  written: string;
  /** The tone the word is SAID with (neutral as written, third-tone sandhi, 一 / 不). */
  spoken: ToneNumber;
  /** Why `spoken` differs from `citationTone`. */
  change?: 'neutral' | 'third_tone' | 'yi_bu';
  /** Would a voice reading the character alone say `citation`? (else it is said inside the word) */
  readsAlone: boolean;
}

/** Readings of one character, the default first (pinyin-pro). */
function readingsOf(char: string): string[] {
  try {
    const first = pinyinPro(char, { toneType: 'symbol' });
    const all = pinyinPro(char, { toneType: 'symbol', multiple: true, type: 'array' }) as string[];
    return [first, ...all].filter((r, i, list) => !!r && /[a-zü]/i.test(r) && list.indexOf(r) === i);
  } catch {
    return [];
  }
}

/**
 * The word's pinyin cut into one syllable per character where the characters' own readings say
 * (joined pinyin reads two ways: "dǎrǎo" is dǎ + rǎo, not dǎr + ǎo): each character takes the
 * letters of one of its readings (pinyin-pro, tones ignored), in order. Null when they don't fit.
 */
function alignByReadings(chars: string[], pinyin: string): string[] | null {
  const letters = Array.from(pinyin.normalize('NFC')).filter((c) => /\p{L}/u.test(c));
  const plain = letters.map((c) => toneless(c));
  const options = chars.map((c) => [...new Set(readingsOf(c).map((r) => toneless(r)))]);
  const memo = new Map<string, number[] | null>();
  const go = (i: number, at: number): number[] | null => {
    if (i === chars.length) return at === letters.length ? [] : null;
    const key = `${i}|${at}`;
    if (memo.has(key)) return memo.get(key)!;
    let found: number[] | null = null;
    for (const r of options[i].sort((a, b) => b.length - a.length)) {
      if (plain.slice(at, at + r.length).join('') !== r) continue;
      const rest = go(i + 1, at + r.length);
      if (rest) {
        found = [r.length, ...rest];
        break;
      }
    }
    memo.set(key, found);
    return found;
  };
  const lengths = go(0, 0);
  if (!lengths) return null;
  let at = 0;
  return lengths.map((n) => {
    const s = letters.slice(at, at + n).join('');
    at += n;
    return s;
  });
}

/**
 * Every Han character of a dialogue point with its tones, deterministically from the point's own
 * pinyin: the syllables of `pinyin` lined up with the characters (pinyin-pro on the characters
 * when they don't line up), the 一 / 不 changes applied (`applyYiBuToneChanges`). Citation tone =
 * the written tone; for a syllable written unmarked (轻声 in this word), the character's own
 * reading with those letters (务 wù in 任务 rènwu; 了 le stays neutral); 一 yī, 不 bù. Spoken =
 * written, with third-tone sandhi inside each stretch of characters (你好 → ní hǎo; in a run of
 * 3rd tones every one but the last; a comma ends a stretch). Null when nothing lines up.
 */
export function wordCharTones(hanzi: string, pinyin: string): WordCharTone[] | null {
  const word = (hanzi ?? '').normalize('NFC').trim();
  const chars = hanCharsOf(word);
  if (chars.length === 0) return null;
  // Tone numbers ("bao3") are not the card standard: read the characters instead.
  const marked = !/[0-9]/.test(pinyin ?? '');
  let syllables = marked ? (alignByReadings(chars, pinyin ?? '') ?? pinyinSyllables(pinyin ?? '')) : null;
  if (!syllables || syllables.length !== chars.length) {
    if (chars.includes('儿')) return null; // erhua: 一点儿 yìdiǎnr has fewer syllables than characters
    try {
      syllables = pinyinPro(chars.join(''), { toneType: 'symbol', type: 'array' }) as string[];
    } catch {
      return null;
    }
    if (!syllables || syllables.length !== chars.length || syllables.some((s) => !/[a-zü]/i.test(s))) return null;
  }
  const changed = applyYiBuToneChanges(word, syllables.join(' ')).split(' ');
  if (changed.length === syllables.length) syllables = changed;
  const sylls = syllables;
  const written = sylls.map((s) => syllableTone(s) as ToneNumber);

  // Third-tone sandhi within each stretch of Han characters.
  const spoken = [...written];
  const runs: number[][] = [[]];
  let k = 0;
  for (const c of Array.from(word)) {
    if (/^\p{Script=Han}$/u.test(c)) runs[runs.length - 1].push(k++);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  for (const r of runs) {
    for (let j = 0; j < r.length - 1; j++) if (written[r[j]] === 3 && written[r[j + 1]] === 3) spoken[r[j]] = 2;
  }

  return chars.map((char, i) => {
    const w = sylls[i];
    let citation = w.normalize('NFC').toLowerCase();
    let citationTone = written[i];
    if (char === '一' && toneless(w) === 'yi') {
      citation = 'yī';
      citationTone = 1;
    } else if (char === '不' && toneless(w) === 'bu') {
      citation = 'bù';
      citationTone = 4;
    } else if (written[i] === 5) {
      const own = readingsOf(char).find((r) => toneless(r) === toneless(w));
      if (own) {
        citation = own.normalize('NFC').toLowerCase();
        citationTone = syllableTone(own) as ToneNumber;
      }
    }
    const said = spoken[i];
    let change: WordCharTone['change'];
    if (said !== citationTone) {
      if (said === 5) change = 'neutral';
      else if (char === '一' || char === '不') change = 'yi_bu';
      else if (written[i] === 3 && said === 2) change = 'third_tone';
    }
    const entry: WordCharTone = { char, index: i, citation, citationTone, written: w, spoken: said, readsAlone: readsAloneAs(char, citation) };
    if (change) entry.change = change;
    return entry;
  });
}

/** One piece of a tone line: Chinese for the teacher voice, English for the host. */
export interface ToneLinePart {
  lang: 'zh' | 'en';
  text: string;
  /** What the transcript shows instead ("打, dǎ,"). */
  display?: string;
}

export interface DialogueToneLine {
  parts: ToneLinePart[];
  /** The character a per-character line is about (absent on an "In 打扰了, …" line). */
  char?: string;
}

/** At most this many per-character lines per point (a long structure keeps its section short). */
export const DIALOGUE_TONE_MAX_CHARS = 4;
/** At most this many "In 打扰了, …" lines per point. */
export const DIALOGUE_TONE_MAX_CHANGES = 2;

function toneSentence(t: WordCharTone, next: WordCharTone | undefined): string {
  if (t.change === 'neutral') return 'is neutral tone here.';
  const said = `is said with a ${TONE_NAMES_EN[t.spoken]}`;
  if (t.change === 'third_tone') return `${said}, before another third tone.`;
  const nextTone = next ? (syllableTone(next.written) as ToneNumber) : 5;
  if (t.change === 'yi_bu' && nextTone !== 5) return `${said}, before a ${TONE_NAMES_EN[nextTone]}.`;
  return `${said}.`;
}

/**
 * The tone lines of one dialogue point, said right after the word (compileDialogueLesson):
 * - per distinct character, "打, third tone." — the character by the Chinese voice (shown "打, dǎ,
 *   third tone."); a character the voice would read differently on its own is said inside the word,
 *   "银行的行" (like the sleep lines); one already said earlier in the lesson (`said`, same syllable)
 *   is skipped, and at most `DIALOGUE_TONE_MAX_CHARS` per point;
 * - then where the word says one with another tone (at most `DIALOGUE_TONE_MAX_CHANGES`): "In 任务,
 *   务 is neutral tone here." / "In 你好, 你 is said with a second tone, before another third tone." /
 *   "In 一杯, 一 is said with a fourth tone, before a first tone." — a repeated character is named by
 *   place ("the second 姐"), one the voice would misread alone by position ("the second character").
 * `said` is updated with the characters spoken here. Empty when the pinyin can't be lined up.
 */
export function dialogueToneLines(point: { hanzi: string; pinyin: string }, said: Set<string> = new Set()): DialogueToneLine[] {
  const tones = wordCharTones(point.hanzi, point.pinyin);
  if (!tones) return [];
  const word = point.hanzi.trim();
  const chars = tones.map((t) => t.char);
  const lines: DialogueToneLine[] = [];
  const here = new Set<string>();
  for (const t of tones) {
    const key = `${t.char}|${toneless(t.citation)}`;
    if (here.has(key) || said.has(key)) continue;
    if (here.size >= DIALOGUE_TONE_MAX_CHARS) break;
    here.add(key);
    const inWord = chars.length > 1 && !t.readsAlone;
    lines.push({
      char: t.char,
      parts: [
        { lang: 'zh', text: inWord ? `${word}的${t.char}` : t.char, display: inWord ? `${t.char} (as in ${word}), ${t.citation},` : `${t.char}, ${t.citation},` },
        { lang: 'en', text: `${TONE_NAMES_EN[t.citationTone]}.` },
      ],
    });
  }
  for (const key of here) said.add(key);
  let changes = 0;
  tones.forEach((t, i) => {
    if (!t.change || changes >= DIALOGUE_TONE_MAX_CHANGES) return;
    changes++;
    const repeated = chars.filter((c) => c === t.char).length > 1;
    const nth = ORDINALS_EN[chars.slice(0, i).filter((c) => c === t.char).length] ?? 'next';
    const sentence = toneSentence(t, tones[i + 1]);
    const parts: ToneLinePart[] = [{ lang: 'en', text: 'In' }, { lang: 'zh', text: word, display: `${word},` }];
    if (!t.readsAlone) parts.push({ lang: 'en', text: `the ${ORDINALS_EN[i] ?? 'next'} character ${sentence}` });
    else {
      if (repeated) parts.push({ lang: 'en', text: `the ${nth}` });
      parts.push({ lang: 'zh', text: t.char }, { lang: 'en', text: sentence });
    }
    lines.push({ parts });
  });
  return lines;
}
