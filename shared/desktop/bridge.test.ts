import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  desktopLoginUrl,
  getDesktopBridge,
  isLoginNavigation,
  newerDesktopRelease,
  overlayCanvasRect,
  overlayToShared,
  parseAuthDeepLink,
  parseOverlayEvent,
  sanitizeSnapshot,
  sharedToOverlay,
  type Rect,
} from './bridge';

describe('overlay coordinates', () => {
  const display: Rect = { x: 0, y: 0, width: 1512, height: 982 }; // a 14" MacBook Pro in DIPs (3024×1964 px at 2×)

  it('maps 0..1 of the shared screen to the same pixel of the overlay covering the display', () => {
    expect(overlayCanvasRect(display, display)).toEqual(display);
    expect(sharedToOverlay([0.5, 0.5], display, display)).toEqual([756, 491]);
    expect(overlayToShared(756, 491, display, display)).toEqual([0.5, 0.5]);
  });

  it('keeps a point on the real screen when the OS kept the window below the menu bar', () => {
    const win: Rect = { x: 0, y: 37, width: 1512, height: 945 };
    // The picture starts 37 px ABOVE the window's top: the menu bar is part of the capture.
    expect(overlayCanvasRect(display, win)).toEqual({ x: 0, y: -37, width: 1512, height: 982 });
    const [x, y] = sharedToOverlay([0.25, 0.5], display, win);
    expect([x, y]).toEqual([378, 454]);
    expect(overlayToShared(x, y, display, win)).toEqual([0.25, 0.5]);
  });

  it('works on a second display left of / above the main one (negative origins)', () => {
    const second: Rect = { x: -1920, y: -200, width: 1920, height: 1080 };
    expect(overlayToShared(960, 540, second, second)).toEqual([0.5, 0.5]);
    expect(sharedToOverlay([1, 1], second, second)).toEqual([1920, 1080]);
  });

  it('is the same whatever the scale factor: Electron rectangles are DIPs', () => {
    // A 4K display at 2× and the same display at 1.5× report different DIP sizes, but a
    // point's fraction of the display is what crosses the bridge.
    const at2: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const at15: Rect = { x: 0, y: 0, width: 2560, height: 1440 };
    const p = overlayToShared(480, 270, at2, at2)!;
    expect(sharedToOverlay(p, at15, at15)).toEqual([640, 360]);
  });

  it('ignores points off the display', () => {
    expect(overlayToShared(-5, 10, display, display)).toBeNull();
    expect(overlayToShared(10, 2000, display, display)).toBeNull();
  });
});

describe('what crosses the bridge', () => {
  it('cleans overlay events with the call room rules', () => {
    expect(parseOverlayEvent({ kind: 'stroke', stroke: { id: 's1', color: '#38bdf8', width: 0.006, points: [[0.1, 2], [0.2, 0.3]], done: true } })).toEqual({
      kind: 'stroke',
      stroke: { id: 's1', color: '#38bdf8', width: 0.006, points: [[0.1, 1], [0.2, 0.3]], done: true },
    });
    expect(parseOverlayEvent({ kind: 'stroke', stroke: { id: 's1', color: 'red', width: 0.006, points: [[0, 0]] } })).toBeNull();
    expect(parseOverlayEvent({ kind: 'ping', x: 0.5, y: -1 })).toEqual({ kind: 'ping', x: 0.5, y: 0 });
    expect(parseOverlayEvent({ kind: 'text', text: { id: 't', color: '#22c55e', x: 0.1, y: 0.2, text: '这里', size: 0.03, done: false } })).toMatchObject({ kind: 'text', text: { text: '这里' } });
    expect(parseOverlayEvent({ kind: 'clear' })).toEqual({ kind: 'clear' });
    expect(parseOverlayEvent({ kind: 'draw_mode', on: false })).toEqual({ kind: 'draw_mode', on: false });
    expect(parseOverlayEvent({ kind: 'draw_mode', on: 'yes' })).toBeNull();
    expect(parseOverlayEvent({ kind: 'exec', cmd: 'rm' })).toBeNull();
    expect(parseOverlayEvent(null)).toBeNull();
  });

  it('keeps the good items of a snapshot and drops the bad ones', () => {
    const snap = sanitizeSnapshot({
      strokes: [
        { id: 'a', color: '#f43f5e', width: 0.006, points: [[0.1, 0.1]], done: true, from: 'u1', doneAt: 1000 },
        { id: 'b', color: 'nope', width: 0.006, points: [[0.1, 0.1]] },
      ],
      texts: [{ id: 't', color: '#facc15', x: 0.5, y: 0.5, text: '你好', size: 0.03, done: true, from: 'me', doneAt: null }],
      pings: [{ id: 'p', from: 'u1', x: 0.3, y: 0.4, at: 5 }, { x: 1, y: 1 }],
      persist: false,
      color: '#38bdf8',
    })!;
    expect(snap.strokes.map((s) => [s.id, s.from, s.doneAt])).toEqual([['a', 'u1', 1000]]);
    expect(snap.texts[0]).toMatchObject({ text: '你好', from: 'me', doneAt: null });
    expect(snap.pings).toEqual([{ id: 'p', from: 'u1', x: 0.3, y: 0.4, at: 5 }]);
    expect(snap.persist).toBe(false);
    expect(sanitizeSnapshot({})).toEqual({ strokes: [], texts: [], pings: [], persist: true, color: '#38bdf8' });
  });

  it('finds the bridge only inside the desktop app', () => {
    expect(getDesktopBridge({})).toBeNull();
    expect(getDesktopBridge({ desktopBridge: { isDesktop: true } })).toBeNull();
    const bridge = { isDesktop: true, overlay: { show: () => Promise.resolve(true) } };
    expect(getDesktopBridge({ desktopBridge: bridge })).toBe(bridge);
  });
});

