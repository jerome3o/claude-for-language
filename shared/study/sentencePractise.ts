/**
 * 🎤 on the study card's example sentence rows (docs/STUDY_SESSION.md "Practise a sentence aloud")
 * and the optional "Get two sentences right before Good / Easy" gate built on it.
 *
 * A row's 🎤 sits left of its ▶ once something is open:
 * - **read** — the row shows its Chinese (normal mode, or English-first with the Chinese revealed):
 *   say the sentence aloud; the take is judged exactly like the Sentence Coach's "Practise saying
 *   it" (`practiseSentence`: tidied, punctuation ignored, homophones count by sound, other tones =
 *   close) and shown as the compact "You said" row.
 * - **translate** — English-first with the English up and the Chinese NOT yet revealed: "Say it in
 *   Chinese". The transcript is compared with the row's Chinese by the same rule; a take that isn't
 *   that sentence may still be a right translation, so (online) it goes to Claude's lesson answer
 *   check (`POST /api/lessons/answer-check`, exercise_type translate, input spoken — cached, an exact
 *   match never reaches the model) and its verdict decides. Offline / no check → "You said" vs the
 *   sentence plus "Check online for other ways to say it". The row then reveals its Chinese.
 * - nothing open yet (a blank listen-first row) → no 🎤.
 *
 * Practice only: nothing is recorded, no review event, the card's rating is never touched — except
 * through the gate below, which only decides whether Good / Easy may be pressed.
 *
 * Lab port: core `SentencePractise.kt`, parity-tested (parity/fixtures/sentence-practise.ts).
 */
import { practiseSentence, type PractisedSentence } from '../coach/practise';
import type { SpokenResultState } from '../cards/spoken-result';
import { hasHan, type AnswerCheckInput, type AnswerCheckVerdict } from '../lesson/answerCheck';

export type SentencePractiseMode = 'read' | 'translate';

/** What a row shows right now (the row's reveal state, as each app keeps it). */
export interface SentenceRowShowing {
  /** The row is in English-first mode (EN pressed). */
  englishFirst: boolean;
  /** The row's Chinese is on screen. */
  hanziShown: boolean;
  /** The row's English ('' / null = none). */
  translation: string | null | undefined;
}

/** Which test a 🎤 on this row runs; null = no 🎤 (nothing open yet). */
export function sentencePractiseMode(row: SentenceRowShowing): SentencePractiseMode | null {
  if (row.hanziShown) return 'read';
  if (row.englishFirst && (row.translation ?? '').trim()) return 'translate';
  return null;
}

/** 🎤's accessible name per mode (the button itself is the icon). */
export const SENTENCE_PRACTISE_LABEL: Record<SentencePractiseMode, string> = {
  read: 'Read it aloud',
  translate: 'Say it in Chinese',
};
/** The live line while the mic is open, before any words. */
export const SENTENCE_PRACTISE_LISTENING: Record<SentencePractiseMode, string> = {
  read: 'Listening… read the sentence',
  translate: 'Listening… say it in Chinese',
};
export const SENTENCE_PRACTISE_STOP = 'Stop — check what I said';
export const SENTENCE_PRACTISE_CHECKING = 'Checking your translation…';
/** A translate take that isn't the sentence and couldn't be checked by Claude (offline / failed). */
export const SENTENCE_PRACTISE_CHECK_ONLINE = 'Check online for other ways to say it';

/** right = counts (the gate); close = nearly; wrong; failed / empty = no take to judge. */
export type SentencePractiseResult = 'right' | 'close' | 'wrong' | 'failed' | 'empty';
/** How the result was decided: on the device, by Claude's check, or on the device for want of one. */
export type SentencePractiseVia = 'local' | 'claude' | 'offline';

/** The device's own judgement counts as right: said as written, or the same sounds (homophones). */
export function isLocalRight(state: SpokenResultState): boolean {
  return state === 'match' || state === 'sound';
}

export interface SentenceTake {
  practised: PractisedSentence;
  /** Translate mode, not the row's sentence, but Chinese was said: ask Claude whether it is a right translation. */
  askClaude: boolean;
}

/** A take of the learner on a row: the Coach's practise rule, and whether Claude decides instead. */
export function sentenceTake(mode: SentencePractiseMode, transcript: string, hanzi: string): SentenceTake {
  const practised = practiseSentence(transcript, hanzi);
  const askClaude = mode === 'translate' && !isLocalRight(practised.result.state) && hasHan(practised.said);
  return { practised, askClaude };
}

