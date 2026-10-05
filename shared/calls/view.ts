/**
 * "Same view" (Jerome after a lesson with Minghui, 5 Oct 2026): "whatever the
 * tutor clicks into, the student's screen follows — layouts too — and the other
 * way round. Both people see the same thing, even screen shares."
 *
 * The call's STAGE is shared: which tile(s) are on it and how (focus / split /
 * grid, the split's ratio and direction, which boards / chat are open) and the
 * text board's page. The CallRoom holds the latest `SharedView` (in storage, so a
 * reconnect gets it in `welcome.view`); either person changing their stage sends
 * it and both screens apply it — last change wins (the room orders them).
 *
 * Per-device things stay per device: the faces box / floating cameras (corner,
 * size, together / separate, float their camera), and the pixel rectangles —
 * `layoutRects` maps the same logical layout onto each screen (a phone shows a
 * split's first tile unless it is screen + board).
 *
 * `remote` / `self` are relative: `remote` on the stage means "the other person"
 * on both screens (Speaker shows each of them the other).
 *
 * The way out: "My own view" (per person) — nothing is sent and nothing of the
 * other person's is applied; "Same view" again joins the shared view. "Bring
 * <name> to my view" publishes my view with `bring`: someone on Same view simply
 * follows; someone on their own view gets an invitation (never forced).
 *
 * Pure rules for the CallRoom, the web call page and the Lab app
 * (`core/…/calls/CallView.kt`, parity-tested). Replaces round 5's one-shot
 * "Show for student" (follow.ts keeps the room's backwards-compatible `show`).
 */

import { ALL_TILES, DEFAULT_LAYOUT, MAX_RATIO, MIN_RATIO, type CallLayout, type LayoutMode, type TileId } from './layout';
import { tileForShow, type ShowView } from './follow';

/** The shared part of a layout: the stage, and the text board's page. */
export interface StageView {
  mode: LayoutMode;
  main: TileId;
  second: TileId;
  ratio: number;
  dir: 'row' | 'column';
  /** The boards / chat that are open (cameras always). */
  open: TileId[];
  /** The text board page (null = not known / leave mine as is). */
  page: string | null;
}

/** The room's record of the shared view. `seq` counts changes; `cid` is the sender's id for this change. */
export interface SharedView extends StageView {
  seq: number;
  /** Who changed it last (user id, display name). */
  by: string;
  name: string;
  cid: string;
  at: number;
  /** Sent with "Bring <name> to my view": someone on their own view is invited to join it. */
  bring?: boolean;
}

/** Per person: following the shared view, or looking around privately. */
export type ViewMode = 'same' | 'own';

const MODES: LayoutMode[] = ['focus', 'split', 'grid'];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The shared part of my layout. */
export function viewOf(l: CallLayout, page: string | null): StageView {
  return {
    mode: l.mode,
    main: l.main,
    second: l.second,
    ratio: round3(l.ratio),
    dir: l.dir,
    open: ALL_TILES.filter((t) => l.open.includes(t)),
    page: page || null,
  };
}

/** My layout with the shared view applied: every per-device field (cameras, faces box, floating) kept. */
export function applyView(l: CallLayout, v: StageView): CallLayout {
  const open = ALL_TILES.filter((t) => t === 'remote' || t === 'self' || v.open.includes(t));
  return { ...l, mode: v.mode, main: v.main, second: v.second, ratio: clamp(v.ratio, MIN_RATIO, MAX_RATIO), dir: v.dir, open };
}

/** Do two views put the same thing on the stage? (`page`: null on either side is "no opinion".) */
export function sameStage(a: StageView, b: StageView): boolean {
  if (a.mode !== b.mode || a.dir !== b.dir || Math.abs(a.ratio - b.ratio) > 0.005) return false;
  if (a.open.length !== b.open.length || a.open.some((t) => !b.open.includes(t))) return false;
  if (a.page && b.page && a.page !== b.page) return false;
  if (a.mode === 'grid') return true;
  if (a.main !== b.main) return false;
  return a.mode === 'focus' || a.second === b.second;
}

/** A client's view, cleaned (null = refused). */
export function sanitizeStageView(raw: unknown): StageView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tile = (v: unknown): TileId | null => (ALL_TILES.includes(v as TileId) ? (v as TileId) : null);
  const mode = MODES.includes(r.mode as LayoutMode) ? (r.mode as LayoutMode) : null;
  const main = tile(r.main);
  const second = tile(r.second) ?? 'text';
  if (!mode || !main) return null;
  const ratio = typeof r.ratio === 'number' && Number.isFinite(r.ratio) ? round3(clamp(r.ratio, MIN_RATIO, MAX_RATIO)) : 0.62;
  const open = Array.isArray(r.open) ? ALL_TILES.filter((t) => (r.open as unknown[]).includes(t)) : ['remote', 'self'];
  const page = typeof r.page === 'string' && r.page.length > 0 && r.page.length <= 64 ? r.page : null;
  return { mode, main, second, ratio, dir: r.dir === 'column' ? 'column' : 'row', open: ALL_TILES.filter((t) => t === 'remote' || t === 'self' || open.includes(t)), page };
}

