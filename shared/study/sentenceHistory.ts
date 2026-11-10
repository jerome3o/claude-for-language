/**
 * Practice per example sentence (docs/STUDY_SESSION.md "Sentence practice history"): every 🎤 take on a
 * sentence — in the Sentence round or on the answer side's rows — is an EVENT (sentence, mode, result,
 * when), and "Stop showing this sentence" / "Show again" are events too. Like reviews, the events are the
 * truth: uploaded idempotently by client id (`sentence_practice_events`, migration 0138), and each device
 * folds them into per-sentence stats with `sentenceStats`. The round then prefers the sentences he knows
 * least (`pickRoundExercises` in sentenceRound.ts), and when every sentence of a word is known (or fewer
 * than four are left) the word asks for more (`wantsMoreSentences` → the sentence top-up).
 *
 * Pure; the Lab app's port (core `SentenceHistory.kt`) is parity-tested (parity/fixtures/sentence-history.ts).
 */
import type { SentencePractiseMode } from './sentencePractise';

/**
 * The modes a take on a sentence is recorded in: read (the Chinese up, read aloud) and translate (the
 * English up, said in Chinese) — the rows' 🎤 and the round — and listen (Hard mode's "Sentences by ear":
 * the clip only, its meaning given in English; `pickRoundExercises` in sentenceRound.ts).
 */
export type SentencePracticeMode = SentencePractiseMode | 'listen';
export const SENTENCE_PRACTICE_MODES: readonly SentencePracticeMode[] = ['read', 'translate', 'listen'];

/** A sentence's key within its note: the set row's id, or `clue` for the note's own sentence. */
export const CLUE_SENTENCE_KEY = 'clue';

/** Right this many times in a mode = known in that mode. */
export const SENTENCE_KNOWN_RIGHTS = 3;

/** Why a sentence was taken out of rotation (the chips in the sheet). */
export const SENTENCE_HIDE_REASONS = ['weird', 'wrong', 'not_useful', 'too_rare'] as const;
export type SentenceHideReason = (typeof SENTENCE_HIDE_REASONS)[number];
export const SENTENCE_HIDE_REASON_LABEL: Record<SentenceHideReason, string> = {
  weird: '🤔 Weird',
  wrong: '❌ Wrong',
  not_useful: '🗑 Not useful',
  too_rare: '🦄 Too rare',
};

export type SentencePracticeResult = 'right' | 'close' | 'wrong';
export type SentencePracticeKind = 'attempt' | 'hide' | 'unhide';

export interface SentencePracticeEvent {
  /** Client id (idempotent upload). */
  id: string;
  note_id: string;
  sentence_key: string;
  kind: SentencePracticeKind;
  /** attempt only */
  mode?: SentencePracticeMode | null;
  /** attempt only */
  result?: SentencePracticeResult | null;
  /** hide only */
  reason?: SentenceHideReason | null;
  /** ISO time on the device. */
  at: string;
}

export interface ModeStats {
  attempts: number;
  rights: number;
  /** Takes judged close or wrong. */
  misses: number;
  /** The last attempt (ISO), null = never. */
  last_at: string | null;
}

export interface SentenceStats {
  read: ModeStats;
  translate: ModeStats;
  /** Understood by ear (Hard mode's "Sentences by ear"). */
  listen: ModeStats;
  /** Out of rotation (the last hide / unhide event decides). */
  hidden: { at: string; reason: SentenceHideReason | null } | null;
}

const emptyMode = (): ModeStats => ({ attempts: 0, rights: 0, misses: 0, last_at: null });
export const emptySentenceStats = (): SentenceStats => ({ read: emptyMode(), translate: emptyMode(), listen: emptyMode(), hidden: null });

/** The key a row of the card's list has in the history (`clue:<noteId>` → `clue`). */
export function sentenceHistoryKey(rowKey: string): string {
  return rowKey.startsWith('clue:') ? CLUE_SENTENCE_KEY : rowKey;
}

