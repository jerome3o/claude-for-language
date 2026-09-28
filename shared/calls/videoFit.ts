/**
 * How a video call lays its video out — pure, so the web page and the native
 * Lab app make the same decisions (android-lab/core/…/calls/VideoFit.kt,
 * parity-tested).
 *
 * The problem this solves: a phone's portrait camera shown with
 * `object-fit: cover` in a wide desktop window is cropped to a band across
 * the face (the face fills the screen). So a feed is only cropped when its
 * shape is close to the box's; otherwise the whole picture is shown
 * (`contain`) over a blurred / dark letterbox.
 */

export interface VideoSize {
  width: number;
  height: number;
}

export type VideoFit = 'cover' | 'contain';

/** Crop only when the video's and the box's aspect ratios are within this much of each other. */
export const COVER_TOLERANCE = 0.15;

function valid(s: VideoSize | null | undefined): s is VideoSize {
  return !!s && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0;
}

/** How far apart two shapes are: 1 = identical, 1.33 = one is a third wider than the other. */
export function aspectMismatch(a: VideoSize, b: VideoSize): number {
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return ra > rb ? ra / rb : rb / ra;
}

/**
 * Fill the box (`cover`, a little is cropped) only when the shapes nearly
 * match; show the whole picture (`contain`) otherwise. A shared screen is
 * always shown whole (text at the edges matters), and so is a video whose
 * size isn't known yet.
 */
export function chooseVideoFit(
  video: VideoSize | null | undefined,
  box: VideoSize | null | undefined,
  opts: { screen?: boolean; tolerance?: number } = {},
): VideoFit {
  if (opts.screen) return 'contain';
  if (!valid(video) || !valid(box)) return 'contain';
  // 1e-9: 115×100 in 100×100 is exactly 15% off either way round, whatever the float rounding.
  return aspectMismatch(video, box) <= 1 + (opts.tolerance ?? COVER_TOLERANCE) + 1e-9 ? 'cover' : 'contain';
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the picture sits inside the box with `contain` (the letterbox is the rest) — for overlays on the video. */
export function containRect(video: VideoSize | null | undefined, box: VideoSize): Rect {
  if (!valid(video) || !valid(box)) return { x: 0, y: 0, width: Math.max(0, box.width), height: Math.max(0, box.height) };
  const scale = Math.min(box.width / video.width, box.height / video.height);
  const width = video.width * scale;
  const height = video.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** Where the picture sits with `cover` (it overflows the box; x / y are ≤ 0). */
export function coverRect(video: VideoSize | null | undefined, box: VideoSize): Rect {
  if (!valid(video) || !valid(box)) return { x: 0, y: 0, width: Math.max(0, box.width), height: Math.max(0, box.height) };
  const scale = Math.max(box.width / video.width, box.height / video.height);
  const width = video.width * scale;
  const height = video.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** The picture's rectangle for a fit. */
export function videoRect(video: VideoSize | null | undefined, box: VideoSize, fit: VideoFit): Rect {
  return fit === 'cover' ? coverRect(video, box) : containRect(video, box);
}

export const PIP_MIN = 88;
export const PIP_MAX = 260;

/**
 * The self-view picture-in-picture: shaped like my own camera (a phone's
 * portrait camera stays portrait, a laptop's landscape webcam landscape) and
 * sized from the stage — about a third of its shorter side, 88–260 px. With
 * no camera size yet it assumes 3:4 on a portrait stage and 4:3 on a wide one.
 */
export function pipSize(video: VideoSize | null | undefined, stage: VideoSize): VideoSize {
  const short = Math.max(0, Math.min(stage.width, stage.height));
  const aspect = valid(video) ? video.width / video.height : stage.width >= stage.height ? 4 / 3 : 3 / 4;
  const longSide = Math.min(PIP_MAX, Math.max(PIP_MIN, Math.round(short * 0.32)));
  // Never taller / wider than about half the stage, whatever the camera shape.
  if (aspect >= 1) {
    const width = Math.min(longSide, Math.max(PIP_MIN, Math.round(stage.width * 0.45)));
    return { width, height: Math.round(width / aspect) };
  }
  const height = Math.min(longSide, Math.max(PIP_MIN, Math.round(stage.height * 0.45)));
  return { width: Math.round(height * aspect), height };
}
