import { useEffect } from 'react';

/** One row in the ⋯ sheet. */
export interface StudyMenuItem {
  key: string;
  label: string;
  icon?: string;
  /** Small right-aligned text, e.g. "Needs internet" */
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
}

/**
 * The card's ⋯ menu: a bottom sheet (thumb reach on a phone) holding every
 * secondary action that used to sit on the card back — edit, fun fact,
 * regenerate audio, new voice, roleplay, debug — plus the "Added <date>"
 * line as a footer. Nothing was removed from the card; it moved here so the
 * back can be read at a glance.
 */
export function StudyMoreMenu({
  open,
  items,
  footer,
  onClose,
}: {
  open: boolean;
  items: StudyMenuItem[];
  footer?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="study-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="study-sheet" role="menu" aria-label="More card actions" data-testid="study-more-menu">
        <div className="study-sheet-grip" aria-hidden="true" />
        {items.map((item) => (
          <button
            key={item.key}
            role="menuitem"
            className="study-sheet-item"
            disabled={item.disabled || item.busy}
            title={item.hint}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon && <span className="study-sheet-icon" aria-hidden="true">{item.icon}</span>}
            <span className="study-sheet-label">{item.busy ? `${item.label}…` : item.label}</span>
            {item.hint && <span className="study-sheet-hint">{item.hint}</span>}
          </button>
        ))}
        {footer && <div className="study-sheet-footer">{footer}</div>}
      </div>
    </>
  );
}
