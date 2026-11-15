import { useRef, useState } from 'react';
import { toLongTermPref, type LongTermPref } from '@shared/decks';
import { passBumpHint, passBumpKindOfRow, passBumpLabel, passBumpPlan, type PassBumpKind, type PassBumpPlan } from '@shared/homework';
import type { LocalCard, LocalNote } from '../../db/database';
import { bumpNotes, clearBump, useBumps } from '../../services/studyBumps';
import { setNoteLongTerm } from '../../services/longTerm';
import '../bumps/bumps.css';

/**
 * The homework pass's "⚡ Study it today" (shared/homework/pass-bump.ts, docs/HOMEWORK.md §3c): an
 * unstarted word puts ONE card in today's study — its listening card (else its lead card) — and
 * goes into long-term review so its other cards come later as purple cards; a started word its
 * listening card (whole without one). The same rule as every ⚡ (shared/decks/study-today.ts,
 * services/studyBumps.ts bumpNotes). A second tap takes it out (and puts back the long-term choice
 * ⚡ changed).
 */
export function PassBumpButton(props: {
  note: LocalNote;
  /** The note's cards on the device (none = not here yet). */
  cards: ReadonlyArray<LocalCard>;
  started: boolean;
  /** Whether the word's deck is in daily review (long-term.ts); undefined = not known yet. */
  deckInReview: boolean | undefined;
}) {
  const { note, cards, started, deckInReview } = props;
  const bumps = useBumps();
  const row = bumps.get(note.id);
  const [busy, setBusy] = useState(false);
  // The long-term choice ⚡ replaced, per note, so taking ⚡ back restores it.
  const restore = useRef(new Map<string, LongTermPref>());

  const plan = (): PassBumpPlan => passBumpPlan({
    cards, started, hasAudio: !!note.audio_url,
    longTermPref: toLongTermPref(note.long_term), deckInReview: deckInReview ?? true,
  });
  const kind: PassBumpKind = row ? passBumpKindOfRow(row.card_types) : plan().kind;
  const on = !!row;

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      try { navigator.vibrate?.(10); } catch { /* no haptics */ }
      if (on) {
        await clearBump(note.id, 'homework_pass');
        const prev = restore.current.get(note.id);
        if (prev !== undefined && !started) {
          restore.current.delete(note.id);
          await setNoteLongTerm(note.id, prev);
        }
        return;
      }
      // The one "⚡ Study it today" rule (shared/decks/study-today.ts), as everywhere else.
      const out = await bumpNotes([note.id], 'homework_pass');
      const before = out.results[0]?.longTermBefore;
      if (before !== undefined) restore.current.set(note.id, before);
    } finally {
      setBusy(false);
    }
  }

  const fromTutor = row?.bumped_by_name;
  const hint = on ? passBumpHint(kind, started) : '';
  return (
    <div className="pass-bump" data-testid="pass-bump">
      <button
        type="button"
        className={`bump-btn bump-btn--compact${on ? ' bump-btn--on' : ''}`}
        onClick={onClick}
        disabled={busy}
        aria-pressed={on}
        data-kind={kind}
        title={on ? 'In today’s study — tap to take it out' : 'Put it first in today’s study'}
      >
        {on && fromTutor ? `⚡ From ${fromTutor}` : passBumpLabel(kind, on)}
      </button>
      {hint && <span className="pass-bump-hint" data-testid="pass-bump-hint">{hint}</span>}
    </div>
  );
}