const isValidMode = (m: unknown): m is SentencePracticeMode => m === 'read' || m === 'translate' || m === 'listen';
const isValidResult = (r: unknown): r is SentencePracticeResult => r === 'right' || r === 'close' || r === 'wrong';

/** Event order: by time, then id (so both apps fold the same events the same way). */
function byTime(a: SentencePracticeEvent, b: SentencePracticeEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * One note's events → stats per sentence key (duplicate ids count once; unknown kinds / modes /
 * results are ignored). The last hide / unhide decides whether the sentence is hidden.
 */
export function sentenceStats(events: readonly SentencePracticeEvent[], noteId: string): Map<string, SentenceStats> {
  const out = new Map<string, SentenceStats>();
  const seen = new Set<string>();
  const mine = events.filter((e) => e.note_id === noteId).slice().sort(byTime);
  for (const e of mine) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    let s = out.get(e.sentence_key);
    if (e.kind === 'attempt') {
      if (!isValidMode(e.mode) || !isValidResult(e.result)) continue;
      if (!s) out.set(e.sentence_key, (s = emptySentenceStats()));
      const m = s[e.mode];
      m.attempts++;
      if (e.result === 'right') m.rights++;
      else m.misses++;
      if (m.last_at == null || e.at > m.last_at) m.last_at = e.at;
    } else if (e.kind === 'hide') {
      if (!s) out.set(e.sentence_key, (s = emptySentenceStats()));
      const reason = (SENTENCE_HIDE_REASONS as readonly string[]).includes(e.reason ?? '') ? (e.reason as SentenceHideReason) : null;
      s.hidden = { at: e.at, reason };
    } else if (e.kind === 'unhide') {
      if (!s) out.set(e.sentence_key, (s = emptySentenceStats()));
      s.hidden = null;
    }
  }
  return out;
}

/** Known in a mode: right at least SENTENCE_KNOWN_RIGHTS times. */
export function knownInMode(stats: SentenceStats | undefined, mode: SentencePracticeMode): boolean {
  return (stats?.[mode].rights ?? 0) >= SENTENCE_KNOWN_RIGHTS;
}

/**
 * Order for "the one he knows least" in a mode: never practised first, then fewest rights, then most
 * misses, then the longest ago; ties keep the list's order (easiest first). Negative = a before b.
 */
export function compareLeastKnown(a: ModeStats | undefined, b: ModeStats | undefined): number {
  const x = a ?? emptyMode();
  const y = b ?? emptyMode();
  const xNever = x.attempts === 0 ? 0 : 1;
  const yNever = y.attempts === 0 ? 0 : 1;
  if (xNever !== yNever) return xNever - yNever;
  if (x.rights !== y.rights) return x.rights - y.rights;
  if (x.misses !== y.misses) return y.misses - x.misses;
  const xl = x.last_at ?? '';
  const yl = y.last_at ?? '';
  if (xl !== yl) return xl < yl ? -1 : 1;
  return 0;
}

/** Below this many visible sentences a word asks for more. */
export const SENTENCE_ROUND_MIN_VISIBLE = 4;

/**
 * A FRESH sentence: never practised in any mode — read, translate or listen (no take, right or wrong)
 * — and not hidden. The Sentence round asks fresh sentences first (Jerome, Nov 2026: "I'm just
 * memorizing the sentences"), so the word is practised in a sentence he hasn't seen in a round before.
 * A sentence heard once by ear is used up like one read once, so the fresh buffer
 * (`moreSentencesWanted`) refills the same way.
 */
export function isFreshSentence(stats: SentenceStats | undefined): boolean {
  if (!stats) return true;
  return !stats.hidden && stats.read.attempts === 0 && stats.translate.attempts === 0 && (stats.listen?.attempts ?? 0) === 0;
}

/**
 * Known in every mode the sentence is practised in: read and listen are the same slot of the round
 * (`pickRoundExercises`: listen when it can be heard, else read), translate when it has English. With
 * "Sentences by ear" on and a clip (`byEar`), the slot is listen — known = listen known — else read.
 */
