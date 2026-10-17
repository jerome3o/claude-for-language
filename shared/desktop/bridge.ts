/**
 * The desktop app (desktop/, Electron) and the web page it shows talk through
 * ONE small bridge, `window.desktopBridge` (desktop/src/preload.ts exposes it
 * with contextBridge; nothing else of Node / Electron reaches the page). This
 * file is the contract both sides compile against, plus the pure rules they
 * share — what may cross the bridge, where a point on the shared screen lands
 * on the overlay window, the desktop sign-in round trip and the update check.
 *
 * The overlay: when the tutor shares a whole SCREEN from the desktop app, a
 * transparent, always-on-top, click-through window covers that display and
 * draws the call's annotations (both people's strokes, texts and pings, with
 * the same keep / fade rules — shared/calls/annotate.ts) on her real screen.
 * Her own strokes drawn on the overlay go back through the bridge into the
 * call's ordinary `annot*` messages, so the student sees them on the shared
 * video exactly as if she had drawn in the call window. The overlay is hidden
 * from screen capture, so the student never sees a stroke twice.
 */

import {
  sanitizeAnnotStroke,
  sanitizeAnnotText,
  sanitizePing,
  type AnnotPing,
  type AnnotPoint,
  type AnnotStroke,
  type AnnotText,
  type ShownStroke,
  type ShownText,
} from '../calls/annotate';

/** `/api/auth/login?client=desktop&nonce=…` → the worker redirects to this scheme (worker NATIVE_AUTH_CLIENTS). */
export const DESKTOP_AUTH_CLIENT = 'desktop';
export const DESKTOP_AUTH_SCHEME = 'chineselearning-desktop';
export const DESKTOP_AUTH_REDIRECT = `${DESKTOP_AUTH_SCHEME}://auth`;
/** GitHub pre-releases of the desktop app are tagged `desktop-v0.N`. */
export const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';

export type SharedSourceKind = 'screen' | 'window';

/** What the tutor picked in the desktop app's share picker. */
export interface SharedSource {
  kind: SharedSourceKind;
  /** The display a SCREEN source shows (Electron `Display.id` as a string); null for a window. */
  displayId: string | null;
  name: string;
}

/** Everything the overlay draws: the page's annotation store, copied (local clock — same machine). */
export interface OverlaySnapshot {
  strokes: ShownStroke[];
  texts: ShownText[];
  pings: AnnotPing[];
  persist: boolean;
  /** The colour her overlay pen starts with (the sharer's colour). */
  color: string;
}

/** What the overlay sends back to the page. */
export type OverlayEvent =
  | { kind: 'stroke'; stroke: AnnotStroke }
  | { kind: 'ping'; x: number; y: number }
  | { kind: 'text'; text: AnnotText }
  | { kind: 'clear' }
  /** Draw mode switched on the overlay itself (its toolbar / Esc). */
  | { kind: 'draw_mode'; on: boolean };

/**
 * `window.desktopBridge` — present only inside the desktop app. Every method
 * is fire-and-forget or a promise; listeners return an unsubscribe function.
 */
export interface DesktopBridge {
  isDesktop: true;
  /** The app's version, e.g. "0.12.0". */
  version: string;
  platform: 'darwin' | 'win32' | 'linux' | string;
  /**
   * This build signs in by itself with the one-time code exchange (desktop/src/auth.ts) and
   * hands the session to the page; the page then ignores a `?session_token=` in its URL.
   * Missing on builds before it (they still load the page with `?session_token=`).
   */
  signsInWithCode?: boolean;
  /** The source the last getDisplayMedia() call was answered with (null when none / cancelled). */
  lastSharedSource(): Promise<SharedSource | null>;
  overlay: {
    show(displayId: string): Promise<boolean>;
    hide(): void;
    /** The annotations to draw (sent on every change, throttled by the page). */
    annotations(snapshot: OverlaySnapshot): void;
    /** On = the overlay takes the mouse (draw / type on the real screen); off = clicks pass through. */
    setDrawMode(on: boolean): void;
    onEvent(listener: (event: OverlayEvent) => void): () => void;
  };
}

