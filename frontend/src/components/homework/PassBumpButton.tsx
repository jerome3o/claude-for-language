import { useRef, useState } from 'react';
import { allCharactersKnown, knownCharactersFrom, knownNoteIdsFrom, toLongTermPref, type LongTermPref } from '@shared/decks';
import { passBumpHint, passBumpKindOfRow, passBumpLabel, passBumpPlan, type PassBumpKind, type PassBumpPlan } from '@shared/homework';
import { db, type LocalCard, type LocalNote } from '../../db/database';
import { bumpCardTypes, bumpNotes, clearBump, useBumps } from '../../services/studyBumps';
import { setNoteLongTerm } from '../../services/longTerm';
import { readNewCardOrder } from '../../services/newCardOrder';
import '../bumps/bumps.css';

/**
 * The homework pass's "⚡ Study it today" (shared/homework/pass-bump.ts, docs/HOMEWORK.md §3c): an
 * unstarted word puts ONE card in today's study — its listening card (else its lead card) — and
 * goes into long-term review so its other cards come later as purple cards; a started word is
 * bumped whole, as before. A second tap takes it out (and puts back the long-term choice ⚡ changed).
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

  const plan = (knownLead?: () => boolean): PassBumpPlan => passBumpPlan({
    cards, started, hasAudio: !!note.audio_url, knownCharactersLead: knownLead,
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
      const lead = plan().kind === 'lead' ? await knownCharactersLead(note.hanzi) : false;
      const p = plan(() => lead);
      if (p.cardTypes) await bumpCardTypes(note.id, p.cardTypes, 'homework_pass');
      else await bumpNotes([note.id], 'homework_pass');
      if (p.longTerm !== undefined) {
        restore.current.set(note.id, toLongTermPref(note.long_term));
        await setNoteLongTerm(note.id, p.longTerm);
      }
    } finally {
      setBusy(false);
    }
  }

  const fromTutor = row?.bumped_by_name;
  const hint = on ? passBumpHint(kind) : '';
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

/** "English → Chinese" applies to this word: the setting is on and he knows every character (lead-card.ts). */
async function knownCharactersLead(hanzi: string): Promise<boolean> {
  if (!readNewCardOrder().known_characters_english_first) return false;
  const known = knownNoteIdsFrom(await db.cards.toArray());
  if (known.size === 0) return false;
  const notes = await db.notes.bulkGet([...known]);
  return allCharactersKnown(hanzi, knownCharactersFrom(notes.map((n) => n?.hanzi ?? '')));
}
