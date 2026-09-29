/**
 * Where the draggable feedback button may sit. Pure; unit-tested.
 *
 * The top strip of every screen holds its controls — the header's buttons,
 * and on the full-screen study / lesson / preview screens the ✕ close button
 * at the top right. A position saved up there (the button is draggable and
 * remembers where it was dropped) would cover them, so it is shown just below
 * that strip instead; the saved position itself is kept.
 */

export const FAB_SIZE = 48;
/** Height of the top bar strip the button must stay out of (incl. a little air). */
export const FAB_TOP_CLEARANCE = 72;

export function clampFabPosition(
  pos: { x: number; y: number },
  viewport: { width: number; height: number },
  size = FAB_SIZE,
  topClearance = FAB_TOP_CLEARANCE,
): { x: number; y: number } {
  const maxX = Math.max(0, viewport.width - size);
  const maxY = Math.max(0, viewport.height - size);
  return {
    x: Math.min(Math.max(pos.x, 0), maxX),
    y: Math.min(Math.max(pos.y, Math.min(topClearance, maxY)), maxY),
  };
}

/**
 * The editors (lesson / library / reader) have their own Edit · Preview · Claude
 * bar along the bottom on phones (EditorShell, < 1024px): the button's default
 * spot is lifted above it, as it is above the app's tab bar.
 */
export function hasEditorBottomBar(pathname: string, viewportWidth: number): boolean {
  return viewportWidth < 1024 && /^\/(lessons|library|readers)\/[^/]+\/edit\/?$/.test(pathname);
}

/** Screens where a lesson / card fills the page: the button is kept faint there. */
export function isStudyLikePath(pathname: string): boolean {
  return pathname === '/study'
    || pathname === '/tutor-notes/practice'
    || /^\/(decks|library)\/[^/]+\/try\/?$/.test(pathname)
    || /^\/library\/catalogue\/[^/]+\/?$/.test(pathname);
}
