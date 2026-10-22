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
 * Pure rules, shared by the web (`components/study/ListenContext.tsx`) and the
 * Lab app (`core/…/ListenContext.kt`, parity-tested by
 * android-lab/parity/fixtures/listen-context.ts).
 */

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
}

/** The key of the card's own sentence row (the card-back list uses the same one). */
export function clueRowKey(noteId: string): string {
  return `clue:${noteId}`;
}

/**
 * The rows in order: the card's own sentence first (unless the set already
 * holds the same sentence — it is then shown once, as the set row), then the
 * set by position. Same order as the card-back SentenceSet.
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
    });
  }
  const sorted = sentences
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.position ?? a.i) - (b.s.position ?? b.i) || a.i - b.i)
    .map(({ s }) => s);
  for (const s of sorted) {
    rows.push({
      key: s.id,
      sentenceId: s.id,
      hanzi: s.hanzi,
      translation: s.translation?.trim() || null,
      audioUrl: s.audio_url || null,
      fromCard: false,
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

/** The background top-up: fewer than LISTEN_CONTEXT_MIN_SENTENCES in total. */
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
} as const;

/** The row's label for screen readers / tests: "Sentence 2", "Sentence 2, played". */
export function listenRowLabel(index: number, played: boolean): string {
  return `Sentence ${index + 1}${played ? ', played' : ''}`;
}
