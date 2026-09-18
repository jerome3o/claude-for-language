import type { QueueCounts } from '../../types';

/** Rough average time per card, including the reveal and the rating. */
export const SECONDS_PER_CARD = 20;

export function totalDue(counts: Pick<QueueCounts, 'new' | 'learning' | 'review'> & { secondaryNew?: number }): number {
  return counts.new + (counts.secondaryNew ?? 0) + counts.learning + counts.review;
}

/** Whole minutes, rounded up, never below 1 for a non-empty queue. */
export function estimateStudyMinutes(cardCount: number): number {
  if (cardCount <= 0) return 0;
  return Math.max(1, Math.ceil((cardCount * SECONDS_PER_CARD) / 60));
}

/** "about 8 min", "about 1 min", "under a minute" (for 1–2 cards). */
export function formatStudyEstimate(cardCount: number): string {
  if (cardCount <= 0) return '';
  if (cardCount * SECONDS_PER_CARD < 60) return 'under a minute';
  const minutes = estimateStudyMinutes(cardCount);
  return `about ${minutes} min`;
}

/** The Study button's subtitle: "24 cards due · about 8 min". */
export function describeDue(cardCount: number): string {
  if (cardCount <= 0) return 'Nothing due right now';
  const noun = cardCount === 1 ? 'card' : 'cards';
  return `${cardCount} ${noun} due · ${formatStudyEstimate(cardCount)}`;
}

export interface BreakdownRow {
  key: 'new' | 'secondaryNew' | 'learning' | 'review';
  count: number;
  label: string;
  color: string;
}

/** The four-colour breakdown for the ⓘ popover, in the order the session shows them. */
export function breakdownRows(counts: QueueCounts): BreakdownRow[] {
  const secondary = counts.secondaryNew ?? 0;
  return [
    { key: 'new', count: counts.new, label: counts.new === 1 ? 'new word' : 'new words', color: '#3b82f6' },
    { key: 'secondaryNew', count: secondary, label: secondary === 1 ? 'more card of a word you started' : 'more cards of words you started', color: '#8b5cf6' },
    { key: 'learning', count: counts.learning, label: counts.learning === 1 ? 'card still learning' : 'cards still learning', color: '#f97316' },
    { key: 'review', count: counts.review, label: counts.review === 1 ? 'card to review' : 'cards to review', color: '#22c55e' },
  ];
}
