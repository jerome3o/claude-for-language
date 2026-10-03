import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_DECK_SETTINGS, deckInDailyReview, isLongTerm, prefForToggle, toLongTermPref } from '@shared/decks';
import { db } from '../../db/database';
import { setNoteLongTerm } from '../../services/longTerm';
import { CardQueue } from '../../types';
import './homework.css';

/**
 * The answer side's "Add to my long-term review" switch (docs/HOMEWORK.md §3a): on = the word
 * joins daily review at the budget's pace, off = it never does. Saved at once, offline too.
 */
export function LongTermSwitch({ on, started, onChange }: { on: boolean; started: boolean; onChange: (on: boolean) => void }) {
  if (started) {
    return (
      <div className="hw-longterm hw-longterm--started" data-testid="hw-longterm">
        <span className="hw-longterm-label">✓ Already in your reviews</span>
      </div>
    );
  }
  return (
    <label className={`hw-longterm${on ? ' is-on' : ''}`} data-testid="hw-longterm">
      <span className="hw-longterm-label">
        {on ? 'In my long-term review' : 'Add to my long-term review'}
      </span>
      <span className="hw-longterm-switch">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => onChange(e.target.checked)}
          aria-label="Add to my long-term review"
          data-testid="hw-longterm-switch"
        />
        <span className="hw-longterm-track" aria-hidden="true"><span className="hw-longterm-thumb" /></span>
      </span>
    </label>
  );
}

/** "12 words added to daily review · 4 left out". */
export function longTermLine(added: number, leftOut: number): string {
  const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;
  if (leftOut === 0) return added === 1 ? 'The word goes into your daily review' : `All ${added} words go into your daily review`;
  if (added === 0) return `${words(leftOut)} left out of daily review`;
  return `${words(added)} added to daily review · ${leftOut} left out`;
}

/**
 * The same switch for one of MY notes outside a pass (the card hub): read from the device,
 * saved offline-first. Renders nothing until the note is on this device.
 */
export function NoteLongTermSwitch({ noteId }: { noteId: string }) {
  const state = useLiveQuery(async () => {
    const note = await db.notes.get(noteId);
    if (!note) return null;
    const [deck, cards] = await Promise.all([db.decks.get(note.deck_id), db.cards.where('note_id').equals(noteId).toArray()]);
    const inReview = deck ? deckInDailyReview(deck.new_cards_per_day, deck.secondary_cards_per_day ?? DEFAULT_DECK_SETTINGS.secondary_cards_per_day) : true;
    const started = cards.some((c) => c.queue !== CardQueue.NEW);
    return { pref: toLongTermPref(note.long_term), inReview, started };
  }, [noteId]);
  if (!state) return null;
  return (
    <LongTermSwitch
      on={isLongTerm(state.pref, state.inReview, state.started)}
      started={state.started}
      onChange={(on) => {
        try { navigator.vibrate?.(10); } catch { /* no haptics */ }
        void setNoteLongTerm(noteId, prefForToggle(on, state.inReview));
      }}
    />
  );
}
