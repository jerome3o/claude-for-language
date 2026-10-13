/**
 * The drawing overlay (main process side): a transparent, frameless,
 * always-on-top window covering the display being shared, click-through by
 * default. It draws what the call page sends (overlay/renderer.ts) and, in
 * draw mode, takes the mouse so the tutor can draw / type on her real screen;
 * her strokes go back to the page, which sends them through the call room.
 *
 * Hidden from screen capture (`setContentProtection`): the student sees the
 * strokes drawn by their own call page over the shared video, never a second
 * copy burnt into the video.
 */

import path from 'node:path';
import { BrowserWindow, screen, type Display, type WebContents } from 'electron';
import { parseOverlayEvent, sanitizeSnapshot } from '../../shared/desktop/bridge';
import { IPC, type OverlayInit } from './ipc';

export class OverlayManager {
  private win: BrowserWindow | null = null;
  private display: Display | null = null;
  private drawMode = false;
  /** The page that owns the overlay (the call page); events go back to it. */
  private page: WebContents | null = null;

  constructor(private readonly staticDir: string, private readonly distDir: string) {
    screen.on('display-metrics-changed', (_e, d) => {
      if (this.display && d.id === this.display.id) {
        this.display = d;
        this.win?.setBounds(d.bounds);
        this.sendInit();
      }
    });
    screen.on('display-removed', (_e, d) => {
      if (this.display && d.id === this.display.id) this.hide();
    });
  }

  get webContents(): WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  /** Media source id of the overlay window (so the share picker can leave it out). */
  mediaSourceId(): string | null {
    return this.win && !this.win.isDestroyed() ? this.win.getMediaSourceId() : null;
  }

  show(page: WebContents, displayId: string): boolean {
    const display = screen.getAllDisplays().find((d) => String(d.id) === displayId);
    if (!display) return false;
    this.page = page;
    if (this.win && !this.win.isDestroyed() && this.display?.id === display.id) {
      this.win.showInactive();
      return true;
    }
    this.hide();
    this.display = display;
    const mac = process.platform === 'darwin';
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      focusable: true,
      title: 'Drawing on your screen',
      // macOS: a non-activating panel floats over full-screen apps and doesn't pull the call window forward.
      ...(mac ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: path.join(this.distDir, 'overlay-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    // Not in the shared video: the student's own page draws the strokes over it.
    win.setContentProtection(true);
    win.setIgnoreMouseEvents(true, { forward: true });
    win.on('move', () => this.sendInit());
    win.on('resize', () => this.sendInit());
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null;
        this.display = null;
        this.drawMode = false;
      }
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.once('did-finish-load', () => {
      win.setBounds(display.bounds);
      win.showInactive();
      this.sendInit();
    });
    void win.loadFile(path.join(this.staticDir, 'overlay.html'));
    return true;
  }

  hide() {
    const win = this.win;
    this.win = null;
    this.display = null;
    this.drawMode = false;
    if (win && !win.isDestroyed()) win.destroy();
  }

  /** Hide when the page that opened it goes away (reload, navigation, crash). */
  pageGone(page: WebContents) {
    if (this.page === page) {
      this.hide();
      this.page = null;
    }
  }

  snapshot(raw: unknown) {
    const snap = sanitizeSnapshot(raw);
    if (snap) this.webContents?.send(IPC.overlaySnapshot, snap);
  }

  setDrawMode(on: boolean) {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.drawMode = on;
    win.setIgnoreMouseEvents(!on, { forward: true });
    if (on) {
      win.showInactive();
      win.focus(); // keys for the text tool
    } else {
      win.blur();
    }
    win.webContents.send(IPC.overlayDrawMode, on);
  }

  /** The pointer is over the toolbar while clicks pass through: let the toolbar take them. */
  interactive(on: boolean) {
    if (!this.drawMode) this.win?.setIgnoreMouseEvents(!on, { forward: true });
  }

  /** Something the tutor did on the overlay → the call page. */
  fromOverlay(raw: unknown) {
    const event = parseOverlayEvent(raw);
    if (!event) return;
    if (event.kind === 'draw_mode') this.setDrawMode(event.on);
    if (this.page && !this.page.isDestroyed()) this.page.send(IPC.overlayEvent, event);
  }

  private sendInit() {
    const win = this.win;
    const display = this.display;
    if (!win || win.isDestroyed() || !display) return;
    const init: OverlayInit = {
      display: display.bounds,
      window: win.getBounds(),
      scaleFactor: display.scaleFactor,
      platform: process.platform,
    };
    win.webContents.send(IPC.overlayInit, init);
    win.webContents.send(IPC.overlayDrawMode, this.drawMode);
  }
}
