/**
 * "Order new cards by" (Settings → New cards): WHICH brand-new (primary, blue) words the
 * daily budget introduces first. The budget and the deck caps still decide HOW MANY
 * (budget.ts); bumps, one-off decks (0 + 0), opted-out words, the secondary (purple)
 * pool and one-off homework passes are untouched.
 *
 * The account's choice is four switches, applied as tiers in this order before the deck
 * queue decides (every candidate is the hanzi_to_meaning card of a never-studied note, in
 * any deck in scope, each deck within min(its unseen cards, what is left of its cap)):
 *
 *   1. new_characters_first — notes that bring a never-seen Han character (seen = the hanzi
 *      of every note with a reviewed card, novelty.ts). With "Most common first" on, ranked
 *      by how common their most common NEVER-SEEN character is (frequency.ts character rank,
 *      unlisted characters last) — the most useful new character first; then by never-seen
 *      characters counted up to NEW_CHARACTER_RANK_CAP (2), then by word frequency. Off:
 *      never-seen characters (capped) only.
 *   2. new_words_first — WORD notes (1–4 Han characters, no sentence punctuation:
 *      progress/known.ts `noteKind`) whose text appears in no studied note's hanzi,
 *      sentences included: 银行 is new even when 银 and 行 are known; a word already met
 *      inside a studied sentence is not.
 *   3. most_common_first — not a tier: inside each tier the most common first (frequency.ts:
 *      wordfreq rank, then rarest character; in the new-character tier first the most
 *      common NEW character), and in the deck fallback below, inside a deck.
 *   4. sentences_last — inside tier 1 words before sentences; after the tiers, every WORD
 *      note (all decks, deck queue order) before any sentence.
 *   5. then deck priority (queue order), as before: the rest deck by deck.
 *
 * Greedy, like novelty.ts: every pick counts as studied for the next (two words sharing one
 * new character aren't both front-loaded; a picked sentence makes the words inside it "met").
 * Ties: deck queue position, fewer Han characters, card id.
 *
 * Shared by the web (study-queue.ts → frontend/src/db/database.ts) and the Lab app
 * (android-lab/core NewCardOrder.kt, parity-tested through android-lab/parity).
 */
import { isHanCodePoint, MAX_WORD_CHARACTERS, noteKind } from '../progress/known';
import { characterRank, frequencyRank, frequencyRankOfText, type FrequencyIndex } from './frequency';
import { hanText, NEW_CHARACTER_RANK_CAP } from './novelty';

export interface NewCardOrder {
  new_characters_first: boolean;
  new_words_first: boolean;
  most_common_first: boolean;
  sentences_last: boolean;
}

export const NEW_CARD_ORDER_KEYS = ['new_characters_first', 'new_words_first', 'most_common_first', 'sentences_last'] as const;
export type NewCardOrderKey = (typeof NEW_CARD_ORDER_KEYS)[number];

export const DEFAULT_NEW_CARD_ORDER: Readonly<NewCardOrder> = Object.freeze({
  new_characters_first: true,
  new_words_first: true,
  most_common_first: true,
  sentences_last: true,
});

/** The settings rows, in order (web Settings and the Lab app show the same words). */
export const NEW_CARD_ORDER_OPTIONS: ReadonlyArray<{ key: NewCardOrderKey; label: string; hint: string }> = [
  { key: 'new_characters_first', label: 'New characters first', hint: 'Words that bring a character you have never studied come first.' },
  { key: 'new_words_first', label: 'New words first', hint: "Then words you haven't met anywhere yet — not even inside a sentence." },
  { key: 'most_common_first', label: 'Most common first', hint: 'Within each group, the words Chinese speakers use most come first, and the most common new characters before rare ones.' },
  { key: 'sentences_last', label: 'Sentences last', hint: 'Sentence cards wait until the words are in.' },
];

// ============ Settings ============

/** A change: true / false sets a switch, null = back to its default, a missing key leaves it. */
export type NewCardOrderUpdate = { [K in NewCardOrderKey]?: boolean | null };

/**
 * Validate a change from an untrusted body (`PUT /api/profile/new-card-order`): each key a
 * boolean or null; `{ reset: true }` = every default. Unknown keys are ignored.
 */
export function pickNewCardOrderUpdate(input: Record<string, unknown> | null | undefined): { update: NewCardOrderUpdate; problems: string[] } {
  const update: NewCardOrderUpdate = {};
  const problems: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { update, problems: ['Send the new-card order settings'] };
  if (input.reset === true) {
    for (const key of NEW_CARD_ORDER_KEYS) update[key] = null;
    return { update, problems };
  }
  for (const key of NEW_CARD_ORDER_KEYS) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v === undefined) continue;
    if (v === null || typeof v === 'boolean') update[key] = v;
    else problems.push(`${key} must be true, false or null`);
  }
  return { update, problems };
}

