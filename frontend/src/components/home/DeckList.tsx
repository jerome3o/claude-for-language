import { Link } from 'react-router-dom';
import type { LocalDeck } from '../../db/database';
import type { DeckQueueCounts } from '../../db/database';
import type { DeckOverview } from './useDeckOverview';

export const HOME_DECK_LIMIT = 5;

interface DeckListProps {
  decks: LocalDeck[];
  counts: Map<string, DeckQueueCounts>;
  overview: Map<string, DeckOverview> | undefined;
  pinnedIds: Set<string>;
  onTogglePin: (deckId: string) => void;
}

function dueOf(c: DeckQueueCounts | undefined): number {
  if (!c) return 0;
  return c.new + (c.secondaryNew ?? 0) + c.learning + c.review;
}

/**
 * Order for the home: pinned first, then by cards due (desc), then by name.
 * Exported for the page to know whether there is more than fits.
 */
export function orderDecksForHome(
  decks: LocalDeck[],
  counts: Map<string, DeckQueueCounts>,
  pinnedIds: Set<string>
): LocalDeck[] {
  return [...decks].sort((a, b) => {
    const pa = pinnedIds.has(a.id) ? 1 : 0;
    const pb = pinnedIds.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const da = dueOf(counts.get(a.id));
    const dbb = dueOf(counts.get(b.id));
    if (da !== dbb) return dbb - da;
    return a.name.localeCompare(b.name);
  });
}

/** Compact deck rows: name, "n words", "n due", a thin progress bar and a pin. */
export function DeckList({ decks, counts, overview, pinnedIds, onTogglePin }: DeckListProps) {
  const ordered = orderDecksForHome(decks, counts, pinnedIds).slice(0, HOME_DECK_LIMIT);

  return (
    <ul className="home-deck-list">
      {ordered.map(deck => {
        const c = counts.get(deck.id);
        const due = dueOf(c);
        const ov = overview?.get(deck.id);
        const seenPct = ov && ov.cards > 0 ? (ov.seen / ov.cards) * 100 : 0;
        const masteredPct = ov && ov.cards > 0 ? (ov.mastered / ov.cards) * 100 : 0;
        const pinned = pinnedIds.has(deck.id);
        return (
          <li key={deck.id} className="home-deck-row">
            <Link to={`/decks/${deck.id}`} className="home-deck-link">
              <span className="home-deck-main">
                <span className="home-deck-name">{deck.name}</span>
                <span className="home-deck-due">
                  {due > 0 ? `${due} due` : c?.hasMoreNew ? 'done today' : 'done ✓'}
                  <span className="home-deck-chevron" aria-hidden="true">›</span>
                </span>
              </span>
              <span className="home-deck-meta">
                <span className="home-bar home-bar-thin" aria-hidden="true">
                  <span className="home-bar-fill home-bar-mastered" style={{ width: `${masteredPct}%` }} />
                  <span className="home-bar-fill" style={{ width: `${Math.max(0, seenPct - masteredPct)}%` }} />
                </span>
                {ov && (
                  <span className="home-deck-words">{ov.notes} {ov.notes === 1 ? 'word' : 'words'}</span>
                )}
              </span>
            </Link>
            <button
              type="button"
              className={`home-pin-btn${pinned ? ' pinned' : ''}`}
              onClick={() => onTogglePin(deck.id)}
              aria-pressed={pinned}
              aria-label={pinned ? `Unpin ${deck.name}` : `Pin ${deck.name} to top`}
              title={pinned ? 'Unpin' : 'Pin to top'}
            >
              📌
            </button>
          </li>
        );
      })}
    </ul>
  );
}
