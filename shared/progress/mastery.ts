/**
 * How far through a deck (or everything) the learner is, from card states — the deck
 * page's progress block (frontend/src/pages/DeckDetailPage.tsx, computed on the device) as
 * pure functions, parity-tested against the Lab app's port.
 *
 * A card is `new` (queue 0), `learning` (learning / relearning, or in review with stability
 * ≤ 7 days), `familiar` (stability ≤ 21 days) or `mastered` (> 21 days). "Seen" = not new.
 */

export type MasteryLevel = 'new' | 'learning' | 'familiar' | 'mastered';

export interface MasteryCard {
  card_type: string;
  /** 0 NEW, 1 LEARNING, 2 REVIEW, 3 RELEARNING. */
  queue: number;
  stability: number;
}

export interface MasteryCounts {
  total: number;
  new: number;
  learning: number;
  familiar: number;
  mastered: number;
}

export interface Completion {
  total_cards: number;
  cards_seen: number;
  cards_mastered: number;
  percent_seen: number;
  percent_mastered: number;
}

export const CARD_TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

export function masteryLevel(queue: number, stability: number): MasteryLevel {
  if (queue === 0) return 'new';
  if (queue === 1 || queue === 3) return 'learning';
  if (stability <= 7) return 'learning';
  if (stability <= 21) return 'familiar';
  return 'mastered';
}

function emptyCounts(): MasteryCounts {
  return { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 };
}

export function masteryProgress(cards: readonly MasteryCard[]): {
  completion: Completion;
  counts: MasteryCounts;
  breakdown: Record<(typeof CARD_TYPES)[number], MasteryCounts>;
} {
  const counts = emptyCounts();
  const breakdown = {
    hanzi_to_meaning: emptyCounts(),
    meaning_to_hanzi: emptyCounts(),
    audio_to_hanzi: emptyCounts(),
  };
  for (const card of cards) {
    const level = masteryLevel(card.queue, card.stability);
    counts.total++;
    counts[level]++;
    const type = breakdown[card.card_type as keyof typeof breakdown];
    if (type) {
      type.total++;
      type[level]++;
    }
  }
  const seen = counts.total - counts.new;
  return {
    completion: {
      total_cards: counts.total,
      cards_seen: seen,
      cards_mastered: counts.mastered,
      percent_seen: counts.total > 0 ? Math.round((seen / counts.total) * 100) : 0,
      percent_mastered: counts.total > 0 ? Math.round((counts.mastered / counts.total) * 100) : 0,
    },
    counts,
    breakdown,
  };
}