/** The room's next shared view after someone sends `view`. A missing page keeps the current one. */
export function nextSharedView(
  cur: SharedView | null,
  view: StageView,
  by: { userId: string; name: string },
  cid: string,
  bring: boolean,
  now: number,
): SharedView {
  const next: SharedView = { ...view, page: view.page ?? cur?.page ?? null, seq: (cur?.seq ?? 0) + 1, by: by.userId, name: by.name, cid: cid.slice(0, 64), at: now };
  if (bring) next.bring = true;
  return next;
}

/**
 * An older app's "Show for student" (`show`, round 5) becomes a change of the shared
 * view: that tile focused on the stage (the board on its page), everything else kept.
 */
export function viewForShow(cur: StageView | null, show: ShowView): StageView {
  const base = cur ?? viewOf(DEFAULT_LAYOUT, null);
  const tile = tileForShow(show);
  const open = ALL_TILES.filter((t) => base.open.includes(t) || t === tile);
  const page = show.kind === 'text' ? show.page ?? base.page : base.page;
  return { ...base, mode: 'focus', main: tile, open, page };
}

/**
 * What this device does with the room's view (from `welcome` or a `view` message):
 * - `apply` — put it on my stage (I'm on Same view). My OWN change comes back too
 *   and is applied only if it is the last one I sent — an older echo would undo a
 *   newer local change for a moment; another person's change always applies, so
 *   two near-simultaneous changes end the same on both screens (the room's order).
 * - `invite` — I'm on my own view and they asked me to come ("Bring … to my view").
 * - `skip` — nothing to do.
 */
export function viewStep(view: SharedView | null, opts: { myId: string; lastSentCid: string | null; mode: ViewMode; appliedSeq: number }): 'apply' | 'invite' | 'skip' {
  if (!view || view.seq <= opts.appliedSeq) return 'skip';
  const mine = view.by === opts.myId;
  if (opts.mode === 'own') return !mine && view.bring ? 'invite' : 'skip';
  if (mine && view.cid !== opts.lastSentCid) return 'skip';
  return 'apply';
}

/** Should a change of my stage go out? Only on Same view, and only when it differs from the view I last applied / sent. */
export function shouldSendView(mode: ViewMode, known: StageView | null, mine: StageView): boolean {
  return mode === 'same' && (!known || !sameStage(known, mine));
}

// ------------------------------------------------------------------ words

export const SAME_VIEW_LABEL = 'Same view';
export const OWN_VIEW_LABEL = 'My own view';
const first = (name: string, fallback: string) => name.trim().split(/\s+/)[0] || fallback;

/** The view chip in the call's top bar. */
export function viewChipLabel(mode: ViewMode): string {
  return mode === 'same' ? `👥 ${SAME_VIEW_LABEL} ✓` : `👤 ${OWN_VIEW_LABEL}`;
}

export function sameViewHint(name: string): string {
  return `You and ${first(name, 'the other person')} see the same thing — either of you can change it.`;
}

export function ownViewHint(name: string): string {
  return `Look around without moving ${first(name, 'the other person')}’s screen.`;
}

export function bringLabel(name: string): string {
  return `Bring ${first(name, 'them')} to my view`;
}

/** The pill on my screen when they "bring" me while I'm on my own view. */
export function inviteText(name: string): string {
  return `${first(name, 'The other person')} wants you to see their view`;
}

/** Shown while the other person is on their own view. */
export function theyLookAroundText(name: string): string {
  return `${first(name, 'The other person')} is looking around on their own`;
}

/**
 * Both people pressing 📝 when the tutor says "open the board" must not open it and
 * close it again: a toggle pressed within this long of the other person putting that
 * tile on the shared stage keeps it there.
 */
export const JUST_SHARED_MS = 3000;

/** The last view the other person put on my stage: when, and the tiles it brought on. */
export interface TheirLastView {
  at: number;
  tiles: TileId[];
}

/** Should a toggle that would take `tile` OFF the stage do nothing (they just put it there)? */
export function keepJustShared(theirs: TheirLastView | null, tile: TileId, now: number): boolean {
  return !!theirs && now - theirs.at < JUST_SHARED_MS && theirs.tiles.includes(tile);
}

/** What the other person's view brought onto my stage (tiles that weren't on it before), at `now`. */
export function theirLastView(before: StageView, after: StageView, now: number): TheirLastView {
  const was = stageTilesOf(before);
  return { at: now, tiles: stageTilesOf(after).filter((t) => !was.includes(t)) };
}

/** The tiles a view puts on the stage (focus: one, split: two, grid: what is open). */
export function stageTilesOf(v: StageView): TileId[] {
  return v.mode === 'grid' ? v.open : v.mode === 'split' ? [v.main, v.second] : [v.main];
}
