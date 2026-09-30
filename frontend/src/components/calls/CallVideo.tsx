/**
 * One video of a call, fitted to its box by the shared rule
 * (shared/calls/videoFit.ts): cropped to fill only when the feed's shape is
 * close to the box's, otherwise shown whole over a soft blurred copy of
 * itself (a dark letterbox for a shared screen). It watches the track's real
 * size (`resize` fires when a phone rotates or a screen share changes window)
 * and the box's size, so the choice follows both.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { chooseVideoFit, type VideoFit, type VideoSize } from '@shared/calls';

/**
 * The element's size, kept current with a ResizeObserver. Returns a callback
 * ref, so it follows an element that appears later (the stage only exists
 * once the call is live).
 */
export function useElementSize<T extends HTMLElement>(): [VideoSize | null, (el: T | null) => void] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<VideoSize | null>(null);
  useEffect(() => {
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((cur) => (cur && Math.round(cur.width) === Math.round(r.width) && Math.round(cur.height) === Math.round(r.height) ? cur : { width: r.width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [size, setEl];
}

function attach(el: HTMLVideoElement | null, stream: MediaStream | null) {
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream) void el.play().catch(() => {});
}

export interface CallVideoProps {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  /** A shared screen: always shown whole, on plain black. */
  screen?: boolean;
  /** Force a fit instead of the automatic choice. */
  fit?: VideoFit;
  /** The blurred copy behind a letterboxed video (default on). */
  backdrop?: boolean;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  /** The video's intrinsic size, whenever it changes (e.g. to shape the self-view). */
  onVideoSize?: (size: VideoSize) => void;
  /** The speaker to play through (setSinkId; ignored where unsupported). */
  sinkId?: string | null;
}

export function CallVideo({ stream, muted, mirrored, screen, fit, backdrop = true, className, style, testId, onVideoSize, sinkId }: CallVideoProps) {
  const [box, boxRef] = useElementSize<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const backRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<VideoSize | null>(null);
  const sizeCb = useRef(onVideoSize);
  sizeCb.current = onVideoSize;

  // The element and its srcObject stay put through a dropout: the last frame stays on screen.
  useEffect(() => attach(videoRef.current, stream), [stream]);

  useEffect(() => {
    const el = videoRef.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el || muted || !el.setSinkId || sinkId === undefined) return;
    void el.setSinkId(sinkId ?? '').catch(() => {});
  }, [sinkId, muted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const read = () => {
      if (!el.videoWidth || !el.videoHeight) return;
      const next = { width: el.videoWidth, height: el.videoHeight };
      setVideo((cur) => (cur && cur.width === next.width && cur.height === next.height ? cur : next));
      sizeCb.current?.(next);
    };
    read();
    el.addEventListener('loadedmetadata', read);
    el.addEventListener('resize', read);
    return () => {
      el.removeEventListener('loadedmetadata', read);
      el.removeEventListener('resize', read);
    };
  }, [stream]);

  const chosen = fit ?? chooseVideoFit(video, box, { screen });
  const showBackdrop = backdrop && !screen && chosen === 'contain' && !!stream;

  useEffect(() => {
    if (showBackdrop) attach(backRef.current, stream);
  }, [showBackdrop, stream]);

  return (
    <div
      ref={boxRef}
      className={`cv${screen ? ' cv-screen' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      data-fit={chosen}
      data-video-size={video ? `${video.width}x${video.height}` : undefined}
    >
      {showBackdrop && <video ref={backRef} className="cv-backdrop" autoPlay playsInline muted aria-hidden="true" />}
      <video
        ref={videoRef}
        className="cv-video"
        data-testid={testId}
        autoPlay
        playsInline
        muted={muted}
        style={{ objectFit: chosen, transform: mirrored ? 'scaleX(-1)' : undefined }}
      />
    </div>
  );
}
