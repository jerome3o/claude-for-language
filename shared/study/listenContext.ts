/**
 * "Listen in context" — the QUESTION side of a listening card (audio → hanzi;
 * docs/STUDY_SESSION.md "Listen in context").
 *
 * Jerome: "show all the example sentences so I can play them, and at the very
 * bottom play the individual word … ideally I listen to the sentences before the
 * word." So the question shows the note's sentences — the card's own sentence
 * first, then the generated set — as AUDIO-ONLY rows (▶, a number, ✓ once
 * played; the Chinese, pinyin and English stay hidden, an EN tap shows only the
 * English), then "▶ The word". Tapping the word before any sentence asks once:
 * "Try the sentences first?" — [Play the word anyway] [Play a sentence].
 *
 * Contrived set rows (written around a look-alike / homophone, `isContrivedSentence` in sentenceFocus.ts)
 * come after the natural ones and never count toward the top-up's "enough sentences".
 *
 * Fresh every showing (Jerome, Nov 2026: "I'm just memorising the sentence as a clue to the word … new
 * sentences, new things, as much as possible"): each showing offers LISTEN_CONTEXT_SHOWN sentences picked by
 * `pickListenRows` — never heard in context first, then the least heard / longest ago, simple ones before
 * long ones among equals, never the same set twice in a row — in an order shuffled afresh every showing
 * (seeded per showing: stable while the card is up). Every sentence played is recorded once per showing
 * (a `heard` event, sentenceHistory.ts), and when a showing leaves fewer than LISTEN_CONTEXT_FRESH_LOW unheard
 * sentences the word asks the sentence top-up for more (`listenTopUpWant`).
 *
 * Pure rules, shared by the web (`components/study/ListenContext.tsx`) and the
 * Lab app (`core/…/ListenContext.kt`, parity-tested by
 * android-lab/parity/fixtures/listen-context.ts).
 */
import { isContrivedSentence } from './sentenceFocus';
import {
  SENTENCE_TOPUP_MAX,
  SENTENCE_TOPUP_MIN,
  sentenceHistoryKey,
  type SentenceStats,
} from './sentenceHistory';
import { isSimpleSentence } from './sentenceSimplicity';

/** Fewer sentences than this (card sentence + set) → the background top-up asks for more. */
export const LISTEN_CONTEXT_MIN_SENTENCES = 5;
/** "+ More sentences" aims for about this many in total. */
export const LISTEN_CONTEXT_MORE_TARGET = 8;
/** The generate endpoint's own bounds (`clampSentenceCount`: 3–10). */
export const SENTENCE_GENERATE_MIN = 3;
export const SENTENCE_GENERATE_MAX = 10;

export interface ListenClueInput {
  hanzi?: string | null;
  translation?: string | null;
  audio_url?: string | null;
}

export interface ListenSentenceInput {
  id: string;
  hanzi: string;
  translation?: string | null;
  audio_url?: string | null;
  position?: number | null;
  /** The set row's focus (a contrived one comes last and isn't counted, sentenceFocus.ts). */
  focus?: string | null;
}

/** One row of the list. The hanzi is carried for the device voice — NEVER shown on the question. */
export interface ListenRow {
  /** Set-row id, or `clue:<noteId>` for the card's own sentence. */
  key: string;
  /** null for the card's own sentence (it lives on the note). */
  sentenceId: string | null;
  hanzi: string;
  translation: string | null;
  audioUrl: string | null;
  fromCard: boolean;
  /** A set row written around a look-alike / homophone (`isContrivedSentence`): listed last, never counted. */
  contrived: boolean;
}

/** The key of the card's own sentence row (the card-back list uses the same one). */
export function clueRowKey(noteId: string): string {
  return `clue:${noteId}`;
}

/**
 * The rows in order: the card's own sentence first (unless the set already
 * holds the same sentence — it is then shown once, as the set row), then the
 * set by position, its natural sentences before the contrived ones. Same
 * order as the card-back SentenceSet.
 */
export function listenContextRows(
  noteId: string,
  clue: ListenClueInput | null | undefined,
  sentences: readonly ListenSentenceInput[],
): ListenRow[] {
  const rows: ListenRow[] = [];
  const clueHanzi = clue?.hanzi?.trim() ? clue.hanzi : null;
  if (clueHanzi && !sentences.some((s) => s.hanzi === clueHanzi)) {
    rows.push({
      key: clueRowKey(noteId),
      sentenceId: null,
      hanzi: clueHanzi,
      translation: clue?.translation?.trim() || null,
      audioUrl: clue?.audio_url || null,
      fromCard: true,
      contrived: false,
    });
  }
  const sorted = sentences
    .map((s, i) => ({ s, i }))
    .sort((a, b) =>
      Number(isContrivedSentence(a.s.focus)) - Number(isContrivedSentence(b.s.focus))
      || (a.s.position ?? a.i) - (b.s.position ?? b.i) || a.i - b.i)
    .map(({ s }) => s);
  for (const s of sorted) {
    rows.push({
      key: s.id,
      sentenceId: s.id,
      hanzi: s.hanzi,
      translation: s.translation?.trim() || null,
      audioUrl: s.audio_url || null,
      fromCard: false,
      contrived: isContrivedSentence(s.focus),
    });
  }
  return rows;
}

