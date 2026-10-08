/**
 * Sleep lessons: one short line per character of each new word, tying it to words the
 * learner already has (docs/AUDIO_LESSONS.md "Each character"). Round 4 (Oct 2026), after
 * "the last one doesn't seem to explain all the characters".
 *
 * WHICH words a character is tied to is decided here, in code, from the learner's cards and
 * the word-frequency ranks — never by the model, so it can't invent a word or say he knows
 * one he doesn't (`pickCharLinks`). Per distinct character of the word, in order:
 * 1. `known` — 1–3 words he has REVIEWED (a learning or mature card) containing the character
 *    with the same reading, mature first, then the most frequent ("导，第三声。你学过‘导游’的‘导’。");
 * 2. `common` — else 1–2 frequent words (wordfreq rank ≤ COMMON_WORD_MAX_RANK) containing it
 *    with the same reading, which he should meet ("‘航’也在‘航空’里。");
 * 3. `other_reading` — else words he has reviewed where the character is read differently;
 * 4. `new` — else, when no reviewed card of his contains it at all: "‘驶’是一个新字，你以前没见过。";
 * 5. `none` — he has met it only in a sentence card: nothing more is said.
 * The taught word itself is never offered. The agent phrases each line (`char_notes`), and
 * `charNoteProblems` checks it names only the words given here, and claims nothing he hasn't
 * learned. Pure.
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import { pinyinSyllables, toneless } from '../pinyin/toneChange';
import { hanCharsOf } from './tones';
import type { SleepCharNote } from './types';

export type CharLinkKind = 'known' | 'common' | 'other_reading' | 'new' | 'none';

export interface CharLinkWord {
  hanzi: string;
  pinyin: string;
  english: string;
}

/** What may be said about one character of a word. */
export interface CharLink {
  char: string;
  kind: CharLinkKind;
  /** The words to name (empty for `new` / `none`), best first. */
  words: CharLinkWord[];
}

/** A word of the learner's (a note) containing the character. tier: 2 = mature, 1 = reviewed, 0 = never studied. */
export interface LearnerCharWord {
  hanzi: string;
  pinyin: string;
  english: string;
  tier: number;
  /** wordfreq rank when known (1 = most frequent). */
  rank?: number | null;
}

/** A dictionary word containing the character (the character dictionary's frequent words). */
export interface CommonCharWord {
  hanzi: string;
  pinyin: string;
  english: string;
  /** One syllable per character, when the dictionary has them. */
  syllables?: string[] | null;
  /** wordfreq rank (1 = most frequent); null / missing = not ranked → never "common". */
  rank: number | null;
}

export const CHAR_LINK_LIMITS = {
  /** Known words offered per character. */
  known: 3,
  /** Common words offered per character. */
  common: 2,
  otherReading: 2,
  /** "Common" = within the top this many words of the wordfreq list (roughly HSK 1–5). */
  commonMaxRank: 5000,
  /** One character's line (characters). */
  maxNoteChars: 40,
} as const;