describe('desktop sign-in', () => {
  const api = 'https://chinese-learning-api.jeromeswannack.workers.dev';

  it('recognises the web app login link and adds the desktop client', () => {
    expect(isLoginNavigation(`${api}/api/auth/login`, api)).toBe(true);
    expect(isLoginNavigation(`${api}/api/auth/login?invite=abc`, api)).toBe(true);
    expect(isLoginNavigation(`${api}/api/auth/me`, api)).toBe(false);
    expect(isLoginNavigation('https://evil.example/api/auth/login', api)).toBe(false);
    const url = new URL(desktopLoginUrl(`${api}/api/auth/login?invite=abc`, 'n'.repeat(24)));
    expect(url.searchParams.get('invite')).toBe('abc');
    expect(url.searchParams.get('client')).toBe('desktop');
    expect(url.searchParams.get('nonce')).toBe('n'.repeat(24));
  });

  it('accepts only the deep link carrying our nonce', () => {
    const nonce = 'abcdefghijklmnop1234';
    const ok = parseAuthDeepLink(`chineselearning-desktop://auth?session_token=tok&nonce=${nonce}`, nonce);
    expect(ok?.toString()).toBe('session_token=tok');
    expect(parseAuthDeepLink(`chineselearning-desktop://auth?signup=invite_only&nonce=${nonce}`, nonce)?.get('signup')).toBe('invite_only');
    expect(parseAuthDeepLink(`chineselearning-desktop://auth?session_token=tok&nonce=other${nonce}`, nonce)).toBeNull();
    expect(parseAuthDeepLink(`chineselearning-desktop://auth?session_token=tok&nonce=${nonce}`, null)).toBeNull();
    expect(parseAuthDeepLink(`chineselearning-lab://auth?session_token=tok&nonce=${nonce}`, nonce)).toBeNull();
    expect(parseAuthDeepLink(`chineselearning-desktop://elsewhere?session_token=tok&nonce=${nonce}`, nonce)).toBeNull();
    expect(parseAuthDeepLink(`chineselearning-desktop://auth?nonce=${nonce}`, nonce)).toBeNull();
  });

  it('asks for a one-time code with its own challenge and accepts the code link', () => {
    const nonce = 'abcdefghijklmnop1234';
    const challenge = 'C'.repeat(43);
    // The page's own challenge (if any) is replaced by the app's: the app holds the verifier.
    const url = new URL(desktopLoginUrl(`${api}/api/auth/login?invite=abc&challenge=${'P'.repeat(43)}`, nonce, challenge));
    expect(url.searchParams.get('challenge')).toBe(challenge);
    expect(url.searchParams.getAll('challenge')).toHaveLength(1);
    expect(url.searchParams.get('invite')).toBe('abc');
    expect(new URL(desktopLoginUrl(`${api}/api/auth/login?challenge=x`, nonce)).searchParams.has('challenge')).toBe(false);
    expect(parseAuthDeepLink(`chineselearning-desktop://auth?code=one-time&nonce=${nonce}`, nonce)?.get('code')).toBe('one-time');
    expect(parseAuthDeepLink(`chineselearning-desktop://auth?code=one-time&nonce=x${nonce}`, nonce)).toBeNull();
  });
});

describe('update check', () => {
  it('compares 0.N versions and tags', () => {
    expect(compareVersions('desktop-v0.12', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', 'desktop-v0.9')).toBe(0);
    expect(compareVersions('desktop-v0.9', '0.10.0')).toBeLessThan(0);
  });

  it('picks the newest desktop release newer than this one, ignoring other apps and drafts', () => {
    const releases = [
      { tag_name: 'lab-v0.300', html_url: 'lab' },
      { tag_name: 'desktop-v0.14', html_url: 'd14', draft: true },
      { tag_name: 'desktop-v0.13', html_url: 'd13' },
      { tag_name: 'desktop-v0.11', html_url: 'd11' },
      { tag_name: 'android-v1.2', html_url: 'a' },
    ];
    expect(newerDesktopRelease(releases, '0.11.0')?.html_url).toBe('d13');
    expect(newerDesktopRelease(releases, '0.13.0')).toBeNull();
    expect(newerDesktopRelease([], '0.1.0')).toBeNull();
  });
});
