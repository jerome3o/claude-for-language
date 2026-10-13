/** The share picker's preload (static/picker.html → picker/renderer.ts). */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../ipc';

contextBridge.exposeInMainWorld('pickerHost', {
  onSources: (listener: (payload: unknown) => void) => ipcRenderer.on(IPC.pickerSources, (_e, payload) => listener(payload)),
  choose: (id: string | null) => ipcRenderer.send(IPC.pickerChoose, id),
  openSettings: () => ipcRenderer.send(IPC.pickerOpenSettings),
  relaunch: () => ipcRenderer.send(IPC.pickerRelaunch),
});