export function applyNewCardOrderUpdate(current: NewCardOrder, update: NewCardOrderUpdate): NewCardOrder {
  const next: NewCardOrder = { ...current };
  for (const key of NEW_CARD_ORDER_KEYS) {
    if (!(key in update)) continue;
    const v = update[key];
    next[key] = v === null || v === undefined ? DEFAULT_NEW_CARD_ORDER[key] : v;
  }
  return next;
}

/** Stored settings (a JSON string or object, maybe partial / garbage) → a full set. */
export function parseNewCardOrder(raw: unknown): NewCardOrder {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const out: NewCardOrder = { ...DEFAULT_NEW_CARD_ORDER };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  const src = obj as Record<string, unknown>;
  for (const key of NEW_CARD_ORDER_KEYS) if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  return out;
}

export function isDefaultNewCardOrder(o: NewCardOrder): boolean {
  return NEW_CARD_ORDER_KEYS.every(k => o[k] === DEFAULT_NEW_CARD_ORDER[k]);
}

/** What /api/auth/me and /api/sync/changes carry as `new_card_order`. */
export interface NewCardOrderInfo extends NewCardOrder {
  is_default: boolean;
}

export function newCardOrderInfo(o: NewCardOrder): NewCardOrderInfo {
  return { ...o, is_default: isDefaultNewCardOrder(o) };
}

// ============ What has been studied ============

/**
 * The characters and word-sized pieces of every studied note's hanzi: `chars` = every Han
 * character, `pieces` = every substring of 2–MAX_WORD_CHARACTERS characters inside one run
 * of Han characters (punctuation / spaces / Latin split runs). A word note is "met" when
 * its Han text is one of them (a one-character word: when the character is known).
 */
export interface StudiedIndex {
  chars: Set<string>;
  /** null = not tracked (only "New words first" needs them; building them costs). */
  pieces: Set<string> | null;
}

