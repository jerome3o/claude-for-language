/**
 * The Sentence round (docs/STUDY_SESSION.md "Sentence round"): with Settings → Study → "Sentence
 * round before the answer" on, a reading (hanzi → meaning) or meaning (meaning → hanzi) card in the
 * regular study session goes from its question to a round of FOUR sentence exercises before the
 * answer side — two READ (a Chinese sentence: read it aloud) and two TRANSLATE (an English
 * sentence: say it in Chinese), easiest → harder — and ANY two said right open the answer with
 * Good / Easy already unlocked (the gate's count carries over: `sentenceGate` in
 * sentencePractise.ts counts the round's exercise ids). Skip goes to the answer at once, where the
 * gate still applies. Like Worldle: one item, a ladder of harder questions about it.
 *
 * Each take is judged exactly like the rows' 🎤 (`sentenceTake` / `sentencePractiseResult`, the
 * translate take's online answer check) — practice only, nothing recorded.
 *
 * Pure; the Lab app's port (core `SentenceRound.kt`) is parity-tested (parity/fixtures/sentence-round.ts).
 */
import { SENTENCE_GATE_CARD_TYPES, SENTENCE_GATE_TARGET, type SentencePractiseMode } from './sentencePractise';

/** How many exercises a round offers (2 read + 2 translate when the card has four sentences). */
export const SENTENCE_ROUND_SIZE = 4;

/** One of the card's sentences, in the list's order (the card's own first, then the set easiest → hardest). */
export interface RoundSentence {
  /** The row key (`clue:<noteId>` or the set row's id). */
  key: string;
  hanzi: string;
  /** The English ('' / null = none: that sentence can't be a translate exercise). */
  translation: string | null | undefined;
}

export interface RoundSentenceSource {
  /** The note's own sentence (sentence_clue), if any. */
  clue: { key: string; hanzi: string; translation: string | null | undefined } | null;
  /** The generated set, in its order (easiest → hardest). */
  set: readonly RoundSentence[];
}

/**
 * The card's sentences as one list — exactly the answer side's list: the card's own sentence
 * first unless a set row says the same thing, then the set.
 */
export function roundSentences(source: RoundSentenceSource): RoundSentence[] {
  const out: RoundSentence[] = [];
  const clue = source.clue;
  if (clue && clue.hanzi.trim() && !source.set.some((s) => s.hanzi === clue.hanzi)) {
    out.push({ key: clue.key, hanzi: clue.hanzi, translation: clue.translation });
  }
  for (const s of source.set) out.push({ key: s.key, hanzi: s.hanzi, translation: s.translation });
  return out;
}

export interface RoundExercise {
  /** `read:<key>` / `translate:<key>` — what the round (and the gate) counts. */
  id: string;
  /** The sentence's row key. */
  key: string;
  mode: SentencePractiseMode;
  /** Where the sentence sits in the card's list (0 = the easiest). */
  index: number;
}

export function roundExerciseId(mode: SentencePractiseMode, key: string): string {
  return `${mode}:${key}`;
}

const hasTranslation = (s: RoundSentence) => !!(s.translation ?? '').trim();

/**
 * The round's exercises, in the order shown (easiest → harder). Up to four different sentences
 * spread over the list (the easiest, the hardest and evenly between), modes alternating read,
 * translate, read, translate — so the card's own sentence (often without English) is read. A
 * translate slot whose sentence has no English swaps modes with the nearest read slot that has
 * one, else becomes a read. Fewer than four sentences: the other mode of each sentence (easiest
 * first) fills the round up to four — reuse is unavoidable then; a sentence with no English is
 * never a translate. Deterministic: the same list gives the same round in both apps.
 */