export function knownInAllModes(stats: SentenceStats | undefined, opts: { translation: boolean; byEar: boolean }): boolean {
  if (!knownInMode(stats, opts.byEar ? 'listen' : 'read')) return false;
  return !opts.translation || knownInMode(stats, 'translate');
}

/** How many of these sentences are fresh. */
export function freshSentenceCount(
  sentences: readonly { key: string }[],
  stats: ReadonlyMap<string, SentenceStats>,
): number {
  return sentences.filter((s) => isFreshSentence(stats.get(sentenceHistoryKey(s.key)))).length;
}

/** The buffer of fresh sentences a word keeps waiting: about two rounds' worth. */
export const SENTENCE_FRESH_BUFFER = 8;
/** Fewer fresh than this → more are made in the background, before the round runs out. */
export const SENTENCE_FRESH_LOW = 6;
/** One top-up makes between these many sentences (the server clamps too). */
export const SENTENCE_TOPUP_MIN = 3;
export const SENTENCE_TOPUP_MAX = 8;

/** How many sentences one top-up should make with `fresh` fresh ones left: back up to the buffer. */
export function freshTopUpCount(fresh: number): number {
  const f = Math.max(0, Math.floor(fresh));
  return Math.min(SENTENCE_TOPUP_MAX, Math.max(SENTENCE_TOPUP_MIN, SENTENCE_FRESH_BUFFER - f));
}

/** Why a word asks for more sentences: too few left in rotation, or the fresh buffer is running low. */
export type MoreSentencesReason = 'few' | 'fresh';

/**
 * Ask for more sentences for this word, and how many: fewer than four left in rotation ('few'), or fewer
 * than `SENTENCE_FRESH_LOW` fresh ones left ('fresh' — every round uses up to four, so the buffer is
 * refilled before it runs out). Hidden sentences don't count. null = enough.
 */
export function moreSentencesWanted(
  sentences: readonly { key: string; translation: string | null | undefined }[],
  stats: ReadonlyMap<string, SentenceStats>,
): { reason: MoreSentencesReason; fresh: number; count: number } | null {
  const visible = sentences.filter((s) => !stats.get(sentenceHistoryKey(s.key))?.hidden);
  const fresh = freshSentenceCount(visible, stats);
  if (visible.length < SENTENCE_ROUND_MIN_VISIBLE) return { reason: 'few', fresh, count: freshTopUpCount(fresh) };
  if (fresh < SENTENCE_FRESH_LOW) return { reason: 'fresh', fresh, count: freshTopUpCount(fresh) };
  return null;
}

/** True when the word should ask for more sentences (`moreSentencesWanted`). */
export function wantsMoreSentences(
  sentences: readonly { key: string; translation: string | null | undefined }[],
  stats: ReadonlyMap<string, SentenceStats>,
): boolean {
  return moreSentencesWanted(sentences, stats) != null;
}

/**
 * The note under the round / list while more sentences are on the way — only when the round itself is
 * short of fresh ones (fewer fresh than a round asks); a buffer refill stays silent.
 */
export const SENTENCES_COMING_NOTE = '✨ New sentences coming for this word';

/** Show `SENTENCES_COMING_NOTE`: the round itself is short (too few in rotation, or fewer fresh than a round asks). */
export function sentencesComingShown(want: { reason: MoreSentencesReason; fresh: number } | null): boolean {
  return !!want && (want.reason === 'few' || want.fresh < SENTENCE_ROUND_MIN_VISIBLE);
}

/** A word asks for more at most this often (one top-up in flight; the new rows arrive with a sync). */
export const SENTENCE_TOPUP_RETRY_MS = 10 * 60_000;

export const SENTENCE_HIDE_TITLE = 'Stop showing this sentence';
export const SENTENCE_HIDE_HINT = 'It won’t come up in the Sentence round or the list again. Why?';
export const SENTENCE_HIDDEN_TOAST = 'Sentence hidden';
export const SENTENCE_SHOW_AGAIN = 'Show again';

/** The list's ⋯: "Show hidden (2)". */
export function showHiddenLabel(count: number): string {
  return `Show hidden (${count})`;
}
