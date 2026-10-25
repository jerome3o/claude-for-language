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
import { compareLeastKnown, sentenceHistoryKey, type SentenceStats } from './sentenceHistory';

/** How many exercises a round offers at most (2 read + 2 translate, one sentence each). */
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
 * The list's "spread order": the easiest, the hardest and evenly between first (four spread over the
 * list), then the rest easiest first. With no history this is the round — so a new word gets an easy
 * sentence and a hard one, not just the first four.
 */
export function spreadOrder(n: number): number[] {
  if (n <= 0) return [];
  const m = Math.min(SENTENCE_ROUND_SIZE, n);
  const first: number[] = [];
  for (let k = 0; k < m; k++) first.push(m === 1 ? 0 : Math.round((k * (n - 1)) / (m - 1)));
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (!first.includes(i)) rest.push(i);
  return [...first, ...rest];
}

/**
 * The round's exercises, in the order shown. Hidden sentences are left out. Four slots — read,
 * translate, read, translate — each takes the sentence he knows LEAST in that mode (never practised
 * first, then fewest rights, most misses, longest ago: `compareLeastKnown`), ties in spread order;
 * every slot a different sentence, a translate only where the sentence has English (else that slot
 * reads). Shown easiest → harder. A sentence is in AT MOST ONE exercise (its English would answer
 * the other): fewer than four sentences = fewer exercises (3 → 3, 2 → read + translate when it can,
 * 1 → 1), and the word asks for more (`wantsMoreSentences`, reason few). Deterministic: the same list
 * and history give the same round in both apps.
 */
