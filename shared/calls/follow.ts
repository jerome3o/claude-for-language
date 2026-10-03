/**
 * Round 5 (Minghui, 3 Oct 2026): the tutor leads the student's screen.
 *
 * - **Show for student** — the tutor puts what is on her stage (the text board on
 *   a page, the drawing board, a material page, her shared screen, an activity) on
 *   the student's stage, with a quiet "Minghui is showing you this" banner. Opening
 *   the board does it without the button. The room holds the latest `ShownState`
 *   (server-authoritative: a reconnect gets it in `welcome`), the student's device
 *   applies each NEW show once (`followStep`) — after that their own layout choice
 *   wins until the tutor shows something new. Page turns on a shown board page are
 *   followed while the student is still looking at the board.
 * - **Stop their share** — the relationship's tutor can stop the student's screen
 *   share; never the other way round (`canStopShare`, enforced by the room).
 *
 * Pure rules, used by the CallRoom, the web call page and the Lab app
 * (`core/…/calls/CallFollow.kt`, parity-tested).
 */

import type { TileId } from './layout';

/** What the tutor shows. `text` carries the board page she is on. */
export type ShowView =
  | { kind: 'text'; page?: string }
  | { kind: 'draw' }
  | { kind: 'material' }
  | { kind: 'screen' }
  | { kind: 'activity' };

export type ShowKind = ShowView['kind'];
export const SHOW_KINDS: ShowKind[] = ['text', 'draw', 'material', 'screen', 'activity'];

/** The room's record of the latest show. `id` changes when something NEW is shown; `v` counts follow-ups (page turns). */
export interface ShownState {
  id: string;
  v: number;
  /** The tutor's user id and name. */
  by: string;
  name: string;
  view: ShowView;
  at: number;
}

/** A client's `show` message, cleaned (null = refused). */
export function sanitizeShowView(raw: unknown): ShowView | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !(SHOW_KINDS as string[]).includes(kind)) return null;
  if (kind === 'text') {
    const page = (raw as { page?: unknown }).page;
    return typeof page === 'string' && page.length > 0 && page.length <= 64 ? { kind: 'text', page } : { kind: 'text' };
  }
  return { kind } as ShowView;
}

/** The stage tile a view lives in. */
export function tileForShow(view: ShowView): TileId {
  return view.kind;
}

/** Only the relationship's tutor leads (never in a solo call, never the student). */
export function canShow(senderId: string, tutorId: string | null): boolean {
  return !!tutorId && senderId === tutorId;
}

/** The tutor may stop the OTHER person's screen share; the student may stop nobody's. */
export function canStopShare(senderId: string, tutorId: string | null, targetId: string): boolean {
  return canShow(senderId, tutorId) && targetId !== senderId;
}

/**
 * The room's next state for a `show`. `follow` = an automatic follow-up of what is
 * already shown (her board page turned): the same id, `v` + 1 — but only when the
 * kind is the same; anything else (and every press of the button) is a new show.
 */
export function nextShown(
  cur: ShownState | null,
  view: ShowView,
  by: { userId: string; name: string },
  follow: boolean,
  now: number,
  newId: () => string,
): ShownState {
  if (follow && cur && cur.view.kind === view.kind && cur.by === by.userId) {
    return { ...cur, v: cur.v + 1, view, at: now };
  }
  return { id: newId(), v: 1, by: by.userId, name: by.name, view, at: now };
}

/** The last show this device acted on. */
export interface AppliedShow {
  id: string;
  v: number;
}

export type FollowStep =
  /** Nothing to do (already applied, or not mine to follow, or the tile isn't there). */
  | { kind: 'none' }
  /** A new show: put `tile` on the stage (and open `page` for the board), show the banner. */
  | { kind: 'stage'; tile: TileId; page: string | null }
  /** A page turn on the board page already shown, while I'm on the board: just open the page. */
  | { kind: 'page'; page: string };

/**
 * What the student's device does with the room's `shown` (from `welcome` or a
 * `shown` message). `myId`: me — the tutor's own device never follows itself.
 * `available`: the tile exists on my side now (a material presented, a share
 * running, an activity open; the boards always). `onTile`: the shown tile is on my
 * stage now (decides whether a page turn is followed).
 */
export function followStep(
  applied: AppliedShow | null,
  shown: ShownState | null,
  myId: string,
  available: boolean,
  onTile: boolean,
): FollowStep {
  if (!shown || shown.by === myId) return { kind: 'none' };
  const page = shown.view.kind === 'text' ? shown.view.page ?? null : null;
  if (!applied || applied.id !== shown.id) {
    return available ? { kind: 'stage', tile: tileForShow(shown.view), page } : { kind: 'none' };
  }
  if (shown.v > applied.v && page && onTile) return { kind: 'page', page };
  return { kind: 'none' };
}

/** The banner on the student's stage. */
export function showingBanner(name: string): string {
  return `${name.trim() || 'Your tutor'} is showing you this`;
}

/** The note on the student's screen when the tutor stops their share. */
export function shareStoppedNote(name: string): string {
  return `${name.trim() || 'Your tutor'} stopped your screen share`;
}

/** The tutor's corner button and its done state. */
export const SHOW_BUTTON_LABEL = 'Show for student';
export const SHOWN_BUTTON_LABEL = 'Showing ✓';
/** The control on the student's screen tile (tutor only). */
export const STOP_THEIR_SHARE_LABEL = 'Stop their share';

/**
 * Does the tutor's corner button read "Showing ✓" for this tile? Yes while the
 * latest show is hers, of this kind (and, for the board, the same page).
 */
export function isShowing(shown: ShownState | null, myId: string, view: ShowView): boolean {
  if (!shown || shown.by !== myId || shown.view.kind !== view.kind) return false;
  if (view.kind === 'text' && shown.view.kind === 'text') return (shown.view.page ?? null) === (view.page ?? null);
  return true;
}

/**
 * Opening the board shows it to the student without the button: true when a
 * board tile (text / draw) has just come onto the tutor's stage.
 */
export function autoShowBoard(wasOnStage: TileId[], nowOnStage: TileId[]): ShowKind | null {
  for (const t of ['text', 'draw'] as const) if (nowOnStage.includes(t) && !wasOnStage.includes(t)) return t;
  return null;
}
