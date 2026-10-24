/**
 * 🎬 Karaoke captions (docs/CLIPS.md "Karaoke captions"): while a voice line plays, its caption
 * shows big with the CURRENT word exaggerated (bigger, heavier, underlined, a little bounce),
 * the words already said dimmed and the next ones plain — TikTok style.
 *
 * Timing is ESTIMATED (practice TTS gives no word timestamps): the line is cut into words — for
 * Chinese the device segmenter's words (shared/chinese/segment.ts; each app passes its own
 * segmentation, which is parity-tested), else one word per character; for English by spaces — and
 * the clip's REAL audio duration (known once it has loaded) is shared out by syllables (a Han
 * character = 1, a Latin word by its vowel groups, a digit = 1), with a short pause at a comma
 * and a longer one at a full stop, after a small lead-in and before a small tail of silence.
 *
 * Pure; the Lab port is core `clips/Karaoke.kt`, parity-tested (parity/fixtures/clips.ts).
 */

export type KaraokeKind = 'word' | 'punct' | 'space';

export interface KaraokePiece {
  text: string;
  kind: KaraokeKind;
  /** Syllables (a word) or a pause in syllable units (punctuation). */
  weight: number;
}

export interface KaraokeToken extends KaraokePiece {
  start_ms: number;
  end_ms: number;
}

/** Silence TTS leaves before the first word and after the last (scaled down for very short clips). */
export const KARAOKE_LEAD_MS = 120;
export const KARAOKE_TAIL_MS = 220;
/** The pause at ，、；： , ; : (in syllables). */
export const KARAOKE_SHORT_PAUSE = 0.5;
/** The pause at 。！？ . ! ? … (in syllables). */
export const KARAOKE_LONG_PAUSE = 0.9;

const HAN = /\p{Script=Han}/u;
const HAN_G = /\p{Script=Han}/gu;
const SHORT_PAUSE = /[，、；：,;:]/;
const LONG_PAUSE = /[。！？.!?…]/;
/** A run of vowels (pinyin tone marks, ü included) = one syllable of a Latin word. */
const VOWEL_RUN = /[aeiouyAEIOUYāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ]+/g;
const DIGIT_G = /[0-9]/g;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** One Latin word / number (letters, digits, apostrophes, hyphens, tone-marked vowels). */
const LATIN_WORD = /[\p{L}\p{N}'’-]/u;

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

/** A word's syllables: Han characters + Latin vowel groups + digits (at least 1). */
export function karaokeSyllables(word: string): number {
  const han = (word.match(HAN_G) ?? []).length;
  const latin = word.replace(HAN_G, ' ');
  let vowels = 0;
  for (const part of latin.split(/\s+/)) {
    if (!part) continue;
    const groups = (part.match(VOWEL_RUN) ?? []).length;
    const digits = (part.match(DIGIT_G) ?? []).length;
    const letters = /[\p{L}]/u.test(part.replace(/[0-9]/g, ''));
    vowels += digits + (letters ? Math.max(1, groups) : 0);
  }
  return Math.max(1, han + vowels);
}

function pauseOf(text: string): number {
  if (LONG_PAUSE.test(text)) return KARAOKE_LONG_PAUSE;
  if (SHORT_PAUSE.test(text)) return KARAOKE_SHORT_PAUSE;
  return 0;
}

function piece(text: string): KaraokePiece {
  if ([...text].every(isSpace)) return { text, kind: 'space', weight: 0 };
  if (HAN.test(text) || LETTER_OR_DIGIT.test(text)) return { text, kind: 'word', weight: karaokeSyllables(text) };
  return { text, kind: 'punct', weight: pauseOf(text) };
}

/** Split into pieces without a segmentation: one word per Han character, Latin words by letters, the rest punctuation / spaces. */
function fallbackPieces(text: string): KaraokePiece[] {
  const out: KaraokePiece[] = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (HAN.test(ch)) {
      out.push(piece(ch));
      i++;
    } else if (LATIN_WORD.test(ch)) {
      let j = i;
      while (j < chars.length && LATIN_WORD.test(chars[j]) && !HAN.test(chars[j])) j++;
      out.push(piece(chars.slice(i, j).join('')));
      i = j;
    } else if (isSpace(ch)) {
      let j = i;
      while (j < chars.length && isSpace(chars[j])) j++;
      out.push(piece(chars.slice(i, j).join('')));
      i = j;
    } else {
      out.push(piece(ch));
      i++;
    }
  }
  return out;
}

/**
 * The line's pieces. `words` = a segmentation of `text` (the segmenter's word texts, which must
 * concatenate to `text` exactly) — used for Chinese; null / not matching → the fallback split.
 * A segment that mixes a word with punctuation (rare) stays one word.
 */
export function karaokePieces(text: string, lang: 'zh' | 'en', words?: readonly string[] | null): KaraokePiece[] {
  if (lang === 'zh' && words && words.length && words.join('') === text) {
    const out: KaraokePiece[] = [];
    for (const w of words) {
      if (!w) continue;
      const p = piece(w);
      // A segment of Latin + spaces ("i 人" is rare): keep it whole.
      out.push(p);
    }
    return out;
  }
  return fallbackPieces(text);
}

/**
 * The timeline of a line spoken over `durationMs`: each piece's start / end. Punctuation before the
 * first word or after the last weighs nothing (that is the lead-in / tail).
 */
export function karaokeTimeline(text: string, lang: 'zh' | 'en', durationMs: number, words?: readonly string[] | null): KaraokeToken[] {
  const pieces = karaokePieces(text, lang, words);
  const first = pieces.findIndex((p) => p.kind === 'word');
  let last = -1;
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i].kind === 'word') {
      last = i;
      break;
    }
  }
  const weights = pieces.map((p, i) => (p.kind === 'punct' && (i < first || i > last) ? 0 : p.weight));
  const total = weights.reduce((s, w) => s + w, 0);
  const duration = Math.max(0, durationMs);
  // Very short clips: the lead / tail shrink with them (never more than a quarter of the clip).
  const lead = Math.min(KARAOKE_LEAD_MS, duration / 4);
  const tail = Math.min(KARAOKE_TAIL_MS, duration / 4);
  const span = Math.max(0, duration - lead - tail);
  let acc = 0;
  return pieces.map((p, i) => {
    const start = total > 0 ? lead + (acc / total) * span : lead;
    acc += weights[i];
    const end = total > 0 ? lead + (acc / total) * span : lead;
    return { ...p, weight: weights[i], start_ms: Math.round(start), end_ms: Math.round(end) };
  });
}

/** The word being said at `positionMs`: the last word token that has started (-1 before the first). */
export function karaokeActive(timeline: readonly KaraokeToken[], positionMs: number): number {
  let at = -1;
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    if (t.kind !== 'word') continue;
    if (t.start_ms <= positionMs) at = i;
    else break;
  }
  return at;
}

export type KaraokeState = 'past' | 'active' | 'next';

/** Per token: said (dimmed), being said (exaggerated) or still to come. Punctuation follows the word before it. */
export function karaokeStates(timeline: readonly KaraokeToken[], active: number): KaraokeState[] {
  return timeline.map((_, i) => (active < 0 ? 'next' : i < active ? 'past' : i === active ? 'active' : 'next'));
}
