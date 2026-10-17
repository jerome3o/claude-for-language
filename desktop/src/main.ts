/**
 * Chinese Learning for the desktop (desktop/README.md): the deployed web app in
 * a window, plus what a browser can't do — a native screen-share picker and a
 * transparent overlay that draws the call's annotations on the real screen
 * being shared. The page talks to this process only through the preload's
 * `window.desktopBridge` (shared/desktop/bridge.ts).
 */

import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, session, shell, systemPreferences, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { DESKTOP_AUTH_SCHEME, isLoginNavigation } from '../../shared/desktop/bridge';
import { exchangeCode, startSignIn, takeAuthDeepLink } from './auth';
import { API_ORIGIN, API_URL, APP_ORIGIN, APP_URL } from './config';
import { IPC } from './ipc';
import { OverlayManager } from './overlay';
import { installDisplayMediaHandler, lastSharedSource } from './share';
import { runSmoke } from './smoke';
import { checkForUpdates } from './updates';

const distDir = __dirname;
const staticDir = path.join(__dirname, '..', 'static');

let mainWindow: BrowserWindow | null = null;
let overlay: OverlayManager | null = null;
/** A deep link that arrived before the window existed (macOS open-url at launch). */
let pendingDeepLink: string | null = null;

// ------------------------------------------------------------------ one instance, deep links

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    // `electron .` in development: register with the path to this app.
    app.setAsDefaultProtocolClient(DESKTOP_AUTH_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(DESKTOP_AUTH_SCHEME);
  }
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${DESKTOP_AUTH_SCHEME}://`));
    if (link) handleDeepLink(link);
    focusMain();
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (mainWindow) handleDeepLink(url);
    else pendingDeepLink = url;
  });
  const fromArgv = process.argv.find((a) => a.startsWith(`${DESKTOP_AUTH_SCHEME}://`));
  if (fromArgv) pendingDeepLink = fromArgv;
  app.whenReady().then(start).catch((err) => console.error('[desktop] start failed', err));
}

function focusMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleDeepLink(url: string) {
  const link = takeAuthDeepLink(url);
  if (!link || !mainWindow) return;
  focusMain();
  void finishSignIn(mainWindow, link.params, link.verifier).catch((err) => console.error('[desktop] sign-in failed', err));
}

/**
 * `code` → traded at /api/auth/exchange with this process's verifier, the token handed to
 * the page; `signup=…` / `error=…` → the page's sign-in screen explains.
 */
async function finishSignIn(win: BrowserWindow, params: URLSearchParams, verifier: string | null) {
  const code = params.get('code');
  const legacyToken = params.get('session_token');
  if (code || legacyToken) {
    const out = code ? await exchangeCode(API_URL, code, verifier) : { token: legacyToken! };
    if ('token' in out) {
      await handOverSession(win, out.token);
      return;
    }
    console.warn('[desktop] code exchange refused:', out.error);
    await win.loadURL(`${APP_URL}/?${new URLSearchParams({ error: 'auth_failed' }).toString()}`);
    return;
  }
  await win.loadURL(`${APP_URL}/?${params.toString()}`);
}

/**
 * The page keeps its session in localStorage['session_token'] (frontend AuthContext):
 * write it there on the app's own origin, then load the app — no token in any URL.
 */
async function handOverSession(win: BrowserWindow, token: string) {
  if (!isAppUrl(win.webContents.getURL())) await win.loadURL(APP_URL);
  await win.webContents.executeJavaScript(
    `try { localStorage.setItem('session_token', ${JSON.stringify(token)}); localStorage.removeItem('cached_user'); } catch (e) {}`,
    true,
  );
  await win.loadURL(`${APP_URL}/`);
}

// ------------------------------------------------------------------ the app window

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};
const isAppUrl = (url: string) => originOf(url) === APP_ORIGIN;
/** Only the app's own page may use the bridge. */
const fromAppPage = (sender: WebContents) => !!mainWindow && sender === mainWindow.webContents && isAppUrl(sender.getURL());

function openOutside(url: string) {
  if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) void shell.openExternal(url);
}