/** Claude's check of a translate take (the lesson "Say it in Chinese" check, spoken). */
export function sentenceAnswerCheckInput(
  row: { hanzi: string; pinyin?: string | null; translation?: string | null },
  said: string,
): AnswerCheckInput {
  const input: AnswerCheckInput = {
    prompt_en: (row.translation ?? '').trim(),
    model_answer: row.hanzi,
    answer: said,
    exercise_type: 'translate',
    input: 'spoken',
  };
  const pinyin = (row.pinyin ?? '').trim();
  if (pinyin) input.model_pinyin = pinyin;
  return input;
}

/**
 * The take's result. Claude's verdict (when there is one) decides — correct / acceptable = right,
 * almost = close, wrong; else the device's: match / sound = right, contains / close = close, wrong.
 * No take (practised null) → empty when nothing was heard, else failed.
 */
export function sentencePractiseResult(
  practised: PractisedSentence | null,
  claude: AnswerCheckVerdict | null,
  failure: 'failed' | 'offline' | 'empty' | null = null,
): SentencePractiseResult {
  if (!practised) return failure === 'empty' ? 'empty' : 'failed';
  if (claude) {
    if (claude === 'correct' || claude === 'acceptable') return 'right';
    return claude === 'almost' ? 'close' : 'wrong';
  }
  const state = practised.result.state;
  if (isLocalRight(state)) return 'right';
  return state === 'wrong' ? 'wrong' : 'close';
}

/** `study.sentence_practise { via }`: read and a right translate take are local; else Claude, or offline without a check. */
export function sentencePractiseVia(take: SentenceTake, claudeAnswered: boolean): SentencePractiseVia {
  if (!take.askClaude) return 'local';
  return claudeAnswered ? 'claude' : 'offline';
}

/** Show "Check online for other ways to say it" (a translate take Claude never judged). */
export function showCheckOnline(take: SentenceTake, claudeAnswered: boolean, checking: boolean): boolean {
  return take.askClaude && !claudeAnswered && !checking;
}

// ---------------------------------------------------------------------------------------------
// "Get two sentences right before Good / Easy" (Settings → Study, per device, OFF by default)
// ---------------------------------------------------------------------------------------------

/** How many example sentences must be said right with 🎤 before Good / Easy. */
export const SENTENCE_GATE_TARGET = 2;
/** The cards it gates (never the listening card, whose sentences are its clues). */
export const SENTENCE_GATE_CARD_TYPES: readonly string[] = ['hanzi_to_meaning', 'meaning_to_hanzi'];

export interface SentenceGate {
  /** Sentences to get right on this showing (0 = no gate). */
  needed: number;
  /** Got right so far (distinct sentences, capped at `needed`). */
  got: number;
  /** Good / Easy are disabled. */
  locked: boolean;
}

/**
 * The gate on one showing of a card. `sentenceCount` = the card's sentence + its set (null while
 * the list is still loading — the gate then asks for the full target); fewer than the target → as
 * many as exist; none → no gate. `rightKeys` = the rows said right on this showing (each once).
 */
export function sentenceGate(args: {
  enabled: boolean;
  cardType: string;
  sentenceCount: number | null;
  rightKeys: readonly string[];
}): SentenceGate {
  const applies = args.enabled && SENTENCE_GATE_CARD_TYPES.includes(args.cardType);
  const count = args.sentenceCount == null ? SENTENCE_GATE_TARGET : Math.max(0, Math.floor(args.sentenceCount));
  const needed = applies ? Math.min(SENTENCE_GATE_TARGET, count) : 0;
  const got = Math.min(needed, new Set(args.rightKeys).size);
  return { needed, got, locked: got < needed };
}

/** Ratings 0 Again · 1 Hard · 2 Good · 3 Easy: only Good / Easy wait for the gate. */
export function ratingLockedByGate(rating: number, gate: SentenceGate): boolean {
  return gate.locked && rating >= 2;
}

const sentences = (n: number) => (n === 1 ? '1 sentence' : `${n} sentences`);

/** The line above the ratings (null = no gate): "🎤 Get 2 sentences right to unlock Good · 1/2". */
export function sentenceGateLabel(gate: SentenceGate): string | null {
  if (gate.needed === 0) return null;
  if (gate.locked) return `🎤 Get ${sentences(gate.needed)} right to unlock Good · ${gate.got}/${gate.needed}`;
  return `✓ ${gate.got}/${gate.needed} right — Good and Easy unlocked`;
}

/** Said when a locked Good / Easy is tapped. */
export function sentenceGateBlockedNote(gate: SentenceGate): string {
  const left = Math.max(0, gate.needed - gate.got);
  return `Say ${left === 1 ? '1 more sentence' : `${left} more sentences`} right with 🎤 to unlock Good and Easy — Again and Hard are always there.`;
}
