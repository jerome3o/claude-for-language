/**
 * Profile picture cropping: the pure geometry behind the crop sheet (a square
 * viewport the photo covers, drag to pan, pinch / slider to zoom) and the
 * canvas step that turns the chosen square into a ≤512px JPEG for upload.
 *
 * Coordinates: the viewport is V×V screen px; the image (natural W×H) is drawn
 * at `scale` screen px per image px with its top-left at (ox, oy). The photo
 * must always cover the viewport, so ox ∈ [V − W·scale, 0] (same for y).
 */
import { PROFILE_PICTURE_SIZE } from '@shared/profile';

export const MAX_ZOOM = 4;

export interface CropState {
  /** Natural image size. */
  w: number;
  h: number;
  /** Viewport edge in screen px. */
  view: number;
  /** 1 = the photo just covers the viewport; up to MAX_ZOOM. */
  zoom: number;
  ox: number;
  oy: number;
}

/** Screen px per image px at zoom 1 (the short side fills the viewport). */
export function coverScale(w: number, h: number, view: number): number {
  return view / Math.max(1, Math.min(w, h));
}

export function scaleOf(s: Pick<CropState, 'w' | 'h' | 'view' | 'zoom'>): number {
  return coverScale(s.w, s.h, s.view) * s.zoom;
}

/** Keep the photo covering the viewport. */
export function clampCrop(s: CropState): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, s.zoom));
  const scale = scaleOf({ ...s, zoom });
  const minX = s.view - s.w * scale;
  const minY = s.view - s.h * scale;
  return {
    ...s,
    zoom,
    ox: Math.min(0, Math.max(minX, s.ox)),
    oy: Math.min(0, Math.max(minY, s.oy)),
  };
}

/** A new photo: zoom 1, centred. */
export function initialCrop(w: number, h: number, view: number): CropState {
  const scale = coverScale(w, h, view);
  return clampCrop({ w, h, view, zoom: 1, ox: (view - w * scale) / 2, oy: (view - h * scale) / 2 });
}

export function panCrop(s: CropState, dx: number, dy: number): CropState {
  return clampCrop({ ...s, ox: s.ox + dx, oy: s.oy + dy });
}

/** Zoom keeping the image point under (ax, ay) (viewport px) where it is; default the centre. */
export function zoomCrop(s: CropState, zoom: number, ax = s.view / 2, ay = s.view / 2): CropState {
  const before = scaleOf(s);
  const next = clampCrop({ ...s, zoom }).zoom;
  const after = scaleOf({ ...s, zoom: next });
  const ix = (ax - s.ox) / before;
  const iy = (ay - s.oy) / before;
  return clampCrop({ ...s, zoom: next, ox: ax - ix * after, oy: ay - iy * after });
}

export interface SourceRect {
  sx: number;
  sy: number;
  side: number;
}

/** The square of the source image the viewport shows (image px, inside the image). */
export function cropRect(s: CropState): SourceRect {
  const c = clampCrop(s);
  const scale = scaleOf(c);
  const side = Math.min(c.w, c.h, c.view / scale);
  const sx = Math.min(c.w - side, Math.max(0, -c.ox / scale));
  const sy = Math.min(c.h - side, Math.max(0, -c.oy / scale));
  return { sx, sy, side };
}

/** Output edge: the target size, or smaller for a small crop (never upscaled past 2×, never below 64). */
export function outputSize(side: number, target = PROFILE_PICTURE_SIZE): number {
  return Math.max(64, Math.min(target, Math.round(side * 2)));
}

/** Load a picked file as an image element (EXIF orientation is applied by the browser). */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo couldn\'t be opened. Try a JPEG or PNG.'));
    };
    img.src = url;
  });
}

/** Draw the chosen square into a canvas and encode it as a JPEG. */
export function renderCrop(img: CanvasImageSource, rect: SourceRect, size = outputSize(rect.side)): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Your browser can\'t resize photos'));
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background, not black
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.sx, rect.sy, rect.side, rect.side, 0, 0, size, size);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Couldn\'t prepare the photo'))), 'image/jpeg', 0.88);
  });
}
