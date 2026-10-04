import { useEffect, useState } from 'react';
import type { BumpSource } from '@shared/decks';
import { bumpNotes, clearBump, findExistingNotes, useBumps } from '../../services/studyBumps';
import './bumps.css';

/**
 * "⚡ Study today" for notes the learner already has (shared/decks/bumps.ts):
 * puts them first in today's session. Shows "⚡ Today ✓" once they're in the
 * pocket (tap again to take them out when `removable`). Offline-first.
 */
export function BumpButton(props: {
  noteIds: string[];
  source: BumpSource;
  label?: string;
  /** Small chip style (rows, lists) instead of a full button. */
  compact?: boolean;
  /** A second tap takes the word out of today's pocket. */
  removable?: boolean;
  className?: string;
  onBumped?: (message: string) => void;
}) {
  const { noteIds, source, compact, removable, className, onBumped } = props;
  const bumps = useBumps();
  const [busy, setBusy] = useState(false);
  const inPocket = noteIds.length > 0 && noteIds.every((id) => bumps.has(id));
  const fromTutor = noteIds.map((id) => bumps.get(id)?.bumped_by_name).find(Boolean);

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy || noteIds.length === 0) return;
    setBusy(true);
    try {
      if (inPocket) {
        if (removable) for (const id of noteIds) await clearBump(id, source);
      } else {
        const out = await bumpNotes(noteIds, source);
        onBumped?.(out.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const text = inPocket
    ? fromTutor ? `⚡ From ${fromTutor}` : '⚡ Today ✓'
    : props.label ?? '⚡ Study today';
  return (
    <button
      type="button"
      className={`bump-btn${compact ? ' bump-btn--compact' : ''}${inPocket ? ' bump-btn--on' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={busy || noteIds.length === 0 || (inPocket && !removable)}
      aria-pressed={inPocket}
      title={inPocket ? (removable ? 'In today’s study — tap to take it out' : 'Comes first in today’s study') : 'Put it first in today’s study'}
    >
      {text}
    </button>
  );
}

/** The small "⚡" badge on a study card from the pocket. */
export function BumpBadge({ fromName }: { fromName?: string | null }) {
  return (
    <span className="bump-badge" title="You bumped this card to the front of today’s study">
      ⚡ {fromName ? `from ${fromName}` : 'Today'}
    </span>
  );
}

/**
 * "⚡ today" for a word by its hanzi (rows that know only the text: Make flashcards'
 * "Already in your decks", Paste a list's "Already in deck"). Renders nothing when
 * the device has no note with that hanzi.
 */
export function BumpByHanzi(props: { hanzi: string; source: BumpSource; label?: string; onBumped?: (message: string) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    findExistingNotes(props.hanzi)
      .then((hits) => live && setIds(hits.map((h) => h.note.id)))
      .catch(() => live && setIds([]));
    return () => {
      live = false;
    };
  }, [props.hanzi]);
  if (ids.length === 0) return null;
  return <BumpButton noteIds={ids} source={props.source} compact label={props.label ?? '⚡ today'} onBumped={props.onBumped} />;
}