/** Toneless syllable per Han character of `hanzi` (from its pinyin when they line up, else pinyin-pro), or null. */
export function charReadings(hanzi: string, pinyin?: string | null): Array<string | null> {
  const chars = hanCharsOf(hanzi);
  if (chars.length === 0) return [];
  const fromPinyin = pinyin ? pinyinSyllables(pinyin.replace(/[^\p{L}\s']/gu, ' ').trim()) : null;
  if (fromPinyin && fromPinyin.length === chars.length) return fromPinyin.map((s) => toneless(s));
  try {
    const guess = pinyinPro(chars.join(''), { type: 'array', toneType: 'none' }) as string[];
    if (guess.length === chars.length) return guess.map((s) => (/[a-zü]/i.test(s) ? s.toLowerCase().replace(/v/g, 'ü') : null));
  } catch {
    // fall through
  }
  return chars.map(() => null);
}

/** Does `word` read `char` as `reading` somewhere? Unknown readings count as a match. */
function readsAs(word: { hanzi: string; pinyin?: string | null; syllables?: string[] | null }, char: string, reading: string | null): boolean {
  if (!reading) return true;
  const chars = hanCharsOf(word.hanzi);
  const readings =
    word.syllables && word.syllables.length === chars.length ? word.syllables.map((s) => toneless(s)) : charReadings(word.hanzi, word.pinyin);
  let any = false;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== char) continue;
    const r = readings[i];
    if (!r || r === reading) return true;
    any = true;
  }
  return !any;
}

const byRank = (a: { rank?: number | null }, b: { rank?: number | null }) => (a.rank ?? Infinity) - (b.rank ?? Infinity);

function toLinkWord(w: { hanzi: string; pinyin: string; english: string }): CharLinkWord {
  return { hanzi: w.hanzi, pinyin: w.pinyin, english: w.english };
}

/**
 * What may be said about each distinct character of `word` (in order of first appearance).
 * `learnerWords(c)`: the learner's words containing c (any tier); `commonWords(c)`: dictionary
 * words containing c with their ranks; `metChars`: every character of a note he has reviewed
 * (words AND sentences) — "new" is only said of a character outside it.
 */
export function pickCharLinks(args: {
  word: string;
  pinyin?: string | null;
  learnerWords: (char: string) => readonly LearnerCharWord[];
  commonWords: (char: string) => readonly CommonCharWord[];
  metChars: ReadonlySet<string>;
}): CharLink[] {
  const word = args.word.trim();
  const chars = hanCharsOf(word);
  const readings = charReadings(word, args.pinyin);
  const out: CharLink[] = [];
  chars.forEach((char, k) => {
    if (out.some((l) => l.char === char)) return; // 姐姐: once
    const reading = readings[k] ?? null;
    const notSelf = (w: { hanzi: string }) => w.hanzi.trim() !== word;
    const reviewed = args.learnerWords(char).filter((w) => w.tier >= 1 && notSelf(w) && hanCharsOf(w.hanzi).includes(char));
    const same = reviewed.filter((w) => readsAs(w, char, reading));
    if (same.length) {
      const best = [...same].sort(
        (a, b) => b.tier - a.tier || byRank(a, b) || Math.abs([...a.hanzi].length - 2) - Math.abs([...b.hanzi].length - 2) || (a.hanzi < b.hanzi ? -1 : a.hanzi > b.hanzi ? 1 : 0),
      );
      out.push({ char, kind: 'known', words: dedupe(best).slice(0, CHAR_LINK_LIMITS.known).map(toLinkWord) });
      return;
    }
    const common = args
      .commonWords(char)
      .filter((w) => w.rank != null && w.rank <= CHAR_LINK_LIMITS.commonMaxRank && notSelf(w) && hanCharsOf(w.hanzi).length >= 2 && hanCharsOf(w.hanzi).includes(char) && readsAs(w, char, reading));
    if (common.length) {
      out.push({ char, kind: 'common', words: dedupe([...common].sort(byRank)).slice(0, CHAR_LINK_LIMITS.common).map(toLinkWord) });
      return;
    }
    if (reviewed.length) {
      const best = [...reviewed].sort((a, b) => b.tier - a.tier || byRank(a, b));
      out.push({ char, kind: 'other_reading', words: dedupe(best).slice(0, CHAR_LINK_LIMITS.otherReading).map(toLinkWord) });
      return;
    }
    out.push({ char, kind: args.metChars.has(char) ? 'none' : 'new', words: [] });
  });
  return out;
}

function dedupe<T extends { hanzi: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((w) => (seen.has(w.hanzi) ? false : (seen.add(w.hanzi), true)));
}

/** The plain line a link gives when nobody phrases it (the E2E fake model; an example for the prompt). */
export function defaultCharNote(link: CharLink): SleepCharNote {
  const c = link.char;
  const names = link.words.map((w) => w.hanzi);
  switch (link.kind) {
    case 'known':
      return {
        char: c,
        words: names,
        zh: names.length === 1 ? (names[0] === c ? `你学过‘${c}’这个字。` : `你学过‘${names[0]}’的‘${c}’。`) : `你学过${names.map((n) => `‘${n}’`).join('和')}，里面都有‘${c}’。`,
      };
    case 'common':
      return { char: c, words: names, zh: `‘${c}’也在${names.map((n) => `‘${n}’`).join('和')}里。` };
    case 'other_reading':
      return { char: c, words: names.slice(0, 1), zh: `你在‘${names[0]}’里见过‘${c}’，这里读音不一样。` };
    case 'new':
      return { char: c, words: [], zh: '', kind: 'new' };
    default:
      return { char: c, words: [], zh: '' };
  }
}

/** The facts, as the agent sees them in check_known_words and in a refusal. */
export function describeCharLink(link: CharLink): string {
  const list = link.words.map((w) => `${w.hanzi} (${w.pinyin}, ${w.english})`).join('; ');
  switch (link.kind) {
    case 'known':
      return `${link.char}: he has LEARNED ${list} — name 1–${Math.min(3, link.words.length)} of these ("你学过‘${link.words[0]?.hanzi}’的‘${link.char}’。")`;
    case 'common':
      return `${link.char}: he hasn't learned a word with it; common words: ${list} — name 1–${Math.min(2, link.words.length)} of these with a very short simple gloss, never "学过" ("‘${link.char}’也在‘${link.words[0]?.hanzi}’里。")`;
    case 'other_reading':
      return `${link.char}: he has seen it only read differently, in ${list} — name 1–${Math.min(2, link.words.length)} and say it is read differently here`;
    case 'new':
      return `${link.char}: a NEW character he has never met — zh "" and words []: the app says it is new`;
    default:
      return `${link.char}: nothing to add — zh "" and words []`;
  }
}

/** Words in quotes inside a line (‘导游’, “导游”, '导游', 「导游」). */
export function quotedTerms(text: string): string[] {
  return [...text.matchAll(/[‘'“"「『]([^‘’'“”"「」『』]+)[’'”"」』]/gu)].map((m) => m[1].trim()).filter(Boolean);
}

/** Saying he learned / knows something. "没见过" (never seen) is not a claim. */
const CLAIMS_LEARNED = /(?<!没)学过|认识|你知道|(?<!没)见过/u;

/**
 * Problems with a word's `char_notes`. With `links` (the worker's facts for this word) the list is
 * required and every named word must be one of the facts; without, only its shape is checked
 * (plans checked outside the worker).
 */
export function charNoteProblems(where: string, word: { hanzi?: unknown; char_notes?: unknown; characters_zh?: unknown }, links?: CharLink[] | null): string[] {
  const problems: string[] = [];
  const hanzi = typeof word.hanzi === 'string' ? word.hanzi.trim() : '';
  const field = `${where}.char_notes`;
  if (word.char_notes === undefined || word.char_notes === null) {
    if (links && links.length) {
      problems.push(`${field}: required — one entry per character of "${hanzi}", in order: { char, words, zh }. The facts: ${links.map(describeCharLink).join(' | ')}`);
    }
    return problems;
  }
  if (!Array.isArray(word.char_notes)) return [`${field}: a list of { char, words, zh }`];
  const notes = word.char_notes as unknown[];
  const distinct = [...new Set(hanCharsOf(hanzi))];
  if (notes.length !== distinct.length) {
    problems.push(`${field}: one entry per distinct character of "${hanzi}", in order — ${distinct.length} expected (${distinct.join(' ')}), got ${notes.length}`);
  }
  if (Array.isArray(word.characters_zh) && word.characters_zh.length > 0) {
    problems.push(`${where}.characters_zh: leave it empty ([]) — the characters are explained in char_notes now`);
  }
  notes.forEach((raw, k) => {
    const at = `${field}[${k}]`;
    if (!raw || typeof raw !== 'object') {
      problems.push(`${at}: { char, words, zh } required`);
      return;
    }
    const n = raw as Record<string, unknown>;
    const char = distinct[k];
    if (char !== undefined && n.char !== char) {
      problems.push(`${at}.char: expected "${char}" (the distinct characters of "${hanzi}", in order)`);
      return;
    }
    const link = links?.find((l) => l.char === n.char) ?? null;
    const words = Array.isArray(n.words) ? n.words.filter((w): w is string => typeof w === 'string').map((w) => w.trim()) : null;
    if (!words) {
      problems.push(`${at}.words: a list of the words this line names (may be empty)`);
      return;
    }
    const zh = typeof n.zh === 'string' ? n.zh.trim() : null;
    if (zh === null) {
      problems.push(`${at}.zh: the spoken line (Chinese; "" for a new character)`);
      return;
    }
    const facts = link ? ` The facts: ${describeCharLink(link)}` : '';
    if (link?.kind === 'none') {
      if (zh || words.length) problems.push(`${at}: nothing to say for "${link.char}" — zh "" and words []`);
      return;
    }
    if (link?.kind === 'new') {
      // The app says "a new character" itself (phrases.ts); whatever zh says is replaced.
      if (words.length) problems.push(`${at}.words: "${link.char}" is a new character for him — words [] (and zh "": the app says it is new).${facts}`);
      return;
    }
    if (!zh) {
      if (!link && words.length === 0) return; // a new character (the worker knows which)
      problems.push(`${at}.zh: required — one short Chinese line about "${String(n.char)}".${facts}`);
      return;
    }
    if (/[A-Za-z]/.test(zh)) problems.push(`${at}.zh: Chinese only — no English or pinyin`);
    if ([...zh].length > CHAR_LINK_LIMITS.maxNoteChars) problems.push(`${at}.zh: too long (${[...zh].length} characters, at most ${CHAR_LINK_LIMITS.maxNoteChars}) — one or two very short sentences`);
    if (typeof n.char === 'string' && !zh.includes(n.char)) problems.push(`${at}.zh: say the character "${n.char}" in it`);
    for (const w of words) if (!zh.includes(w)) problems.push(`${at}: "${w}" is in words but not said in zh`);
    if (!link) return;
    const allowed = new Set(link.words.map((w) => w.hanzi));
    const named = words.filter((w) => w !== hanzi && (w !== link.char || allowed.has(w)));
    const strangers = named.filter((w) => !allowed.has(w));
    if (strangers.length) problems.push(`${at}.words: ${strangers.map((w) => `"${w}"`).join(', ')} not among the words given for "${link.char}".${facts}`);
    const quotedStrangers = quotedTerms(zh).filter((t) => t !== link.char && t !== hanzi && !allowed.has(t));
    if (quotedStrangers.length) problems.push(`${at}.zh: names ${quotedStrangers.map((t) => `‘${t}’`).join(', ')} — only "${link.char}", "${hanzi}" and the words given may be named.${facts}`);
    const max = link.kind === 'known' ? CHAR_LINK_LIMITS.known : link.kind === 'common' ? CHAR_LINK_LIMITS.common : link.kind === 'other_reading' ? CHAR_LINK_LIMITS.otherReading : 0;
    if (named.length === 0) problems.push(`${at}.words: name at least one of the words given.${facts}`);
    else if (named.length > max) problems.push(`${at}.words: at most ${max}.${facts}`);
    if (/新字|没见过/.test(zh)) problems.push(`${at}.zh: "${link.char}" is not new to him — don't say 新字 / 没见过.${facts}`);
    if (link.kind === 'common' && CLAIMS_LEARNED.test(zh)) problems.push(`${at}.zh: he hasn't learned these words — don't say 学过 / 认识 / 见过 / 你知道; just name them ("‘${link.char}’也在‘${link.words[0]?.hanzi}’里。").${facts}`);
  });
  return problems;
}

/**
 * After a plan passed `charNoteProblems` with the worker's facts: each note gets the fact's kind
 * (never the model's own), a new character's zh is cleared (the compiler says it, phrases.ts),
 * and a "none" note is emptied. Returns a copy.
 */
export function stampCharNotes<P extends { words: Array<{ hanzi: string; char_notes?: SleepCharNote[] }> }>(plan: P, links: Record<string, CharLink[]>): P {
  const copy = JSON.parse(JSON.stringify(plan)) as P;
  for (const w of copy.words) {
    if (!Array.isArray(w.char_notes)) continue;
    const forWord = links[w.hanzi.trim()] ?? [];
    w.char_notes = w.char_notes.map((n) => {
      const link = forWord.find((l) => l.char === n.char);
      const note: SleepCharNote = { char: n.char, words: Array.isArray(n.words) ? n.words : [], zh: typeof n.zh === 'string' ? n.zh : '' };
      if (!link) return note;
      note.kind = link.kind;
      if (link.kind === 'new' || link.kind === 'none') {
        note.zh = '';
        note.words = [];
      }
      return note;
    });
  }
  return copy;
}
