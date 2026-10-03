import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cropRect, initialCrop, MAX_ZOOM, panCrop, scaleOf, zoomCrop, type CropState, type SourceRect } from '../../services/profilePicture';
import './profile.css';

interface Props {
  image: HTMLImageElement;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (rect: SourceRect) => void;
}

/**
 * Square crop for a new profile photo: drag to move, pinch / wheel / slider to
 * zoom; the round guide shows what the avatar will look like. The geometry is
 * services/profilePicture.ts; the parent renders + uploads the chosen square.
 */
export function PictureCropSheet({ image, busy, error, onCancel, onConfirm }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  // Size the crop to the frame (and again if the sheet is resized, e.g. unfolding the phone).
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const fit = () => {
      const view = el.clientWidth;
      if (!view) return;
      setCrop((prev) => (prev && prev.view === view ? prev : initialCrop(image.naturalWidth, image.naturalHeight, view)));
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [image]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onCancel]);

  const local = useCallback((e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2 && crop) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: crop.zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !crop) return;
    const next = local(e);
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setCrop((c) => c && zoomCrop(c, pinch.current!.zoom * (dist / pinch.current!.dist), (a.x + b.x) / 2, (a.y + b.y) / 2));
    } else {
      setCrop((c) => c && panCrop(c, next.x - prev.x, next.y - prev.y));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!crop) return;
    const p = local(e);
    setCrop((c) => c && zoomCrop(c, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y));
  };

  const scale = crop ? scaleOf(crop) : 0;

  return (
    <div className="pf-sheet-backdrop" role="presentation" onClick={() => { if (!busy) onCancel(); }}>
      <div className="pf-sheet" role="dialog" aria-modal="true" aria-labelledby="pf-crop-title" onClick={(e) => e.stopPropagation()}>
        <div className="pf-sheet-head">
          <h2 id="pf-crop-title">Position your photo</h2>
          <button type="button" className="pf-sheet-close" onClick={onCancel} disabled={busy} aria-label="Close">×</button>
        </div>
        <p className="pf-sheet-hint">Drag to move · pinch or use the slider to zoom</p>

        <div
          ref={frameRef}
          className="pf-crop-frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          data-testid="crop-frame"
        >
          {crop && (
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pf-crop-img"
              style={{ left: crop.ox, top: crop.oy, width: crop.w * scale, height: crop.h * scale }}
            />
          )}
          <div className="pf-crop-ring" aria-hidden="true" />
        </div>

        <label className="pf-zoom">
          <span aria-hidden="true">−</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop?.zoom ?? 1}
            onChange={(e) => setCrop((c) => c && zoomCrop(c, Number(e.target.value)))}
            aria-label="Zoom"
            disabled={!crop || busy}
          />
          <span aria-hidden="true">+</span>
        </label>

        {error && <div className="inline-error" role="alert"><span className="inline-error-text">{error}</span></div>}

        <div className="pf-sheet-actions sheet-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => crop && onConfirm(cropRect(crop))}
            disabled={!crop || busy}
            data-testid="crop-confirm"
          >
            {busy ? 'Uploading…' : 'Use this photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
