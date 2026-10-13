/**
 * The app page's preload: exposes `window.desktopBridge` (the contract is
 * shared/desktop/bridge.ts) and nothing else. contextIsolation + sandbox are
 * on, so the page never sees ipcRenderer or Node; every call is checked again
 * in the main process (only the app's own origin may use it).
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopBridge, OverlayEvent, OverlaySnapshot, SharedSource } from '../../shared/desktop/bridge';
import { IPC } from './ipc';

const info = ipcRenderer.sendSync(IPC.appInfo) as { version: string; platform: string };

const bridge: DesktopBridge = {
  isDesktop: true,
  version: info.version,
  platform: info.platform,
  lastSharedSource: () => ipcRenderer.invoke(IPC.lastSharedSource) as Promise<SharedSource | null>,
  overlay: {
    show: (displayId: string) => ipcRenderer.invoke(IPC.overlayShow, String(displayId)) as Promise<boolean>,
    hide: () => ipcRenderer.send(IPC.overlayHide),
    annotations: (snapshot: OverlaySnapshot) => ipcRenderer.send(IPC.overlayAnnotations, snapshot),
    setDrawMode: (on: boolean) => ipcRenderer.send(IPC.overlaySetDrawMode, on === true),
    onEvent: (listener: (event: OverlayEvent) => void) => {
      const handler = (_e: IpcRendererEvent, event: OverlayEvent) => listener(event);
      ipcRenderer.on(IPC.overlayEvent, handler);
      return () => {
        ipcRenderer.removeListener(IPC.overlayEvent, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('desktopBridge', bridge);
