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
  mode?: SentencePractiseMode | null;
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
  /** Out of rotation (the last hide / unhide event decides). */
  hidden: { at: string; reason: SentenceHideReason | null } | null;
}

const emptyMode = (): ModeStats => ({ attempts: 0, rights: 0, misses: 0, last_at: null });
export const emptySentenceStats = (): SentenceStats => ({ read: emptyMode(), translate: emptyMode(), hidden: null });

/** The key a row of the card's list has in the history (`clue:<noteId>` → `clue`). */
export function sentenceHistoryKey(rowKey: string): string {
  return rowKey.startsWith('clue:') ? CLUE_SENTENCE_KEY : rowKey;
}

const isValidMode = (m: unknown): m is SentencePractiseMode => m === 'read' || m === 'translate';
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
export function knownInMode(stats: SentenceStats | undefined, mode: SentencePractiseMode): boolean {
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
 * Ask for more sentences for this word: fewer than four left in rotation, or every one left known in
 * both modes (read; translate only where the sentence has English). Hidden sentences don't count.
 */
export function wantsMoreSentences(
  sentences: readonly { key: string; translation: string | null | undefined }[],
  stats: ReadonlyMap<string, SentenceStats>,
): boolean {
  const visible = sentences.filter((s) => !stats.get(sentenceHistoryKey(s.key))?.hidden);
  if (visible.length < SENTENCE_ROUND_MIN_VISIBLE) return true;
  return visible.every((s) => {
    const st = stats.get(sentenceHistoryKey(s.key));
    if (!knownInMode(st, 'read')) return false;
    return !(s.translation ?? '').trim() || knownInMode(st, 'translate');
  });
}

/** The note under the round / list while more sentences are on the way. */
export const SENTENCES_COMING_NOTE = '✨ New sentences coming for this word';

export const SENTENCE_HIDE_TITLE = 'Stop showing this sentence';
export const SENTENCE_HIDE_HINT = 'It won’t come up in the Sentence round or the list again. Why?';
export const SENTENCE_HIDDEN_TOAST = 'Sentence hidden';
export const SENTENCE_SHOW_AGAIN = 'Show again';

/** The list's ⋯: "Show hidden (2)". */
export function showHiddenLabel(count: number): string {
  return `Show hidden (${count})`;
}