export function getDesktopBridge(win: unknown = (globalThis as { window?: unknown }).window): DesktopBridge | null {
  const b = (win as { desktopBridge?: DesktopBridge } | undefined)?.desktopBridge;
  return b && b.isDesktop === true && typeof b.overlay?.show === 'function' ? b : null;
}

// ------------------------------------------------------------------ what may cross the bridge

/** An overlay event off IPC, cleaned with the same rules the call room uses (null = drop it). */
export function parseOverlayEvent(raw: unknown): OverlayEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  switch (e.kind) {
    case 'stroke': {
      const stroke = sanitizeAnnotStroke(e.stroke);
      return stroke ? { kind: 'stroke', stroke } : null;
    }
    case 'ping': {
      const p = sanitizePing(e);
      return p ? { kind: 'ping', x: p.x, y: p.y } : null;
    }
    case 'text': {
      const text = sanitizeAnnotText(e.text);
      return text ? { kind: 'text', text } : null;
    }
    case 'clear':
      return { kind: 'clear' };
    case 'draw_mode':
      return typeof e.on === 'boolean' ? { kind: 'draw_mode', on: e.on } : null;
    default:
      return null;
  }
}

const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A snapshot off IPC (the overlay window trusts nothing): bad items are dropped, not the whole snapshot. */
export function sanitizeSnapshot(raw: unknown): OverlaySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const strokes: ShownStroke[] = [];
  for (const item of Array.isArray(s.strokes) ? s.strokes.slice(0, 400) : []) {
    const clean = sanitizeAnnotStroke(item);
    if (!clean) continue;
    const it = item as Record<string, unknown>;
    strokes.push({ ...clean, from: typeof it.from === 'string' ? it.from.slice(0, 64) : '', doneAt: finiteOrNull(it.doneAt) });
  }
  const texts: ShownText[] = [];
  for (const item of Array.isArray(s.texts) ? s.texts.slice(0, 200) : []) {
    const clean = sanitizeAnnotText(item);
    if (!clean) continue;
    const it = item as Record<string, unknown>;
    texts.push({ ...clean, from: typeof it.from === 'string' ? it.from.slice(0, 64) : '', doneAt: finiteOrNull(it.doneAt) });
  }
  const pings: AnnotPing[] = [];
  for (const item of Array.isArray(s.pings) ? s.pings.slice(0, 50) : []) {
    const p = sanitizePing(item);
    const it = item as Record<string, unknown>;
    const at = finiteOrNull(it?.at);
    if (p && at !== null) pings.push({ id: String(it.id ?? at).slice(0, 80), from: String(it.from ?? '').slice(0, 64), x: p.x, y: p.y, at });
  }
  const color = typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#38bdf8';
  return { strokes, texts, pings, persist: s.persist !== false, color };
}

// ------------------------------------------------------------------ overlay coordinates

/** A rectangle in DIPs (Electron's screen coordinates: Retina scale factors are already divided out). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the shared display's picture lies inside the overlay window, in the
 * window's CSS pixels. A captured SCREEN is the whole display, so its 0..1
 * coordinates are 0..1 of `display` bounds. The overlay asks for exactly those
 * bounds, but the OS may give it less (macOS can keep a window below the menu
 * bar), so the picture is offset by the difference — a point drawn on the
 * overlay stays on the same pixel of the real screen, and the student sees it
 * there on the shared video. Electron reports both rectangles in DIPs, so the
 * display's scale factor (2 on Retina) never enters: the canvas only uses it
 * for a sharp backing store.
 */