/**
 * What ▶ on a row can do:
 * - `ready`: its clip plays (online, or cached on the device);
 * - `fetch`: a set row with no clip yet, online — ensure-audio ("Audio coming…");
 * - `device`: the card's own sentence with no clip yet, online — the device voice
 *   (the card's auto-audio is already making the real one);
 * - `unavailable`: offline and the clip isn't on the device (or there is none).
 */
export type ListenRowState = 'ready' | 'fetch' | 'device' | 'unavailable';

export function listenRowState(
  row: Pick<ListenRow, 'audioUrl' | 'sentenceId'>,
  opts: { online: boolean; cached: boolean },
): ListenRowState {
  if (row.audioUrl) return opts.online || opts.cached ? 'ready' : 'unavailable';
  if (!opts.online) return 'unavailable';
  return row.sentenceId ? 'fetch' : 'device';
}

export function isPlayableRow(state: ListenRowState): boolean {
  return state !== 'unavailable';
}

/**
 * Auto-play on a listening card (the Auto behaviour — the card used to read the
 * word as it showed): the FIRST sentence whose clip is ready, else the word.
 * `none` when auto-play is off.
 */
export type ListenAutoplay = { kind: 'sentence'; index: number } | { kind: 'word' } | { kind: 'none' };

export function listenAutoplay(autoplay: boolean, states: readonly ListenRowState[]): ListenAutoplay {
  if (!autoplay) return { kind: 'none' };
  const index = states.indexOf('ready');
  return index >= 0 ? { kind: 'sentence', index } : { kind: 'word' };
}

/**
 * "▶ The word": play it, or first ask "Try the sentences first?". It asks only
 * while no sentence has been played on this card, there is a sentence that can
 * be played, and he hasn't already chosen "Play the word anyway" on this card.
 */
export function wordTapAction(opts: {
  sentencesPlayed: number;
  playableSentences: number;
  playedWordAnyway: boolean;
}): 'play' | 'prompt' {
  if (opts.sentencesPlayed > 0 || opts.playableSentences === 0 || opts.playedWordAnyway) return 'play';
  return 'prompt';
}

/** The rows the top-ups count: the natural ones (contrived rows never make "enough sentences"). */
export function listenNaturalCount(rows: readonly Pick<ListenRow, 'contrived'>[]): number {
  return rows.filter((r) => !r.contrived).length;
}

/** The background top-up: fewer than LISTEN_CONTEXT_MIN_SENTENCES natural sentences in total (`listenNaturalCount`). */
export function needsSentenceTopUp(total: number): boolean {
  return total < LISTEN_CONTEXT_MIN_SENTENCES;
}

/** How many a top-up asks for: enough to reach the minimum, within the endpoint's bounds. */
export function topUpCount(total: number): number {
  return clampCount(LISTEN_CONTEXT_MIN_SENTENCES - total);
}

/** "+ More sentences": enough to reach about LISTEN_CONTEXT_MORE_TARGET, at least the endpoint's minimum. */
export function moreSentencesCount(total: number): number {
  return clampCount(LISTEN_CONTEXT_MORE_TARGET - total);
}

function clampCount(n: number): number {
  return Math.min(SENTENCE_GENERATE_MAX, Math.max(SENTENCE_GENERATE_MIN, Math.round(n)));
}

// --- Fresh sentences every showing --------------------------------------------------------------

/** How many sentences one showing offers. */
export const LISTEN_CONTEXT_SHOWN = 4;
/** A showing that leaves fewer unheard sentences than this (besides the ones it shows) asks for more. */
export const LISTEN_CONTEXT_FRESH_LOW = 4;
/** …enough to get back to about this many unheard. */
export const LISTEN_CONTEXT_FRESH_BUFFER = 8;

