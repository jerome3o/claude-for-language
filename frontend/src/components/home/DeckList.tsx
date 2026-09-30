import { Link } from 'react-router-dom';
import type { LocalDeck } from '../../db/database';
import type { DeckQueueCounts } from '../../db/database';
import type { DeckOverview } from './useDeckOverview';
import { orderDecksForQueue } from '../../services/deckOrder';

export const HOME_DECK_LIMIT = 5;

interface DeckListProps {
  decks: LocalDeck[];
  counts: Map<string, DeckQueueCounts>;
  overview: Map<string, DeckOverview> | undefined;
  onMoveTop: (deckId: string) => void;
}

function dueOf(c: DeckQueueCounts | undefined): number {
  if (!c) return 0;
  return c.new + (c.secondaryNew ?? 0) + c.learning + c.review;
}

/** The home shows the queue in study order: the deck new words come from first is at the top. */
export function orderDecksForHome(decks: LocalDeck[]): LocalDeck[] {
  return orderDecksForQueue(decks);
}

/** Slim one-line deck rows in queue order: name, a small progress bar, "n due", and a ↑ (move to top) button. */
export function DeckList({ decks, counts, overview, onMoveTop }: DeckListProps) {
  const ordered = orderDecksForHome(decks).slice(0, HOME_DECK_LIMIT);

  return (
    <ul className="home-deck-list">
      {ordered.map((deck, index) => {
        const c = counts.get(deck.id);
        const due = dueOf(c);
        const ov = overview?.get(deck.id);
        const seenPct = ov && ov.cards > 0 ? (ov.seen / ov.cards) * 100 : 0;
        const masteredPct = ov && ov.cards > 0 ? (ov.mastered / ov.cards) * 100 : 0;
        const dueText = due > 0 ? `${due} due` : c?.hasMoreNew ? 'waiting' : 'done ✓';
        return (
          <li key={deck.id} className="home-deck-row">
            <Link to={`/decks/${deck.id}`} className="home-deck-link" aria-label={`${deck.name}${ov ? `, ${ov.notes} words` : ''}, ${dueText}`}>
              <span className="home-deck-name" title={deck.name}>{deck.name}</span>
              <span className="home-bar home-bar-thin home-deck-bar" aria-hidden="true" title={ov ? `${ov.notes} ${ov.notes === 1 ? 'word' : 'words'}` : undefined}>
                <span className="home-bar-fill home-bar-mastered" style={{ width: `${masteredPct}%` }} />
                <span className="home-bar-fill" style={{ width: `${Math.max(0, seenPct - masteredPct)}%` }} />
              </span>
              <span className={`home-deck-due${due > 0 ? ' has-due' : ''}`}>{dueText}</span>
            </Link>
            <button
              type="button"
              className="home-top-btn"
              onClick={() => onMoveTop(deck.id)}
              disabled={index === 0}
              aria-label={index === 0 ? `${deck.name} is first in the queue` : `Move ${deck.name} to the top of the queue`}
              title={index === 0 ? 'First in the queue' : 'Move to top'}
            >
              {index === 0 ? '1st' : '↑'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
