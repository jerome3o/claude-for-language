/**
 * Peek: on a revealed card, a tap on the card's empty space turns it back to the
 * question, and a tap on the question turns it to the answer again. It is a view-only
 * flip — nothing is re-checked, played or recorded, and the ratings stay up.
 *
 * `isPeekTap` decides whether a click counts: it must land inside the card (not in a
 * portal or popup React bubbles up to it), not on anything that has its own tap
 * (buttons, links, fields, tappable characters, the answer diff, notes, sentence rows),
 * not end a drag or a long press, and not finish a text selection.
 * The Lab app's CardStage.kt (`peek`, `keepTaps`) follows the same rule.
 */

/** Anything matching this (inside the card) keeps its taps — tapping it never peeks. */
export const PEEK_IGNORE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  'audio',
  'video',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="dialog"]',
  '[data-no-peek]',
  '.hanzi-char-clickable',
  '.rp-chunk',
  '.answer-diff',
  '.transcription-result',
  '.study-tutor-notes',
  '.study-fun-fact',
  '.sentence-set-row',
  '.word-definition-popup',
].join(', ');

/** A press that moved further than this is a drag / scroll, not a tap. */
export const PEEK_MAX_MOVE_PX = 10;
/** A press held longer than this is a long press, not a tap. */
export const PEEK_MAX_PRESS_MS = 500;

export interface PressPoint {
  x: number;
  y: number;
  /** Milliseconds (event timeStamp or Date.now — the same clock for down and up). */
  t: number;
}

export interface PeekTapInput {
  /** The click's target. */
  target: EventTarget | null;
  /** The card element the handler sits on. */
  container: Element;
  /** Where / when the pointer went down (null when unknown: keyboard / synthetic click). */
  down: PressPoint | null;
  /** Where / when the click came. */
  up: PressPoint;
  /** Text currently selected on the page (`window.getSelection()?.toString()`). */
  selection?: string;
}

/** Is this click a tap on the card's empty space? */
export function isPeekTap({ target, container, down, up, selection }: PeekTapInput): boolean {
  if (!target || !(target instanceof Element)) return false;
  // React bubbles events out of portals; only real DOM descendants of the card count.
  if (!container.contains(target)) return false;
  const own = target.closest(PEEK_IGNORE_SELECTOR);
  if (own && container.contains(own)) return false;
  if (selection && selection.trim().length > 0) return false;
  if (down) {
    if (Math.hypot(up.x - down.x, up.y - down.y) > PEEK_MAX_MOVE_PX) return false;
    if (up.t - down.t > PEEK_MAX_PRESS_MS) return false;
  }
  return true;
}