/** The runs of consecutive Han characters, each as its code points. */
export function hanRuns(text: string): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const ch of text) {
    if (isHanCodePoint(ch.codePointAt(0)!)) run.push(ch);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** The pieces a hanzi adds (2–4 characters inside a Han run), in order, with repeats. */
export function wordPieces(hanzi: string): string[] {
  const out: string[] = [];
  for (const run of hanRuns(hanzi)) {
    for (let i = 0; i < run.length; i++) {
      let piece = run[i];
      for (let len = 2; len <= MAX_WORD_CHARACTERS && i + len <= run.length; len++) {
        piece += run[i + len - 1];
        out.push(piece);
      }
    }
  }
  return out;
}

export function emptyStudied(withPieces = true): StudiedIndex {
  return { chars: new Set(), pieces: withPieces ? new Set() : null };
}

export function markStudied(studied: StudiedIndex, hanzi: string): void {
  const pieces = studied.pieces;
  let run: string[] = [];
  const endRun = () => {
    if (pieces) {
      for (let i = 0; i < run.length; i++) {
        let piece = run[i];
        for (let len = 2; len <= MAX_WORD_CHARACTERS && i + len <= run.length; len++) {
          piece += run[i + len - 1];
          pieces.add(piece);
        }
      }
    }
    run = [];
  };
  for (const ch of hanzi) {
    if (isHanCodePoint(ch.codePointAt(0)!)) {
      studied.chars.add(ch);
      run.push(ch);
    } else if (run.length) endRun();
  }
  if (run.length) endRun();
}

/** What the notes `hanzi` teach; `withPieces` false skips the word pieces (no "New words first"). */
export function studiedFrom(hanzi: Iterable<string>, withPieces = true): StudiedIndex {
  const studied = emptyStudied(withPieces);
  for (const h of hanzi) markStudied(studied, h);
  return studied;
}

/** A word note (noteKind) whose Han text was never met in a studied note (pieces untracked = none met). */
export function isNewWord(hanzi: string, studied: StudiedIndex): boolean {
  if (noteKind(hanzi) !== 'word') return false;
  const text = hanText(hanzi);
  return [...text].length === 1 ? !studied.chars.has(text) : !(studied.pieces?.has(text) ?? false);
}

// ============ Ordering ============

/** Tier of a candidate: 0 = brings a new character, 1 = a new word, 2 = a word (sentences last), -1 = none. */
const TIER_NONE = -1;

interface Entry<T> {
  item: T;
  hanzi: string;
  chars: string[];
  /** Each of `chars`' character frequency rank, looked up once (empty when not ranking by frequency). */
  charRanks: number[];
  text: string;
  length: number;
  word: boolean;
  sentence: boolean;
  freq: number;
  rank: number;
  group: string;
  key: string;
  newChars: number;
  newWord: boolean;
}

function tierOf<T>(e: Entry<T>, order: NewCardOrder): number {
  if (order.new_characters_first && e.newChars > 0) return 0;
  if (order.new_words_first && e.newWord) return 1;
  if (order.sentences_last && e.word) return 2;
  return TIER_NONE;
}

/**
 * A candidate's place in the pick order as of when it was (re)queued: its tier and, in tier 0,
 * the rank of its most common never-seen character and its never-seen characters (capped).
 * All only ever get worse as more is studied (the never-seen set only shrinks).
 */
interface Snapshot<T> {
  e: Entry<T>;
  tier: number;
  /** Tier 0: the smallest character rank among the never-seen characters (0 = not ranking). */
  newCharRank: number;
  newCapped: number;
}

const NO_RANKS: number[] = [];

function snapshotOf<T>(e: Entry<T>, order: NewCardOrder, studied: StudiedIndex): Snapshot<T> {
  const tier = tierOf(e, order);
  if (tier !== 0) return { e, tier, newCharRank: 0, newCapped: 0 };
  const newCapped = Math.min(e.newChars, NEW_CHARACTER_RANK_CAP);
  if (e.charRanks.length === 0) return { e, tier, newCharRank: 0, newCapped }; // not ranking by frequency
  let newCharRank = Infinity;
  for (let i = 0; i < e.chars.length; i++) {
    if (!studied.chars.has(e.chars[i]) && e.charRanks[i] < newCharRank) newCharRank = e.charRanks[i];
  }
  return { e, tier, newCharRank, newCapped };
}

/** < 0 when `x` comes before `y`. A total order (the card id breaks every tie). */
function compareSnapshots<T>(x: Snapshot<T>, y: Snapshot<T>, order: NewCardOrder): number {
  if (x.tier !== y.tier) return x.tier - y.tier;
  const a = x.e;
  const b = y.e;
  if (x.tier === 0) {
    if (order.sentences_last && a.sentence !== b.sentence) return a.sentence ? 1 : -1;
    // The most common new character first (all 0 when not ranking by frequency).
    if (x.newCharRank !== y.newCharRank) return x.newCharRank - y.newCharRank;
    if (x.newCapped !== y.newCapped) return y.newCapped - x.newCapped;
    if (order.most_common_first && a.freq !== b.freq) return a.freq - b.freq;
  } else if (x.tier === 1) {
    if (order.most_common_first && a.freq !== b.freq) return a.freq - b.freq;
  } else {
    // The words after the tiers: deck queue order first, the most common inside a deck.
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (order.most_common_first && a.freq !== b.freq) return a.freq - b.freq;
  }
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.length !== b.length) return a.length - b.length;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** A plain binary min-heap. */
class Heap<V> {
  private items: V[] = [];
  constructor(private readonly less: (a: V, b: V) => boolean) {}
  get size(): number { return this.items.length; }
  push(v: V): void {
    const a = this.items;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): V | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The global picks of "Order new cards by": up to `take` candidates (hanzi_to_meaning cards
 * of never-studied notes, any group = deck) that fall in a tier, best first, a group giving
 * at most `room.get(group)`. What is left is filled deck by deck (`orderWithinDeck`).
 * Greedy: each pick's characters and pieces count as studied for the next. Mutates `studied`.
 *
 * Fast for ~10k notes: a candidate's place only ever gets worse as more is studied (its
 * tier goes up, its never-seen characters down, its most common never-seen character gets
 * rarer), so the candidates sit in a heap under the
 * place they had when queued: the top is re-checked when popped and re-queued if it slipped
 * (it then comes out where it belongs), and a pick updates only the candidates sharing a new
 * character or whose text it makes "met" (indexed by character / text). Same picks as
 * re-scanning everything each time — the order is total.
 */
export function pickNewCardsByOrder<T>(
  candidates: readonly T[],
  take: number,
  hanziOf: (item: T) => string,
  groupOf: (item: T) => string,
  rank: (group: string) => number,
  room: ReadonlyMap<string, number>,
  tieKey: (item: T) => string,
  order: NewCardOrder,
  studied: StudiedIndex,
  frequency?: FrequencyIndex | null,
): T[] {
  if (take <= 0) return [];
  if (!order.new_characters_first && !order.new_words_first && !order.sentences_last) return [];
  const useFreq = order.most_common_first && !!frequency;
  const left = new Map(room);
  const heap = new Heap<Snapshot<T>>((a, b) => compareSnapshots(a, b, order) < 0);
  const byChar = new Map<string, Array<Entry<T>>>();
  const byText = new Map<string, Array<Entry<T>>>();
  // Character ranks, looked up once per character per build.
  const charRankCache = new Map<string, number>();
  const charRankOf = (ch: string): number => {
    let r = charRankCache.get(ch);
    if (r === undefined) { r = characterRank(ch, frequency!); charRankCache.set(ch, r); }
    return r;
  };
  for (const item of candidates) {
    const group = groupOf(item);
    if ((left.get(group) ?? 0) <= 0) continue;
    const hanzi = hanziOf(item);
    // One pass: the Han text, its distinct characters, its length.
    let text = '';
    let length = 0;
    const chars: string[] = [];
    const distinct = new Set<string>();
    for (const ch of hanzi) {
      if (!isHanCodePoint(ch.codePointAt(0)!)) continue;
      text += ch;
      length++;
      if (!distinct.has(ch)) { distinct.add(ch); chars.push(ch); }
    }
    const kind = noteKind(hanzi);
    let newChars = 0;
    for (const c of chars) if (!studied.chars.has(c)) newChars++;
    const word = kind === 'word';
    const e: Entry<T> = {
      item, hanzi, chars,
      charRanks: useFreq && newChars > 0 ? chars.map(charRankOf) : NO_RANKS,
      text, length, word,
      sentence: kind === 'sentence',
      freq: useFreq ? frequencyRankOfText(text, chars, frequency!) : 0,
      rank: rank(group),
      group,
      key: tieKey(item),
      newChars,
      newWord: order.new_words_first && word && (length === 1 ? !studied.chars.has(text) : !(studied.pieces?.has(text) ?? false)),
    };
    const snap = snapshotOf(e, order, studied);
    if (snap.tier === TIER_NONE) continue;
    heap.push(snap);
    if (newChars > 0) {
      for (const c of chars) {
        if (studied.chars.has(c)) continue;
        const list = byChar.get(c);
        if (list) list.push(e);
        else byChar.set(c, [e]);
      }
    }
    if (e.newWord) {
      const list = byText.get(text);
      if (list) list.push(e);
      else byText.set(text, [e]);
    }
  }

  const out: T[] = [];
  while (out.length < take && heap.size > 0) {
    const top = heap.pop()!;
    const picked = top.e;
    if ((left.get(picked.group) ?? 0) <= 0) continue; // its deck is full: never again
    const now = snapshotOf(picked, order, studied);
    if (now.tier === TIER_NONE) continue; // left every tier: the deck fallback has it
    if (now.tier !== top.tier || now.newCharRank !== top.newCharRank || now.newCapped !== top.newCapped) {
      heap.push(now); // slipped since it was queued
      continue;
    }
    out.push(picked.item);
    left.set(picked.group, (left.get(picked.group) ?? 0) - 1);
    // What the pick teaches: its new characters, and every word-sized piece of it.
    for (const c of picked.chars) {
      if (studied.chars.has(c)) continue;
      studied.chars.add(c);
      for (const e of byChar.get(c) ?? []) e.newChars--;
      for (const e of byText.get(c) ?? []) e.newWord = false;
    }
    if (studied.pieces) {
      for (const p of wordPieces(picked.hanzi)) {
        if (studied.pieces.has(p)) continue;
        studied.pieces.add(p);
        for (const e of byText.get(p) ?? []) e.newWord = false;
      }
    }
  }
  return out;
}

/**
 * The deck fallback: a deck's remaining hanzi_to_meaning cards (given in their existing
 * order) with "sentences last" (words, then sentences) and "most common first" applied
 * inside the deck. Stable: ties keep the existing order.
 */
export function orderWithinDeck<T>(
  items: readonly T[],
  hanziOf: (item: T) => string,
  order: NewCardOrder,
  frequency?: FrequencyIndex | null,
): T[] {
  const useFreq = order.most_common_first && !!frequency;
  if (!order.sentences_last && !useFreq) return [...items];
  const keyed = items.map(item => {
    const hanzi = hanziOf(item);
    return {
      item,
      sentence: order.sentences_last && noteKind(hanzi) === 'sentence' ? 1 : 0,
      freq: useFreq ? frequencyRank(hanzi, frequency!) : 0,
    };
  });
  keyed.sort((a, b) => a.sentence - b.sentence || a.freq - b.freq);
  return keyed.map(k => k.item);
}
