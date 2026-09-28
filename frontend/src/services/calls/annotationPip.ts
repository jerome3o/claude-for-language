/**
 * The sharer's always-on-top mini window (Document Picture-in-Picture, Chrome
 * and Edge on desktop): their own shared screen with the other person's
 * drawings and pings over it, so they see what's being circled while they
 * look at their other window. A browser can't draw on the real screen; this
 * window is the closest it gets. Where Document PiP doesn't exist the drawings
 * still show in the call's own preview of the share.
 */

import type { VideoSize } from '@shared/calls';
import { drawAnnotations, fitCanvas, type AnnotationStore } from './annotations';

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
  window: Window | null;
}

function api(): DocumentPictureInPicture | null {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
    ? ((window as unknown as { documentPictureInPicture: DocumentPictureInPicture }).documentPictureInPicture)
    : null;
}

export function annotationPipSupported(): boolean {
  return api() !== null;
}

export interface AnnotationPip {
  close(): void;
  readonly closed: boolean;
}

/**
 * Open the mini window (must run from a click). `onClosed` fires when the
 * person closes it. Returns null when unsupported or refused.
 */
export async function openAnnotationPip(stream: MediaStream, store: AnnotationStore, onClosed: () => void): Promise<AnnotationPip | null> {
  const pipApi = api();
  if (!pipApi) return null;
  const track = stream.getVideoTracks()[0];
  const s = track?.getSettings();
  const aspect = s?.width && s?.height ? s.width / s.height : 16 / 9;
  const width = 480;
  let pip: Window;
  try {
    pip = await pipApi.requestWindow({ width, height: Math.round(width / aspect) + 28 });
  } catch {
    return null;
  }
  const doc = pip.document;
  doc.title = 'Drawings on your screen';
  const style = doc.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f14; overflow: hidden; font-family: system-ui, sans-serif; }
    .wrap { position: absolute; inset: 0 0 28px 0; }
    video, canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    video { object-fit: contain; }
    .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 28px; display: flex; align-items: center; gap: 6px; padding: 0 10px; color: #d1d5db; font-size: 12px; background: #111827; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #f43f5e; }
    .live .dot { animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .3 } }
  `;
  doc.head.append(style);
  const wrap = doc.createElement('div');
  wrap.className = 'wrap';
  const video = doc.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  const canvas = doc.createElement('canvas');
  wrap.append(video, canvas);
  const bar = doc.createElement('div');
  bar.className = 'bar';
  const dot = doc.createElement('span');
  dot.className = 'dot';
  const label = doc.createElement('span');
  label.textContent = 'Your shared screen — drawings show here';
  bar.append(dot, label);
  doc.body.append(wrap, bar);
  void video.play().catch(() => {});

  let closed = false;
  let raf = 0;
  const videoSize = (): VideoSize | null => (video.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : null);
  const frame = () => {
    raf = 0;
    if (closed) return;
    const box = fitCanvas(canvas, pip);
    const ctx = canvas.getContext('2d');
    if (ctx) drawAnnotations(ctx, box, videoSize(), store);
    const active = store.active();
    bar.classList.toggle('live', active);
    label.textContent = active && store.lastRemoteName ? `${store.lastRemoteName} is drawing on your screen` : 'Your shared screen — drawings show here';
    if (active) raf = pip.requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !closed) raf = pip.requestAnimationFrame(frame);
  };
  const unsub = store.subscribe(kick);
  pip.addEventListener('resize', kick);
  video.addEventListener('loadedmetadata', kick);
  kick();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsub();
    if (raf) pip.cancelAnimationFrame(raf);
    onClosed();
  };
  pip.addEventListener('pagehide', cleanup);
  return {
    close() {
      cleanup();
      pip.close();
    },
    get closed() {
      return closed;
    },
  };
}
