/**
 * Smoke test (CI and screenshots), only when CHINESE_LEARNING_SMOKE=<dir>:
 * drives the real app end to end — the page asks for a screen share, the
 * picker answers it, the page opens the overlay on the shared display through
 * `window.desktopBridge`, feeds it a few annotations, and an overlay event comes
 * back to the page — saving a screenshot of each window and `smoke.json`
 * (what happened) into <dir>, then quits with exit code 0 / 1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, screen, type WebContents } from 'electron';
import type { OverlayManager } from './overlay';

const step = (what: string) => console.log(`[smoke] ${what}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out');
    await wait(100);
  }
}

async function shot(contents: WebContents, file: string) {
  const image = await contents.capturePage();
  fs.writeFileSync(file, image.toPNG());
}

/** A circle, an arrow-ish stroke, a text and a ping, as the call page would send them. */
const SAMPLE = (now: number) => ({
  strokes: [
    {
      id: 'circle', from: 'student', color: '#f43f5e', width: 0.006, done: true, doneAt: now,
      points: Array.from({ length: 41 }, (_, i) => [0.3 + 0.08 * Math.cos((i / 40) * Math.PI * 2), 0.42 + 0.12 * Math.sin((i / 40) * Math.PI * 2)]),
    },
    { id: 'line', from: 'me', color: '#38bdf8', width: 0.006, done: true, doneAt: now, points: [[0.45, 0.62], [0.55, 0.55], [0.62, 0.5]] },
  ],
  texts: [{ id: 't1', from: 'student', color: '#facc15', x: 0.42, y: 0.28, text: '这个字怎么读？', size: 0.032, done: true, doneAt: now }],
  pings: [{ id: 'p1', from: 'student', x: 0.7, y: 0.45, at: now }],
  persist: true,
  color: '#38bdf8',
});

export async function runSmoke(outDir: string, main: () => BrowserWindow | null, overlay: () => OverlayManager | null) {
  const result: Record<string, unknown> = { ok: false, version: app.getVersion(), platform: process.platform };
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const win = await waitFor(main);
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
    await wait(2_500);
    result.url = win.webContents.getURL();
    result.bridge = await win.webContents.executeJavaScript('!!(window.desktopBridge && window.desktopBridge.isDesktop) && window.desktopBridge.version');
    await shot(win.webContents, path.join(outDir, '01-app-window.png'));

    step('app window captured');
    // The page asks for a screen share, like the call's 🖥️ button.
    await win.webContents.executeJavaScript(
      `window.__smoke = { events: [] };
       window.desktopBridge.overlay.onEvent((e) => window.__smoke.events.push(e));
       navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
         .then((s) => { window.__smoke.stream = s.getVideoTracks().length; })
         .catch((e) => { window.__smoke.error = String(e); }); 1`,
      true,
    );
    const picker = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Share your screen' && w.isVisible()));
    await wait(1_000);
    await shot(picker.webContents, path.join(outDir, '02-share-picker.png'));
    result.pickerSources = await picker.webContents.executeJavaScript('document.querySelectorAll(".source").length');
    await picker.webContents.executeJavaScript(`(() => { const c = document.querySelector('.source'); c && c.click(); document.getElementById('share').click(); })()`);
    const shared = await (async () => {
      for (let i = 0; i < 100; i++) {
        const s = await win.webContents.executeJavaScript('window.__smoke.stream || window.__smoke.error || null');
        if (s) return s;
        await wait(100);
      }
      return null;
    })();
    result.shared = shared;

    step('shared: picked');
    // What is on the screen behind the overlay (for the composite screenshot).
    const { width, height } = screen.getPrimaryDisplay().size;
    const [behind] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    if (behind) fs.writeFileSync(path.join(outDir, '00-screen.png'), behind.thumbnail.toPNG());

    step('screen behind captured');
    // The call page opens the overlay on the shared display and feeds it.
    const opened = await win.webContents.executeJavaScript(
      `(async () => {
         const src = await window.desktopBridge.lastSharedSource();
         const ok = src && src.kind === 'screen' ? await window.desktopBridge.overlay.show(src.displayId) : false;
         return { src, ok };
       })()`,
    );
    result.overlay = opened;
    const ov = overlay();
    const overlayContents = await waitFor(() => ov?.webContents);
    if (overlayContents.isLoading()) await new Promise<void>((r) => overlayContents.once('did-finish-load', () => r()));
    await win.webContents.executeJavaScript(`window.desktopBridge.overlay.annotations(${JSON.stringify(SAMPLE(Date.now()))}); window.desktopBridge.overlay.setDrawMode(true); 1`);
    await wait(1_200);
    await shot(overlayContents, path.join(outDir, '03-overlay-drawing.png'));
    result.toolbar = await overlayContents.executeJavaScript('document.getElementById("toolbar").innerText');

    step('overlay captured');
    // What she does on the overlay reaches the page (and from there the call room).
    await overlayContents.executeJavaScript(`window.overlayHost.emit({ kind: 'ping', x: 0.5, y: 0.5 }); window.overlayHost.emit({ kind: 'draw_mode', on: false }); 1`);
    await wait(500);
    result.eventsBack = await win.webContents.executeJavaScript('window.__smoke.events');
    await shot(overlayContents, path.join(outDir, '04-overlay-click-through.png'));
    win.webContents.executeJavaScript('window.desktopBridge.overlay.hide(); 1').catch(() => {});
    await wait(300);
    result.overlayClosed = !ov?.webContents;

    const events = result.eventsBack as { kind: string }[];
    result.ok = !!result.bridge && (opened as { ok: boolean }).ok === true && events.some((e) => e.kind === 'ping') && events.some((e) => e.kind === 'draw_mode') && result.overlayClosed === true;
  } catch (err) {
    result.error = String((err as Error)?.stack ?? err);
  }
  fs.writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify(result, null, 2));
  console.log('[smoke]', JSON.stringify(result));
  app.exit(result.ok ? 0 : 1);
}
