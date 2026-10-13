/**
 * The desktop app's drawing overlay (desktop/, docs/VIDEO_CALLS.md "Desktop
 * app"), seen from the call page. Inert in a browser: everything here starts
 * with `getDesktopBridge()`, which is null outside the Electron app.
 *
 * When I share a whole SCREEN from the desktop app, the app covers that
 * display with a transparent, always-on-top, click-through window that draws
 * the call's annotations on the real screen. This module feeds it: every
 * change of the page's AnnotationStore goes over as a snapshot (throttled),
 * and what I draw / type / tap on the overlay comes back as overlay events,
 * which go out through the call's ordinary annotation messages — the other
 * person sees them on the shared video as if I had drawn in the call window.
 * The bridge contract and its pure rules: shared/desktop/bridge.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { defaultAnnotColor, pingProgress, strokeAlpha, type AnnotStroke, type AnnotText } from '@shared/calls';
import { getDesktopBridge, parseOverlayEvent, type OverlaySnapshot } from '@shared/desktop/bridge';
import { track } from '../analytics';
import type { AnnotationStore } from './annotations';

/** The page's annotations as the overlay needs them: only what is still visible at `now`. */
export function overlaySnapshot(store: AnnotationStore, now = Date.now()): OverlaySnapshot {
  return {
    strokes: [...store.strokes.values()].filter((s) => strokeAlpha(s.doneAt, now, store.persist) > 0),
    texts: [...store.texts.values()].filter((t) => t.text && strokeAlpha(t.doneAt, now, store.persist) > 0),
    pings: store.pings.filter((p) => pingProgress(p.at, now) !== null),
    persist: store.persist,
    color: defaultAnnotColor(true),
  };
}

export interface DesktopOverlayActions {
  stroke(stroke: AnnotStroke): void;
  ping(x: number, y: number): void;
  text(text: AnnotText): void;
  clear(): void;
}

/** ~30 updates a second while someone draws; the overlay animates fades / pings itself. */
const SNAPSHOT_MS = 33;

/**
 * Show the overlay while I share a screen from the desktop app. `shown` = the
 * overlay is up; `drawing` = it takes the mouse (draw / type on my real
 * screen) instead of letting clicks through.
 */
export function useDesktopOverlay(screenStream: MediaStream | null, store: AnnotationStore, actions: DesktopOverlayActions) {
  const [shown, setShown] = useState(false);
  const [drawing, setDrawingState] = useState(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || !screenStream) return;
    let alive = true;
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      timer = null;
      if (alive && opened) bridge.overlay.annotations(overlaySnapshot(store));
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(push, SNAPSHOT_MS);
    };
    const unsubStore = store.subscribe(schedule);
    const unsubEvents = bridge.overlay.onEvent((raw) => {
      const event = parseOverlayEvent(raw);
      if (!event) return;
      const a = actionsRef.current;
      if (event.kind === 'stroke') a.stroke(event.stroke);
      else if (event.kind === 'ping') a.ping(event.x, event.y);
      else if (event.kind === 'text') a.text(event.text);
      else if (event.kind === 'clear') a.clear();
      else if (event.kind === 'draw_mode') {
        setDrawingState(event.on);
        track('call.desktop_overlay', { draw: event.on });
      }
    });
    // Only a whole screen gets the overlay: a window or a tab moves under it.
    void bridge.lastSharedSource().then(async (source) => {
      if (!alive || source?.kind !== 'screen' || !source.displayId) return;
      const ok = await bridge.overlay.show(source.displayId).catch(() => false);
      if (!alive) return;
      opened = ok;
      setShown(ok);
      if (ok) {
        track('call.desktop_overlay', { on: true });
        push();
      }
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      unsubStore();
      unsubEvents();
      if (opened) {
        bridge.overlay.hide();
        track('call.desktop_overlay', { on: false });
      }
      setShown(false);
      setDrawingState(false);
    };
  }, [screenStream, store]);

  const setDrawing = (on: boolean) => {
    const bridge = getDesktopBridge();
    if (!bridge || !shown) return;
    bridge.overlay.setDrawMode(on);
    setDrawingState(on);
    track('call.desktop_overlay', { draw: on });
  };

  return { shown, drawing, setDrawing };
}
