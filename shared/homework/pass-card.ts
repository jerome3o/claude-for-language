/**
 * The homework pass in the study card (docs/HOMEWORK.md §3): each word of a one-off deck is shown
 * as the normal study card — the read card's 🎤 Record + live "You said", the typed cards' voice-first
 * say / type flow — but the answer side ends in the pass's own *Not yet* / *Got it* instead of
 * Again / Hard / Good / Easy, and nothing is written to review_events (no FSRS).
 *
 * What the card already knows can SUGGEST the outcome (the suggested button is highlighted), but the
 * learner always chooses. Lab port: core `Homework.passSuggestion` / `passCardId`, parity-tested.
 */

// Type only: shared/homework is bundled into the worker, which must not pull pinyin-pro in through answer.ts.
import type { AnswerVerdict } from '../cards/answer';

/** `isAcceptedVerdict` (shared/cards/answer.ts), repeated here so this module stays light. */
const accepted = (v: AnswerVerdict) => v !== 'wrong' && v !== 'close';

export type PassOutcome = 'right' | 'wrong';

/**
 * The card a pass shows for each word: the read card (hanzi → meaning, "say what it means") — what
 * the pass always asked, and the card with the 🎤 take Jerome reaches for. The other two types run
 * through the same card if a pass ever shows them.
 */
export const PASS_CARD_TYPE = 'hanzi_to_meaning';

/** Of a note's cards, the one the pass shows: its hanzi → meaning card, else the first by type order. */
export function passCardId(cards: ReadonlyArray<{ id: string; card_type: string }>): string | null {
  const order = [PASS_CARD_TYPE, 'meaning_to_hanzi', 'audio_to_hanzi'];
  let best: { id: string; rank: number } | null = null;
  for (const c of cards) {
    const i = order.indexOf(c.card_type);
    const rank = i < 0 ? order.length : i;
    if (!best || rank < best.rank || (rank === best.rank && c.id < best.id)) best = { id: c.id, rank };
  }
  return best?.id ?? null;
}

export interface PassCardEvidence {
  /** A typing card: the verdict of the answer typed / said / picked BEFORE the reveal (null = shown with nothing). */
  answerVerdict?: AnswerVerdict | null;
  /** A read card: the take's "You said" against the card (null = no take, or not transcribed yet). */
  take?: { isMatch: boolean; containsExpected: boolean } | null;
}

/**
 * The outcome the answer side suggests:
 * - a typing card answered before the reveal: right when the verdict is accepted (a homophone said
 *   aloud and an answer said inside a sentence count), else wrong;
 * - a read card with a transcribed take: right when it matched (or the word was said inside a
 *   sentence); a miss suggests nothing — the recogniser can be wrong, and the pass asks for the meaning;
 * - nothing tried (Show answer straight away), or a "🎤 Say it" practice after the reveal: no suggestion.
 */
export function passSuggestion(evidence: PassCardEvidence): PassOutcome | null {
  if (evidence.answerVerdict) return accepted(evidence.answerVerdict) ? 'right' : 'wrong';
  const take = evidence.take;
  if (take && (take.isMatch || take.containsExpected)) return 'right';
  return null;
}

/** How a pass word was answered (analytics `homework.pass_item` `answered`). */
export type PassAnsweredBy = 'take' | 'spoken' | 'typed' | 'choice' | 'none';