export function overlayCanvasRect(display: Rect, win: Rect): Rect {
  return { x: display.x - win.x, y: display.y - win.y, width: display.width, height: display.height };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A point in the overlay window (CSS px) → 0..1 of the shared screen; null off the display. */
export function overlayToShared(px: number, py: number, display: Rect, win: Rect): AnnotPoint | null {
  const r = overlayCanvasRect(display, win);
  if (r.width <= 0 || r.height <= 0) return null;
  const x = (px - r.x) / r.width;
  const y = (py - r.y) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [round4(x), round4(y)];
}

/** 0..1 of the shared screen → the overlay window's CSS px. */
export function sharedToOverlay(p: AnnotPoint, display: Rect, win: Rect): [number, number] {
  const r = overlayCanvasRect(display, win);
  return [r.x + p[0] * r.width, r.y + p[1] * r.height];
}

// ------------------------------------------------------------------ sign-in round trip

/** Same alphabet / length the worker accepts for an app nonce (services/auth.ts). */
export const DESKTOP_NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The URL the desktop app opens in the SYSTEM browser to sign in. Google refuses
 * OAuth inside embedded browsers, so the app never shows Google's page itself:
 * the browser signs in and the worker redirects to `chineselearning-desktop://auth`.
 * Any query of the page's own login link (an invite) is kept; `challenge` is the
 * PKCE challenge of the verifier THIS app kept (shared/auth/signin.ts), so the
 * redirect carries a one-time code, not the session token. Without it (never
 * passed by this build) the worker answers the legacy token.
 */
export function desktopLoginUrl(pageLoginUrl: string, nonce: string, challenge?: string): string {
  const u = new URL(pageLoginUrl);
  u.searchParams.set('client', DESKTOP_AUTH_CLIENT);
  u.searchParams.set('nonce', nonce);
  u.searchParams.delete('challenge');
  if (challenge) u.searchParams.set('challenge', challenge);
  return u.toString();
}

/** Is this navigation the web app's "Sign in with Google" (`…/api/auth/login`)? */
export function isLoginNavigation(url: string, apiOrigin: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === apiOrigin && u.pathname === '/api/auth/login';
  } catch {
    return false;
  }
}

/**
 * The deep link the browser hands back. Only a link carrying the nonce THIS app
 * asked with is accepted (another app or page can't sign it in to someone
 * else's account). Returns the query without the nonce: `code` (the one-time
 * code the app trades at /api/auth/exchange), a legacy `session_token`, or
 * `signup=…` / `error=…` when the sign-in was refused.
 */
export function parseAuthDeepLink(url: string, expectedNonce: string | null): URLSearchParams | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${DESKTOP_AUTH_SCHEME}:`) return null;
  // `chineselearning-desktop://auth?…` parses with host "auth" (or pathname "//auth" on some runtimes).
  const where = (u.host || u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
  if (where !== 'auth') return null;
  const nonce = u.searchParams.get('nonce');
  if (!expectedNonce || nonce !== expectedNonce) return null;
  const out = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (k !== 'nonce') out.set(k, v);
  if (!out.has('code') && !out.has('session_token') && !out.has('signup') && !out.has('error')) return null;
  return out;
}

// ------------------------------------------------------------------ "A new version is available"

/** "0.12.0" / "desktop-v0.12" → [0, 12, 0]; null when it isn't a version. */
export function parseVersion(v: string): number[] | null {
  const m = v.replace(DESKTOP_RELEASE_TAG_PREFIX, '').replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export interface ReleaseInfo {
  tag_name: string;
  html_url: string;
  draft?: boolean;
}

/** The newest `desktop-v*` release newer than `current` (GitHub's /releases list), or null. */
export function newerDesktopRelease(releases: readonly ReleaseInfo[], current: string): ReleaseInfo | null {
  let best: ReleaseInfo | null = null;
  for (const r of releases) {
    if (r.draft || typeof r.tag_name !== 'string' || !r.tag_name.startsWith(DESKTOP_RELEASE_TAG_PREFIX)) continue;
    if (!parseVersion(r.tag_name)) continue;
    if (compareVersions(r.tag_name, current) <= 0) continue;
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best;
}