function guardNavigation(contents: WebContents) {
  contents.on('will-navigate', (e, url) => {
    if (isLoginNavigation(url, API_ORIGIN)) {
      e.preventDefault();
      void startSignIn(url);
      return;
    }
    if (isAppUrl(url) || originOf(url) === API_ORIGIN) return;
    e.preventDefault();
    openOutside(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isLoginNavigation(url, API_ORIGIN)) {
      void startSignIn(url);
      return { action: 'deny' };
    }
    // The app's own pages (print views) open in an app window; everything else in the browser.
    if (isAppUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    openOutside(url);
    return { action: 'deny' };
  });
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: 'Chinese Learning',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(distDir, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A call keeps feeding the overlay while she works in another app.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });
  mainWindow = win; // its navigation rules come from 'web-contents-created' (start)
  win.once('ready-to-show', () => win.show());
  // A reload / navigation / crash ends the call page: the overlay goes with it.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) overlay?.pageGone(win.webContents);
  });
  win.webContents.on('render-process-gone', () => overlay?.pageGone(win.webContents));
  win.on('closed', () => {
    overlay?.hide();
    mainWindow = null;
  });
  void win.loadURL(APP_URL);
}

// ------------------------------------------------------------------ permissions

function installPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (!isAppUrl(details.requestingUrl)) return callback(false);
    if (permission === 'media' && process.platform === 'darwin') {
      // macOS asks once per app (camera / microphone); the call page shows its own help when refused.
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      void (async () => {
        let ok = true;
        if (types.includes('audio')) ok = (await systemPreferences.askForMediaAccess('microphone').catch(() => false)) && ok;
        if (types.includes('video')) ok = (await systemPreferences.askForMediaAccess('camera').catch(() => false)) && ok;
        callback(ok);
      })();
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, _permission, requestingOrigin) => originOf(requestingOrigin) === APP_ORIGIN || requestingOrigin === APP_ORIGIN);
}

// ------------------------------------------------------------------ bridge IPC

function installBridge() {
  ipcMain.on(IPC.appInfo, (e) => {
    e.returnValue = { version: app.getVersion(), platform: process.platform };
  });
  ipcMain.handle(IPC.lastSharedSource, (e) => (fromAppPage(e.sender) ? lastSharedSource() : null));
  ipcMain.handle(IPC.overlayShow, (e, displayId: unknown) => {
    if (!fromAppPage(e.sender) || typeof displayId !== 'string') return false;
    return overlay?.show(e.sender, displayId) ?? false;
  });
  ipcMain.on(IPC.overlayHide, (e) => {
    if (fromAppPage(e.sender)) overlay?.hide();
  });
  ipcMain.on(IPC.overlayAnnotations, (e, snapshot: unknown) => {
    if (fromAppPage(e.sender)) overlay?.snapshot(snapshot);
  });
  ipcMain.on(IPC.overlaySetDrawMode, (e, on: unknown) => {
    if (fromAppPage(e.sender)) overlay?.setDrawMode(on === true);
  });
  // From the overlay window only.
  ipcMain.on(IPC.overlayEmit, (e, event: unknown) => {
    if (overlay && e.sender === overlay.webContents) overlay.fromOverlay(event);
  });
  ipcMain.on(IPC.overlayInteractive, (e, on: unknown) => {
    if (overlay && e.sender === overlay.webContents) overlay.interactive(on === true);
  });
}

// ------------------------------------------------------------------ menu

function installMenu() {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => void mainWindow?.loadURL(APP_URL) },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Check for updates…', click: () => void checkForUpdates(mainWindow, true) },
        { label: 'Open in the browser', click: () => void shell.openExternal(mainWindow?.webContents.getURL() || APP_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ start

function start() {
  overlay = new OverlayManager(staticDir, distDir);
  installPermissions();
  installBridge();
  installDisplayMediaHandler({
    mainWindow: () => mainWindow,
    exclude: () => [overlay?.mediaSourceId()].filter((x): x is string => !!x),
    staticDir,
    distDir,
  });
  installMenu();
  // Every window (the app, print popups; the overlay and picker deny everything on top) follows the same rules.
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'window') guardNavigation(contents);
  });
  createMainWindow();
  if (pendingDeepLink) {
    const link = pendingDeepLink;
    pendingDeepLink = null;
    mainWindow?.webContents.once('did-finish-load', () => handleDeepLink(link));
  }
  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    else focusMain();
  });
  const smokeDir = process.env.CHINESE_LEARNING_SMOKE;
  if (smokeDir) void runSmoke(smokeDir, () => mainWindow, () => overlay);
  else if (process.env.CHINESE_LEARNING_NO_UPDATE_CHECK !== '1') setTimeout(() => void checkForUpdates(mainWindow, false), 8_000);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
