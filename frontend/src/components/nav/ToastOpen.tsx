import { useNavigate } from 'react-router-dom';
import type { ToastOpenLink } from '@shared/decks/open-links';
import { track } from '../../services/analytics';
import { useResultAvailability } from '../claude/ResultLink';
import './toast-open.css';

/**
 * "Open ›" at the end of a toast (docs/STUDY_SESSION.md "Open ›: one tap to what just happened"): the
 * card just added / bumped, the deck of several new cards, or Up next for several bumped words — the
 * target is ONE rule (`addedToDeckOpenLink` / `studyTodayOpenLink`, shared/decks/open-links.ts). A
 * plain navigation, so the browser's back returns to the page he was on. `onOpen` lets a sheet close
 * itself first (the explorer is drawn over every page). Offline with the target not on this device:
 * nothing to show, so no button.
 */
export function ToastOpen({ link, surface, onOpen }: { link: ToastOpenLink | null | undefined; surface: string; onOpen?: () => void }) {
  const navigate = useNavigate();
  const availability = useResultAvailability(link);
  if (!link || availability === 'offline') return null;
  return (
    <button
      type="button"
      className="toast-open"
      aria-label={link.aria}
      data-testid="toast-open"
      data-link-path={link.path}
      onClick={(e) => {
        e.stopPropagation();
        track('nav.toast_open', { kind: link.kind, target: link.target, surface });
        onOpen?.();
        navigate(link.path);
      }}
    >
      {link.label} <span aria-hidden="true">›</span>
    </button>
  );
}

/** "⚡ Listening card of 银行 added to today · Open ›" — a bump's toast with its link. */
export function StudyTodayToast({ message, link, surface, onOpen, className = 'bump-hint' }: { message: string; link?: ToastOpenLink | null; surface: string; onOpen?: () => void; className?: string }) {
  return (
    <div className={`${className} toast-with-open`} role="status" data-testid="study-today-toast">
      <span className="toast-with-open-text">{message}</span>
      <ToastOpen link={link} surface={surface} onOpen={onOpen} />
    </div>
  );
}