/** FNV-1a (32-bit) over the UTF-16 code units — the same number in the Lab port. */
export function listenHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 over a 32-bit seed: unsigned 32-bit integers (no floats, so both apps agree exactly). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** The items in a seeded random order (Fisher–Yates). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const next = prng(listenHash(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export interface ListenPick {
  /** The rows of this showing, in their shuffled order. */
  rows: ListenRow[];
  /** Of them, never heard in context before. */
  fresh: number;
  /** Of them, heard before. */
  heardBefore: number;
  /** Natural, visible sentences never heard in context that this showing leaves for later. */
  unheardLeft: number;
}

/**
 * The sentences of one showing:
 * 1. candidates = the natural sentences not hidden (contrived / hidden ones never come — contrived ones only
 *    when there is nothing else);
 * 2. ranked: never heard in context first, then fewest times heard; among equals simple before long
 *    (`isSimpleSentence` for this word), then heard longest ago, then a seeded tie-break (variety);
 * 3. the first `count`; when that is exactly the previous showing's set and there are more candidates,
 *    the last one is swapped for the next best — never the same set twice in a row;
 * 4. shuffled with the showing's seed: a new order every showing, the same while the card is up.
 */
export function pickListenRows(
  rows: readonly ListenRow[],
  stats: ReadonlyMap<string, SentenceStats>,
  opts: { seed: string; word?: string | null; previous?: readonly string[] | null; count?: number },
): ListenPick {
  const count = Math.max(0, opts.count ?? LISTEN_CONTEXT_SHOWN);
  const statOf = (r: ListenRow) => stats.get(sentenceHistoryKey(r.key));
  const visible = rows.filter((r) => !statOf(r)?.hidden);
  const natural = visible.filter((r) => !r.contrived);
  const candidates = natural.length > 0 ? natural : visible;
  const heardCount = (r: ListenRow) => statOf(r)?.heard?.count ?? 0;
  const ranked = candidates
    .map((row) => ({
      row,
      heard: heardCount(row),
      long: isSimpleSentence(row.hanzi, opts.word) ? 0 : 1,
      last: statOf(row)?.heard?.last_at ?? '',
      tie: listenHash(`${opts.seed}|${row.key}`),
    }))
    .sort((a, b) =>
      a.heard - b.heard
      || a.long - b.long
      || (a.last < b.last ? -1 : a.last > b.last ? 1 : 0)
      || a.tie - b.tie
      || (a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0))
    .map((x) => x.row);
  const chosen = ranked.slice(0, count);
  const previous = opts.previous ?? [];
  if (
    ranked.length > chosen.length
    && chosen.length > 0
    && previous.length === chosen.length
    && chosen.every((r) => previous.includes(r.key))
  ) {
    chosen[chosen.length - 1] = ranked[chosen.length];
  }
  const shown = seededShuffle(chosen, opts.seed);
  const fresh = shown.filter((r) => heardCount(r) === 0).length;
  const shownKeys = new Set(shown.map((r) => r.key));
  const unheardLeft = natural.filter((r) => heardCount(r) === 0 && !shownKeys.has(r.key)).length;
  return { rows: shown, fresh, heardBefore: shown.length - fresh, unheardLeft };
}

/**
 * Ask the sentence top-up for more (reason 'fresh', ADDED to the set with their clips, sentenceHistory.ts):
 * the showing left fewer than LISTEN_CONTEXT_FRESH_LOW unheard sentences — enough to get back to
 * LISTEN_CONTEXT_FRESH_BUFFER, 3–8 at a time. null = enough waiting.
 */
export function listenTopUpWant(pick: Pick<ListenPick, 'unheardLeft'>): { reason: 'fresh'; count: number } | null {
  if (pick.unheardLeft >= LISTEN_CONTEXT_FRESH_LOW) return null;
  const count = Math.min(SENTENCE_TOPUP_MAX, Math.max(SENTENCE_TOPUP_MIN, LISTEN_CONTEXT_FRESH_BUFFER - Math.max(0, pick.unheardLeft)));
  return { reason: 'fresh', count };
}

/** The analytics props of `study.listen_context_shown` (counts only). */
export function listenShownProps(pick: Pick<ListenPick, 'rows' | 'fresh' | 'heardBefore'>): { shown: number; fresh: number; heard_before: number } {
  return { shown: pick.rows.length, fresh: pick.fresh, heard_before: pick.heardBefore };
}

/**
 * The rows on screen once a showing's pick is made: the picked keys in their order (current data — a clip
 * that arrived meanwhile), then rows added during the showing ("+ More sentences") after them.
 */
export function listenShownRows(rows: readonly ListenRow[], shownKeys: readonly string[], added: readonly string[] = []): ListenRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r] as const));
  const out: ListenRow[] = [];
  const seen = new Set<string>();
  for (const k of [...shownKeys, ...added]) {
    const r = byKey.get(k);
    if (r && !seen.has(k)) {
      out.push(r);
      seen.add(k);
    }
  }
  return out;
}

/** The analytics props of `study.listen_context` (counts / booleans only). */
export function listenContextProps(state: {
  sentencesPlayed: number;
  wordFirstPromptShown: boolean;
  playedWordAnyway: boolean;
}): { sentences_played: number; word_first_prompt_shown: boolean; played_word_anyway: boolean } {
  return {
    sentences_played: state.sentencesPlayed,
    word_first_prompt_shown: state.wordFirstPromptShown,
    played_word_anyway: state.playedWordAnyway,
  };
}

/** Copy, the same in both apps. */
export const LISTEN_CONTEXT_COPY = {
  heading: 'Listen in context',
  word: 'The word',
  more: '+ More sentences',
  generating: 'Writing more sentences…',
  moreFailed: 'Could not write more sentences. Try again in a moment.',
  unavailable: 'Not downloaded',
  promptTitle: 'Try the sentences first?',
  promptBody: 'Hearing the word in context helps.',
  promptAnyway: 'Play the word anyway',
  promptSentence: 'Play a sentence',
  noSentences: 'No example sentences yet.',
  /** EN on the card's own sentence when the note has no English and it can't be fetched now. */
  translationOffline: 'Translation needs a connection',
} as const;

/** The row's label for screen readers / tests: "Sentence 2", "Sentence 2, played". */
export function listenRowLabel(index: number, played: boolean): string {
  return `Sentence ${index + 1}${played ? ', played' : ''}`;
}
