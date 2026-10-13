import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const FLASH_CLASS = 'section-flash';
const FLASH_MS = 2400;

/**
 * Scrolls a section into view and flashes it briefly, so a link to it shows where you landed.
 * Returns false when the element isn't on the page (yet).
 */
export function focusSection(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.classList.remove(FLASH_CLASS);
  // Restart the animation when the same section is asked for twice.
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);
  window.setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_MS);
  return true;
}

/**
 * `/connections/:relId#homework`: React Router doesn't scroll to a hash, so a page with
 * sections calls this once its content is there (`ready`). Every navigation to the hash
 * (location.key) scrolls again — tapping the dashboard's homework pill twice lands twice.
 * Returns `focusSection` for in-page links ("See all ›" → the Homework section).
 */
export function useScrollToHash(ready: boolean): (id: string) => void {
  const location = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!ready || !id) return;
    // A frame for the section to render after `ready` flips.
    const t = window.setTimeout(() => focusSection(id), 50);
    return () => window.clearTimeout(t);
  }, [ready, location.hash, location.key]);
  return useCallback((id: string) => { focusSection(id); }, []);
}
