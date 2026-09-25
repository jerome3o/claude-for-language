import { useState } from 'react';
import type { QueueMove } from '@shared/decks';

/**
 * The "#N" queue badge with its Move to top / up / down / bottom menu — the
 * same control on the student's Decks tab and on the tutor's homework rows.
 * The wrapper is positioned so the menu drops below the badge; `onOpenChange`
 * lets a positioned parent lift itself above its siblings while open.
 */
export function QueuePositionMenu({
  position,
  total,
  onMove,
  onOpenChange,
  label = 'the queue',
}: {
  /** 1-based place; first = studied first. */
  position: number;
  total: number;
  onMove: (to: QueueMove) => void;
  onOpenChange?: (open: boolean) => void;
  /** Whose queue, for the tooltip ("their queue"). */
  label?: string;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  const first = position === 1;

  return (
    <span style={{ position: 'relative', display: 'inline-block', zIndex: open ? 20 : undefined }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        style={{
          background: first ? '#fee2e2' : '#f3f4f6', border: 'none', cursor: 'pointer',
          padding: '0.125rem 0.375rem', fontSize: '0.7rem', fontWeight: 700, borderRadius: '999px',
          color: first ? '#b91c1c' : '#4b5563', lineHeight: 1.4, minHeight: 'unset', minWidth: '2rem',
        }}
        title={`${first ? 'Studied first' : `${position} of ${total} in ${label}`} — tap to move`}
        aria-label={`Queue position ${position} of ${total}. Reorder`}
        aria-expanded={open}
        data-testid="queue-position"
      >
        #{position}
      </button>
      {open && (
        <div role="menu" className="deck-queue-menu" style={{
          position: 'absolute', top: '1.5rem', right: 0, zIndex: 5,
          background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: '0.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', minWidth: '10rem',
        }}>
          {([['top', '⤒ Move to top'], ['up', '↑ Move up'], ['down', '↓ Move down'], ['bottom', '⤓ Move to bottom']] as const).map(([to, text]) => {
            const disabled = (to === 'top' || to === 'up') ? first : position === total;
            return (
              <button key={to} type="button" role="menuitem" disabled={disabled}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onMove(to); }}
                style={{ background: 'none', border: 'none', textAlign: 'left', padding: '0.625rem 0.875rem', fontSize: '0.875rem', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, minHeight: '44px', color: 'inherit' }}>
                {text}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
