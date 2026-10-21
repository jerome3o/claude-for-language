/**
 * The study card's deck pill: "📚 <deck name>" on one line, cut with an ellipsis so a long name
 * ("课堂生词 Lesson words – 12 Oct (from tutor)") never crowds the card. A tap opens a small
 * popover with the FULL name and "Open deck →"; a tap anywhere else or Escape closes it.
 *
 * It is shown on the ANSWER side only — a small, muted line under the meaning / word tags (on the
 * question side the deck name could hint the answer). It stops its clicks / pointer presses, so a
 * tap on it never peeks back at the question (Lab app: ui/study/DeckPill.kt).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { track } from '../../services/analytics';

export interface DeckPillProps {
  name: string;
  /** "Open deck →" in the popover; left out = no link. */
  onOpenDeck?: () => void;
  /** Analytics: where the card is shown (homework | tutor_notes); unset = the study session. */
  where?: string;
}

export function DeckPill({ name, onOpenDeck, where }: DeckPillProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const props = where ? { where } : {};

  return (
    <span className="deck-pill-wrap" ref={wrapRef} onClick={stop} onPointerDown={stop} data-testid="study-deck-pill-wrap">
      <button
        type="button"
        className={`deck-pill${open ? ' deck-pill--open' : ''}`}
        aria-label={`Deck: ${name}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        title={name}
        data-testid="study-deck-pill"
        onClick={() => {
          if (!open) track('study.deck_pill', { action: 'expand', ...props });
          setOpen(!open);
        }}
      >
        <span className="deck-pill__body">
          <span className="deck-pill__icon" aria-hidden="true">📚</span>
          <span className="deck-pill__name" data-testid="study-deck-pill-label">{name}</span>
        </span>
      </button>
      {open && (
        <span className="deck-pill-pop" id={popId} role="dialog" aria-label="Deck" data-testid="study-deck-pill-full">
          <span className="deck-pill-pop__label">Deck</span>
          <span className="deck-pill-pop__name" data-testid="study-deck-pill-name">{name}</span>
          {onOpenDeck && (
            <button
              type="button"
              className="deck-pill-pop__open"
              data-testid="study-deck-pill-open"
              onClick={() => {
                track('study.deck_pill', { action: 'open_deck', ...props });
                setOpen(false);
                onOpenDeck();
              }}
            >
              Open deck →
            </button>
          )}
        </span>
      )}
    </span>
  );
}
