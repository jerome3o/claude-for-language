/**
 * Screen sharing in the desktop app. Electron answers the page's
 * getDisplayMedia() itself (no browser picker), so this shows a simple picker
 * of screens and windows (static/picker.html), remembers what was picked (the
 * page asks for it to open the overlay on that display) and, on macOS, guides
 * the tutor through the Screen Recording permission.
 */

import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell, systemPreferences, type DesktopCapturerSource } from 'electron';
import type { SharedSource } from '../../shared/desktop/bridge';
import { APP_ORIGIN, MAC_SCREEN_SETTINGS } from './config';
import { IPC, type PickerPayload, type PickerSource } from './ipc';

let lastSource: SharedSource | null = null;

export function lastSharedSource(): SharedSource | null {
  return lastSource;
}

function screenPermission(): string {
  if (process.platform !== 'darwin') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch {
    return 'unknown';
  }
}

/** A screen source's display: Electron's display_id, else (one display, or a platform that leaves it empty) by position. */
function displayIdOf(source: DesktopCapturerSource, screens: DesktopCapturerSource[]): string | null {
  if (source.display_id) return source.display_id;
  const displays = screen.getAllDisplays();
  if (displays.length === 1) return String(displays[0].id);
  const i = screens.indexOf(source);
  return i >= 0 && i < displays.length && screens.length === displays.length ? String(displays[i].id) : null;
}

let pickerOpen: Promise<string | null> | null = null;

function pick(parent: BrowserWindow | null, payload: PickerPayload, staticDir: string, distDir: string): Promise<string | null> {
  if (pickerOpen) return Promise.resolve(null); // one picker at a time
  pickerOpen = new Promise<string | null>((resolve) => {
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 760,
      height: 560,
      minWidth: 480,
      minHeight: 400,
      show: false,
      title: 'Share your screen',
      backgroundColor: '#111827',
      webPreferences: {
        preload: path.join(distDir, 'picker-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    let done = false;
    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      ipcMain.removeListener(IPC.pickerChoose, onChoose);
      if (!win.isDestroyed()) win.close();
      pickerOpen = null;
      resolve(id);
    };
    const onChoose = (e: Electron.IpcMainEvent, id: unknown) => {
      if (e.sender !== win.webContents) return;
      finish(typeof id === 'string' ? id : null);
    };
    ipcMain.on(IPC.pickerChoose, onChoose);
    win.on('closed', () => finish(null));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.setMenuBarVisibility(false);
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.pickerSources, payload);
      win.show();
    });
    void win.loadFile(path.join(staticDir, 'picker.html'));
  });
  return pickerOpen;
}

/**
 * Answer getDisplayMedia() from the app page with our picker. `exclude` lists
 * media source ids of the app's own helper windows (the overlay), which are
 * never offered.
 */
export function installDisplayMediaHandler(opts: {
  mainWindow: () => BrowserWindow | null;
  exclude: () => string[];
  staticDir: string;
  distDir: string;
}) {
  ipcMain.on(IPC.pickerOpenSettings, () => {
    if (process.platform === 'darwin') void shell.openExternal(MAC_SCREEN_SETTINGS);
  });
  ipcMain.on(IPC.pickerRelaunch, () => {
    app.relaunch();
    app.exit(0);
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void (async () => {
        try {
          const origin = (() => {
            try {
              return new URL(request.securityOrigin || request.frame?.url || '').origin;
            } catch {
              return '';
            }
          })();
          if (origin !== APP_ORIGIN) {
            callback({});
            return;
          }
          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 400, height: 250 },
            fetchWindowIcons: true,
          });
          const excluded = new Set(opts.exclude());
          const own = opts.mainWindow()?.getMediaSourceId();
          const offered = sources.filter((s) => !excluded.has(s.id));
          const screens = offered.filter((s) => s.id.startsWith('screen:'));
          const payload: PickerPayload = {
            permission: screenPermission(),
            platform: process.platform,
            sources: offered.map(
              (s): PickerSource => ({
                id: s.id,
                name: s.id === own ? `${s.name} (this window)` : s.name,
                kind: s.id.startsWith('screen:') ? 'screen' : 'window',
                thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
                icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
              }),
            ),
          };
          const chosenId = await pick(opts.mainWindow(), payload, opts.staticDir, opts.distDir);
          const chosen = chosenId ? offered.find((s) => s.id === chosenId) : undefined;
          if (!chosen) {
            lastSource = null;
            callback({});
            return;
          }
          const kind = chosen.id.startsWith('screen:') ? 'screen' : 'window';
          lastSource = { kind, displayId: kind === 'screen' ? displayIdOf(chosen, screens) : null, name: chosen.name };
          // System sound: Windows can loop it back; macOS can't through this API (the page says so).
          const audio = request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' as const } : {};
          callback({ video: chosen, ...audio });
        } catch (err) {
          console.error('[share] picker failed', err);
          lastSource = null;
          callback({});
        }
      })();
    },
    { useSystemPicker: false },
  );
}
