import { Link } from 'react-router-dom';
import { daysToIntroduce } from '@shared/decks';
import type { LocalDeck, DeckQueueRaw } from '../../db/database';
import { orderDecksForQueue } from '../../services/deckOrder';
import { readStudyBudget } from '../../services/studyBudget';

interface Props {
  decks: LocalDeck[];
  raw: Map<string, DeckQueueRaw>;
}

/**
 * What the queue is doing: which deck new words come from next, how many are
 * left in it and roughly how long that takes at the daily budget, then how
 * much is waiting behind it. The number that tells a learner (and their
 * tutor) whether homework is flowing or piling up.
 */
export function NextUpLine({ decks, raw }: Props) {
  const budget = readStudyBudget();
  const queue = orderDecksForQueue(decks)
    .map(d => ({ deck: d, words: raw.get(d.id)?.unseenNotes ?? 0 }))
    .filter(x => x.words > 0);
  if (queue.length === 0 || budget.new_cards_per_day === 0) return null;
  const [next, ...rest] = queue;
  const restWords = rest.reduce((s, x) => s + x.words, 0);
  const days = daysToIntroduce(next.words, budget);
  return (
    <p className="home-next-up" data-testid="next-up">
      <span className="home-next-up-label">Next up</span>{' '}
      <Link to={`/decks/${next.deck.id}`} className="home-next-up-deck">{next.deck.name}</Link>
      {' · '}{next.words} {next.words === 1 ? 'word' : 'words'} to go
      {' · '}about {days} {days === 1 ? 'day' : 'days'}
      {rest.length > 0 && (
        <span className="home-next-up-rest"> · then {rest.length} more {rest.length === 1 ? 'deck' : 'decks'} ({restWords} words)</span>
      )}
      <span className="home-next-up-rate"> · {budget.new_cards_per_day} new a day, <Link to="/settings">change</Link></span>
    </p>
  );
}
