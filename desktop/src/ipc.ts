/** IPC channel names between the main process and the three kinds of window (app page, overlay, share picker). */
export const IPC = {
  // app page (preload.ts) ↔ main
  appInfo: 'app:info',
  lastSharedSource: 'share:last-source',
  overlayShow: 'overlay:show',
  overlayHide: 'overlay:hide',
  overlayAnnotations: 'overlay:annotations',
  overlaySetDrawMode: 'overlay:set-draw-mode',
  /** main → app page: something the tutor did on the overlay (OverlayEvent). */
  overlayEvent: 'overlay:event',

  // overlay window ↔ main
  /** main → overlay: the display's and the window's bounds (DIPs) + scale factor. */
  overlayInit: 'overlay:init',
  overlaySnapshot: 'overlay:snapshot',
  overlayDrawMode: 'overlay:draw-mode',
  /** overlay → main: the pointer is over the toolbar (take clicks) / left it (let them through). */
  overlayInteractive: 'overlay:interactive',
  /** overlay → main: an OverlayEvent for the page. */
  overlayEmit: 'overlay:emit',

  // share picker ↔ main
  pickerSources: 'picker:sources',
  pickerChoose: 'picker:choose',
  pickerOpenSettings: 'picker:open-settings',
  pickerRelaunch: 'picker:relaunch',
} as const;

/** A capture source as the picker shows it. */
export interface PickerSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  icon: string | null;
}

export interface PickerPayload {
  sources: PickerSource[];
  /** macOS Screen Recording permission: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'. */
  permission: string;
  platform: string;
}

export interface OverlayInit {
  display: { x: number; y: number; width: number; height: number };
  window: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  platform: string;
}
