import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../services/analytics';
import { useNoteImageUrl } from '../../services/noteImages';
import './noteImage.css';

/**
 * A note's picture (shared/cards/note-image.ts): modest on the card — at most about a quarter of
 * the screen's height, so the answer row never leaves the folded Pixel's screen — and tap to see it
 * big. Shows nothing when there is no picture, or offline before it was downloaded.
 */
export function NoteImage({
  imageKey,
  variant = 'card',
  side,
  cardType,
  className,
  testId,
}: {
  imageKey: string | null | undefined;
  /** card = on a study card, thumb = a deck row, preview = the edit sheet / card hub. */
  variant?: 'card' | 'thumb' | 'preview';
  side?: 'front' | 'back';
  cardType?: string;
  className?: string;
  testId?: string;
}) {
  const url = useNoteImageUrl(imageKey);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!url) return null;
  const img = <img src={url} alt="Picture for this card" draggable={false} />;
  if (variant === 'thumb') {
    return <span className={`note-image note-image--thumb ${className ?? ''}`} data-testid={testId}>{img}</span>;
  }
  return (
    <>
      <button
        type="button"
        className={`note-image note-image--${variant} ${className ?? ''}`}
        data-testid={testId}
        aria-label="Picture — tap to see it big"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
          if (side) track('card.picture_open', { side, card_type: cardType });
        }}
      >
        {img}
      </button>
      {open && createPortal(
        <div className="note-image-lightbox" role="dialog" aria-modal="true" aria-label="Picture" onClick={() => setOpen(false)} data-testid="note-image-lightbox">
          <img src={url} alt="Picture for this card" />
          <button type="button" className="note-image-lightbox-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>,
        document.body,
      )}
    </>
  );
}
