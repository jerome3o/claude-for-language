/** The overlay window's preload: just enough IPC for overlay/renderer.ts (no Node in the page). */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../ipc';

type Listener = (value: unknown) => void;

const on = (channel: string) => (listener: Listener) => {
  ipcRenderer.on(channel, (_e, value) => listener(value));
};

contextBridge.exposeInMainWorld('overlayHost', {
  onInit: on(IPC.overlayInit),
  onSnapshot: on(IPC.overlaySnapshot),
  onDrawMode: on(IPC.overlayDrawMode),
  emit: (event: unknown) => ipcRenderer.send(IPC.overlayEmit, event),
  interactive: (on: boolean) => ipcRenderer.send(IPC.overlayInteractive, on === true),
});