export function pickRoundExercises(sentences: readonly RoundSentence[]): RoundExercise[] {
  const n = sentences.length;
  if (n === 0) return [];
  const m = Math.min(SENTENCE_ROUND_SIZE, n);
  const picks: number[] = [];
  for (let k = 0; k < m; k++) picks.push(m === 1 ? 0 : Math.round((k * (n - 1)) / (m - 1)));
  const modes: SentencePractiseMode[] = picks.map((_, k) => (k % 2 === 0 ? 'read' : 'translate'));
  for (let k = 0; k < m; k++) {
    if (modes[k] !== 'translate' || hasTranslation(sentences[picks[k]])) continue;
    // The nearest read slot whose sentence has English (later first on a tie).
    let best = -1;
    for (let j = 0; j < m; j++) {
      if (modes[j] !== 'read' || !hasTranslation(sentences[picks[j]])) continue;
      if (best < 0 || Math.abs(j - k) < Math.abs(best - k) || (Math.abs(j - k) === Math.abs(best - k) && j > best)) best = j;
    }
    if (best >= 0) {
      modes[best] = 'translate';
    }
    modes[k] = 'read';
  }
  const out: RoundExercise[] = picks.map((index, k) => {
    const s = sentences[index];
    return { id: roundExerciseId(modes[k], s.key), key: s.key, mode: modes[k], index };
  });
  // Fewer than four: the other mode of each sentence, easiest first.
  for (let k = 0; k < m && out.length < SENTENCE_ROUND_SIZE; k++) {
    const s = sentences[picks[k]];
    const other: SentencePractiseMode = modes[k] === 'read' ? 'translate' : 'read';
    if (other === 'translate' && !hasTranslation(s)) continue;
    const id = roundExerciseId(other, s.key);
    if (out.some((e) => e.id === id)) continue;
    out.push({ id, key: s.key, mode: other, index: picks[k] });
  }
  return out;
}

/** The round happens on this showing: the setting on, a gated card type, and not known to have no sentences. */
export function sentenceRoundOpens(args: { enabled: boolean; cardType: string; sentenceCount: number | null }): boolean {
  if (!args.enabled || !SENTENCE_GATE_CARD_TYPES.includes(args.cardType)) return false;
  return args.sentenceCount == null || args.sentenceCount > 0;
}

export interface RoundProgress {
  /** Exercises to get right: two, or as many sentences as the card has. */
  needed: number;
  /** Got right so far (distinct exercises of this round, capped at `needed`). */
  got: number;
  /** Enough right: the answer opens with Good / Easy unlocked. */
  done: boolean;
}

export function sentenceRoundProgress(exercises: readonly RoundExercise[], rightIds: readonly string[]): RoundProgress {
  const sentences = new Set(exercises.map((e) => e.key)).size;
  const needed = Math.min(SENTENCE_GATE_TARGET, sentences);
  const ids = new Set(exercises.map((e) => e.id));
  const got = Math.min(needed, new Set(rightIds.filter((id) => ids.has(id))).size);
  return { needed, got, done: needed > 0 && got >= needed };
}

// --- words (both apps) --------------------------------------------------------------------------

export const SENTENCE_ROUND_TITLE = 'Sentence round';
export const SENTENCE_ROUND_SKIP = 'Skip to the answer';
export const SENTENCE_ROUND_TRY_AGAIN = 'Try again';
export const SENTENCE_ROUND_SEE_ANSWER = 'See the answer';
export const SENTENCE_ROUND_SHOW_ENGLISH = 'Show English';
export const SENTENCE_ROUND_HIDE_ENGLISH = 'Hide English';
/** Each exercise's heading. */
export const SENTENCE_ROUND_PROMPT: Record<SentencePractiseMode, string> = {
  read: '📖 Read it aloud',
  translate: '🔁 Say it in Chinese',
};

/** The counter: "1 / 2". */
export function sentenceRoundCounter(p: RoundProgress): string {
  return `${p.got} / ${p.needed}`;
}

/** Under the title: "Get any 2 of these 4 right". */
export function sentenceRoundIntro(p: RoundProgress, exerciseCount: number): string {
  if (p.needed === 1) return exerciseCount > 1 ? `Get any 1 of these ${exerciseCount} right` : 'Get this one right';
  return `Get any ${p.needed} of these ${exerciseCount} right`;
}

/** After a right take: "🎉 Nice — 1 / 2" … "🎉 2 / 2 — Good and Easy unlocked". */
export function sentenceRoundCheer(p: RoundProgress): string {
  return p.done ? `🎉 ${p.got} / ${p.needed} — Good and Easy unlocked` : `🎉 Nice — ${p.got} / ${p.needed}`;
}

/** An exercise's result line (icon + words: never colour alone). */
export const SENTENCE_ROUND_RESULT: Record<'right' | 'close' | 'wrong', string> = {
  right: '✓ Right',
  close: '≈ Nearly',
  wrong: '✗ Not quite',
};

/** One line under Skip: what happens on the answer side. */
export function sentenceRoundSkipNote(p: RoundProgress): string {
  const left = Math.max(0, p.needed - p.got);
  if (left === 0) return 'Good and Easy are unlocked.';
  return `Good and Easy stay locked until ${left === 1 ? '1 more sentence is' : `${left} more sentences are`} right — the sentences on the answer side still count.`;
}
