/**
 * Rating a card in the tutor-notes practice (pages/TutorNotesPracticePage.tsx).
 *
 * The rule (shared/tutor-notes/practice.ts, the same in the Lab app): the rating is a REAL review
 * only when the card is due today by the study session's own cutoff — then it is stored exactly like
 * a study-session review (event + recording, state = replay of the card's events, background sync).
 * A card that is not due, or still NEW, is practice only: nothing is written, its schedule and the
 * daily new-card budget are untouched.
 */

import { practiceRatingCounts } from '@shared/tutor-notes';
import { createLocalReviewEvent, db, getStudyCutoff, queueInput, storePendingRecording, type LocalCard } from '../db/database';
import { recomputeCardFromEvents } from './review-events';
import { syncService } from './sync';
import type { Rating } from '../types';

/** Does rating this card now count as a review? */
export function practiceCounts(card: LocalCard, cutoffMs: number = getStudyCutoff().ts): boolean {
  return practiceRatingCounts({ queue: card.queue, due_ms: queueInput(card).due_ms }, cutoffMs);
}

export interface PracticeRatingResult {
  counted: boolean;
  /** The card as it is now (recomputed when the rating counted). */
  card: LocalCard;
}

export async function ratePracticeCard(
  card: LocalCard,
  rating: Rating,
  opts: { timeSpentMs?: number; userAnswer?: string; recordingBlob?: Blob; cutoffMs?: number } = {}
): Promise<PracticeRatingResult> {
  if (!practiceCounts(card, opts.cutoffMs)) return { counted: false, card };
  const id = crypto.randomUUID();
  const reviewedAt = new Date().toISOString();
  await createLocalReviewEvent({
    id,
    card_id: card.id,
    rating,
    time_spent_ms: opts.timeSpentMs || null,
    user_answer: opts.userAnswer || null,
    reviewed_at: reviewedAt,
    _synced: 0,
  });
  if (opts.recordingBlob) {
    await storePendingRecording({ id, blob: opts.recordingBlob, uploaded: false, created_at: reviewedAt });
  }
  await recomputeCardFromEvents(card.id);
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    syncService.syncEvents().catch(() => {});
  }
  return { counted: true, card: (await db.cards.get(card.id)) ?? card };
}
