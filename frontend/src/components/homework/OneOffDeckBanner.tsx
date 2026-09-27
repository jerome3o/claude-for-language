import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_DECK_SETTINGS } from '@shared/decks';
import { db } from '../../db/database';
import { updateDeckSettings } from '../../api/client';
import { useNetwork } from '../../contexts/NetworkContext';
import './homework.css';

/**
 * On a deck the tutor sent as ONE-OFF homework (its caps are 0, so the daily
 * budget never introduces it): say so, link to the pass, and let the student
 * add the words to their daily review.
 */
export function OneOffDeckBanner({ deckId, newPerDay, secondaryPerDay, onChanged }: { deckId: string; newPerDay: number; secondaryPerDay: number; onChanged?: () => void }) {
  const { isOnline } = useNetwork();
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const assignment = useLiveQuery(
    async () => (await db.homeworkAssignments.where('target_id').equals(deckId).toArray()).find((a) => a.mode === 'one_off' && a.status !== 'cancelled') ?? null,
    [deckId]
  );
  if (!assignment || newPerDay > 0 || secondaryPerDay > 0) return null;

  const add = async () => {
    setState('busy');
    try {
      const caps = { new_cards_per_day: DEFAULT_DECK_SETTINGS.new_cards_per_day, secondary_cards_per_day: DEFAULT_DECK_SETTINGS.secondary_cards_per_day };
      await updateDeckSettings(deckId, caps);
      await db.decks.update(deckId, caps);
      setState('idle');
      onChanged?.();
    } catch {
      setState('error');
    }
  };

  return (
    <div className="hw-deck-banner" data-testid="one-off-deck-banner">
      <p>
        <strong>Homework only.</strong> These words aren&rsquo;t in your daily review — go through them once in the{' '}
        <Link to={`/homework/${assignment.id}`}>homework pass</Link>.
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => void add()} disabled={state === 'busy' || !isOnline}>
        {state === 'busy' ? 'Adding…' : 'Add to my daily review'}
      </button>
      {state === 'error' && <p className="hw-muted">Couldn&rsquo;t change it — try again when you&rsquo;re online.</p>}
    </div>
  );
}
