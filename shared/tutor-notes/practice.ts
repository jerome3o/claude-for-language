/**
 * Practising the cards a tutor left notes on ("Practice this card" / "Practice all" on the Tutor
 * notes page). The card is shown in the normal study card UI, but in a focused mini session of
 * just those cards — and the FSRS rule is strict:
 *
 *   A rating is a real review (a review event, FSRS state changes) ONLY when the card is due —
 *   the same "due today" the study session uses (`isDueByCutoff`: a learning / review card due by
 *   the cutoff). A card that is not due (or still NEW) is PRACTICE ONLY: no review event is
 *   written, its schedule is untouched. Same principle as the homework pass (docs/HOMEWORK.md,
 *   decision 1): extra practice must not reschedule a card early or introduce a new word outside
 *   the daily budget.
 *
 * Pure; the Lab app ports it (core TutorNotesRules.kt, parity-tested).
 */

import { isDueByCutoff, QUEUE_NEW, type QueueCardInput } from '../decks/study-queue';

export type PracticeCard = Pick<QueueCardInput, 'queue' | 'due_ms'>;

/** Does rating this card now write a review event? */
export function practiceRatingCounts(card: PracticeCard, cutoffMs: number): boolean {
  if (card.queue === QUEUE_NEW) return false;
  return isDueByCutoff({ id: '', note_id: '', deck_id: '', card_type: '', ...card }, cutoffMs);
}

/**
 * The practice queue after a rating: Again sends the card to the back (it comes round again,
 * like the pass's "Not yet"); any other rating takes it out. The session ends when it is empty.
 */
export function practiceAfterRating(queue: readonly string[], cardId: string, rating: number): string[] {
  const rest = queue.filter((id) => id !== cardId);
  return rating === 0 ? [...rest, cardId] : rest;
}

/**
 * Which card to practise for each note, in the notes' order, without repeats: a recording note's
 * own card; a flag's card, else the word's hanzi → meaning card, else its first card. Notes whose
 * word is not on the device are skipped.
 */
export function practiceCardIds(
  notes: ReadonlyArray<{ card_id: string | null; note_id: string }>,
  cardsByNote: ReadonlyMap<string, ReadonlyArray<{ id: string; card_type: string }>>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    const cards = cardsByNote.get(n.note_id) ?? [];
    let id: string | null = null;
    if (n.card_id && cards.some((c) => c.id === n.card_id)) id = n.card_id;
    else id = (cards.find((c) => c.card_type === 'hanzi_to_meaning') ?? cards[0])?.id ?? null;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The quiet line on the practice card: whether this rating will count. */
export function practiceHint(counts: boolean): string {
  return counts ? 'Due today — your rating counts as a review' : 'Practice only — not due, your schedule stays as it is';
}