export function pickRoundExercises(
  sentences: readonly RoundSentence[],
  stats?: ReadonlyMap<string, SentenceStats>,
): RoundExercise[] {
  const statsOf = (s: RoundSentence) => stats?.get(sentenceHistoryKey(s.key));
  const visible = sentences.map((s, index) => ({ s, index })).filter(({ s }) => !statsOf(s)?.hidden);
  const n = visible.length;
  if (n === 0) return [];
  const spread = spreadOrder(n);
  const rank = new Map(spread.map((pos, r) => [pos, r]));
  const best = (mode: SentencePractiseMode, used: Set<number>, avoidTranslatable = false): number | null => {
    let pick: number | null = null;
    for (let pos = 0; pos < n; pos++) {
      if (used.has(pos)) continue;
      if (mode === 'translate' && !hasTranslation(visible[pos].s)) continue;
      if (avoidTranslatable && hasTranslation(visible[pos].s)) continue;
      if (pick == null) { pick = pos; continue; }
      const c = compareLeastKnown(statsOf(visible[pos].s)?.[mode], statsOf(visible[pick].s)?.[mode]);
      if (c < 0 || (c === 0 && rank.get(pos)! < rank.get(pick)!)) pick = pos;
    }
    return pick;
  };
  const used = new Set<number>();
  const picked: { pos: number; mode: SentencePractiseMode }[] = [];
  const m = Math.min(SENTENCE_ROUND_SIZE, n);
  for (let k = 0; k < m; k++) {
    const want: SentencePractiseMode = k % 2 === 0 ? 'read' : 'translate';
    // A read slot leaves the sentences with English to the translate slots still to come when they
    // are just enough for them (2 sentences, one with English → read the other, translate that one).
    let translateSlotsLeft = 0;
    for (let j = k + 1; j < m; j++) if (j % 2 === 1) translateSlotsLeft++;
    let translatableLeft = 0;
    for (let pos = 0; pos < n; pos++) if (!used.has(pos) && hasTranslation(visible[pos].s)) translatableLeft++;
    const spare = want === 'read' && translateSlotsLeft > 0 && translatableLeft <= translateSlotsLeft;
    let pos = (spare ? best(want, used, true) : null) ?? best(want, used);
    let mode = want;
    if (pos == null && want === 'translate') {
      pos = best('read', used);
      mode = 'read';
    }
    if (pos == null) break;
    used.add(pos);
    picked.push({ pos, mode });
  }
  const make = (pos: number, mode: SentencePractiseMode): RoundExercise => {
    const { s, index } = visible[pos];
    return { id: roundExerciseId(mode, s.key), key: s.key, mode, index };
  };
  // One exercise per sentence: a sentence's English is never the answer to another exercise (nor the
  // other way round), so a sentence never comes twice. Fewer sentences = fewer exercises.
  return picked.slice().sort((a, b) => a.pos - b.pos).map((p) => make(p.pos, p.mode));
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

/**
 * The round's progress. A right id counts when it is one of the exercises — or, given `sentenceKeys`
 * (the sentences in rotation), any read / translate id of those: a round shown again (back from the
 * coach, a reload) may pick other exercises once this showing's takes are in the history, and what was
 * already right must still count.
 */
export function sentenceRoundProgress(
  exercises: readonly RoundExercise[],
  rightIds: readonly string[],
  sentenceKeys?: readonly string[],
): RoundProgress {
  const sentences = new Set(exercises.map((e) => e.key)).size;
  const needed = Math.min(SENTENCE_GATE_TARGET, sentences);
  const ids = new Set(exercises.map((e) => e.id));
  for (const k of sentenceKeys ?? []) {
    ids.add(roundExerciseId('read', k));
    ids.add(roundExerciseId('translate', k));
  }
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

// --- the round on the answer side --------------------------------------------------------------

/** How an exercise of this showing's round went (right sticks; untried = never said). */
export type RoundOutcome = 'right' | 'close' | 'wrong' | 'untried';

/** One exercise of the round as shown, and its last judged take (resume point `round_log`). */
export interface RoundLogEntry {
  id: string;
  result?: 'right' | 'close' | 'wrong' | null;
}

/** `read:<key>` / `translate:<key>` → its parts (null = not an exercise id). */
export function roundExerciseParts(id: string): { mode: SentencePractiseMode; key: string } | null {
  const at = id.indexOf(':');
  if (at <= 0) return null;
  const mode = id.slice(0, at);
  if (mode !== 'read' && mode !== 'translate') return null;
  const key = id.slice(at + 1);
  return key ? { mode, key } : null;
}

/** A sentence of the answer side's list that was in the round: its outline and label. */
export interface RoundRowMark {
  key: string;
  mode: SentencePractiseMode;
  outcome: RoundOutcome;
  label: string;
}

/** "In the round · ✓ Right" / "· ≈ Nearly" / "· ✗ Not quite" / "In the round" (icon + words, never colour alone). */
export function roundRowLabel(outcome: RoundOutcome): string {
  return outcome === 'untried' ? 'In the round' : `In the round · ${SENTENCE_ROUND_RESULT[outcome]}`;
}

/**
 * The round's sentences for the answer side, in the round's order (each sentence once): right when it
 * was said right on this showing (`rightIds` — the gate's count — or its last take), else its last
 * result, else untried (he skipped it).
 */
export function roundRowMarks(log: readonly RoundLogEntry[], rightIds: readonly string[]): RoundRowMark[] {
  const right = new Set(rightIds);
  const seen = new Set<string>();
  const out: RoundRowMark[] = [];
  for (const entry of log) {
    const parts = roundExerciseParts(entry.id);
    if (!parts || seen.has(parts.key)) continue;
    seen.add(parts.key);
    const outcome: RoundOutcome = right.has(entry.id) || entry.result === 'right' ? 'right' : entry.result ?? 'untried';
    out.push({ key: parts.key, mode: parts.mode, outcome, label: roundRowLabel(outcome) });
  }
  return out;
}

/** The answer side's order: the round's sentences first (in the round's order), then the rest as they were. */
export function orderKeysForRound(keys: readonly string[], marks: readonly RoundRowMark[]): string[] {
  const present = new Set(keys);
  const first = marks.map((m) => m.key).filter((k) => present.has(k));
  const firstSet = new Set(first);
  return [...first, ...keys.filter((k) => !firstSet.has(k))];
}

/**
 * The exercises of a round shown before (resume): the logged ids whose sentences are still in
 * rotation, in sentence order — null when none (pick afresh).
 */
export function exercisesFromLog(sentences: readonly RoundSentence[], ids: readonly string[], hidden?: (key: string) => boolean): RoundExercise[] | null {
  const index = new Map(sentences.map((s, i) => [s.key, i]));
  const out: RoundExercise[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const parts = roundExerciseParts(id);
    if (!parts || seen.has(parts.key) || !index.has(parts.key) || hidden?.(parts.key)) continue;
    seen.add(parts.key);
    out.push({ id: roundExerciseId(parts.mode, parts.key), key: parts.key, mode: parts.mode, index: index.get(parts.key)! });
  }
  if (!out.length) return null;
  return out.sort((a, b) => a.index - b.index);
}
