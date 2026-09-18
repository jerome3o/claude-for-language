import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './tutor-dashboard.css';

export interface OverflowMenuItem {
  label: string;
  onClick?: () => void;
  to?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** The ⋯ button with a small dropdown. Closes on outside tap and Escape. */
export function OverflowMenu({ items, label = 'More actions' }: { items: OverflowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="td-menu" ref={ref}>
      <button
        type="button"
        className="td-menu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <ul className="td-menu-list" role="menu">
          {items.map((item, i) =>
            item.to ? (
              <li key={i} role="none">
                <Link to={item.to} role="menuitem" className={`td-menu-item ${item.danger ? 'danger' : ''}`} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              </li>
            ) : (
              <li key={i} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={`td-menu-item ${item.danger ? 'danger' : ''}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick?.();
                  }}
                >
                  {item.label}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
