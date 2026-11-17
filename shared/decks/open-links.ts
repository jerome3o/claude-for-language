/**
 * "Open ›" on a toast (docs/STUDY_SESSION.md "Open ›: one tap to what just happened"): when something
 * happens around the app, ONE tap takes him to it and back returns him to where he was — the same idea
 * as the lines under a Claude reply (`toolResultLink`, shared/claude/cardTools.ts), for the app's own
 * toasts:
 *
 * | Toast | Opens |
 * |---|---|
 * | ✓ Added to From readers · Change (one card) | that card's hub `/cards/:noteId` |
 * | ✓ 3 cards added to From chats · Change | the deck `/decks/:deckId` |
 * | ⚡ Listening card of 银行 added to today (one word) | its card hub |
 * | ⚡ 银行 and 学生 added to today (several words) | Up next `/up-next` (its "⚡ Today" list) |
 *
 * `path` is the app path (the web route; the Lab app navigates by the same paths). Nothing to open (no
 * note id, nothing added) = null: the toast stays plain. Ported to android-lab/core (OpenLinks.kt),
 * parity-tested in parity/fixtures/study-today.ts.
 */

export interface ToastOpenLink {
  /** What the toast was (analytics `nav.toast_open.kind`). */
  kind: 'added' | 'bumped';
  /** What it opens. */
  target: 'card' | 'deck' | 'up_next';
  /** The note / deck id (null for Up next). */
  id: string | null;
  path: string;
  /** The affordance's words, drawn with "›". */
  label: string;
  /** The button's accessible name. */
  aria: string;
}

/** The toast's affordance (short: the toast stays calm). */
export const TOAST_OPEN_LABEL = 'Open';

const enc = (s: string) => encodeURIComponent(s);
const clean = (ids: ReadonlyArray<string | null | undefined>): string[] => {
  const out: string[] = [];
  for (const raw of ids) {
    const id = (raw ?? '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
};

/**
 * "✓ Added to <deck> · Change" → the card (one note) or the deck (several). [hanzi] names the one card
 * in the button's accessible name.
 */
export function addedToDeckOpenLink(added: { noteIds: ReadonlyArray<string | null | undefined>; deckId?: string | null; deckName?: string | null; hanzi?: string | null }): ToastOpenLink | null {
  const ids = clean(added.noteIds);
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const what = (added.hanzi ?? '').trim();
    return { kind: 'added', target: 'card', id: ids[0], path: `/cards/${enc(ids[0])}`, label: TOAST_OPEN_LABEL, aria: `Open the card${what ? ` ${what}` : ''}` };
  }
  const deckId = (added.deckId ?? '').trim();
  if (!deckId) return null;
  const name = (added.deckName ?? '').trim();
  return { kind: 'added', target: 'deck', id: deckId, path: `/decks/${enc(deckId)}`, label: TOAST_OPEN_LABEL, aria: `Open the deck${name ? ` ${name}` : ''} with the new cards` };
}

/**
 * "⚡ … added to today" → the card (one word) or Up next's "⚡ Today" list (several). [notes] = the words
 * the tap put in today (`added`; words already there count too when nothing new went in).
 */
export function studyTodayOpenLink(notes: ReadonlyArray<{ noteId: string | null | undefined; hanzi?: string | null }>): ToastOpenLink | null {
  const ids = clean(notes.map((n) => n.noteId));
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const what = (notes.find((n) => (n.noteId ?? '').trim() === ids[0])?.hanzi ?? '').trim();
    return { kind: 'bumped', target: 'card', id: ids[0], path: `/cards/${enc(ids[0])}`, label: TOAST_OPEN_LABEL, aria: `Open the card${what ? ` ${what}` : ''}` };
  }
  return { kind: 'bumped', target: 'up_next', id: null, path: '/up-next', label: TOAST_OPEN_LABEL, aria: 'See today’s study list' };
}
