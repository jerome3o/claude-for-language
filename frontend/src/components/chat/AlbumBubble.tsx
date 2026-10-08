import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { albumCounter, albumTiles } from '@shared/chats/bubbles';
import { useChatMedia } from '../../services/chatMedia';
import './chat-album.css';

/** One photo of an album (a message of its own). */
export interface AlbumPhoto {
  id: string;
  mediaUrl: string | null | undefined;
  width: number;
  height: number;
  /** A photo still in the outbox: shown from its own bytes. */
  localBlob?: Blob | null;
  /** Still uploading (the 🕓 on its tile). */
  pending?: boolean;
}

/** The collage's width; heights are fixed per layout so nothing jumps while photos load. */
const ALBUM_W = 264;
const LAYOUT_H: Record<number, number> = { 2: 176, 3: 264, 4: 264 };

function AlbumTile({ photo, onOpen, more, className }: { photo: AlbumPhoto; onOpen: () => void; more: number; className: string }) {
  const { url, error, retry } = useChatMedia(photo.id, photo.mediaUrl, photo.localBlob);
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      className={`chat-album-tile ${className}${loaded ? ' loaded' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (error && !url) retry();
        else onOpen();
      }}
      aria-label={more > 0 ? `Open the album — ${more} more photos` : 'Open photo'}
      data-testid="chat-album-tile"
      data-msg-id={photo.id}
    >
      {url && <img src={url} alt="" onLoad={() => setLoaded(true)} draggable={false} />}
      {error && !url && <span className="chat-photo-error">Tap to retry</span>}
      {more > 0 && <span className="chat-album-more">+{more}</span>}
      {photo.pending && <span className="chat-album-pending" aria-label="Sending">🕓</span>}
    </button>
  );
}

/**
 * Several photos sent together, drawn as ONE bubble (docs/CHAT.md "Photo albums"):
 * 2 side by side, 3 = one big + two small, 4 = 2 × 2, 5 or more = 2 × 2 with "+N"
 * on the last tile. Each tile fetches its own photo (cached on the device); the
 * layout's size is fixed, so loading never moves the thread. Tap a tile → the
 * viewer at that photo.
 */
export function AlbumBubble({ photos, onOpen }: { photos: AlbumPhoto[]; onOpen: (index: number) => void }) {
  const { tiles, more } = albumTiles(photos.length);
  const shown = photos.slice(0, tiles);
  const height = LAYOUT_H[Math.min(tiles, 4)] ?? 264;
  return (
    <div
      className={`chat-album chat-album-${tiles}`}
      style={{ width: ALBUM_W, height }}
      data-testid="chat-album"
      data-count={photos.length}
    >
      {shown.map((p, i) => (
        <AlbumTile
          key={p.id}
          photo={p}
          className={`t${i}`}
          more={i === tiles - 1 ? more : 0}
          onOpen={() => onOpen(i)}
        />
      ))}
    </div>
  );
}

/** One slide of the viewer: the photo fetched (cached), pinch / double-tap / wheel zoom like the single-photo viewer. */
function ViewerSlide({
  photo,
  active,
  zoom,
  onZoom,
}: {
  photo: AlbumPhoto;
  active: boolean;
  zoom: { scale: number; x: number; y: number };
  onZoom: (z: { scale: number; x: number; y: number }) => void;
}) {
  const { url, error, retry } = useChatMedia(photo.id, photo.mediaUrl, photo.localBlob);
  const z = active ? zoom : { scale: 1, x: 0, y: 0 };
  return (
    <div className="chat-album-slide" aria-hidden={!active}>
      {url ? (
        <img
          src={url}
          alt=""
          className="chat-viewer-img"
          style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.scale})` }}
          onWheel={(e) => active && onZoom({ ...zoom, scale: Math.min(5, Math.max(1, zoom.scale * (e.deltaY < 0 ? 1.15 : 0.87))) })}
          draggable={false}
        />
      ) : error ? (
        <button type="button" className="chat-album-slide-error" onClick={(e) => { e.stopPropagation(); retry(); }}>
          Photo didn't load · Tap to retry
        </button>
      ) : (
        <span className="chat-album-slide-loading" aria-label="Loading photo" />
      )}
    </div>
  );
}

export interface AlbumViewerAction {
  id: string;
  label: string;
  icon: string;
  /** Hidden when false (e.g. Delete on someone else's photo). */
  show?: boolean;
}

/**
 * The album viewer: full screen at the tapped photo, swipe left / right (touch or
 * mouse drag), ‹ › arrows and the arrow keys on a desktop, "3 / 5", pinch /
 * double-tap / wheel zoom (a zoomed photo pans instead of swiping), Escape or the
 * back gesture closes the viewer only. `actions` act on the photo on screen.
 */
export function AlbumViewer({
  photos,
  startIndex,
  caption,
  actions,
  onAction,
  onClose,
}: {
  photos: AlbumPhoto[];
  startIndex: number;
  caption?: string | null;
  actions?: AlbumViewerAction[];
  onAction?: (id: string, photo: AlbumPhoto, index: number) => void;
  onClose: () => void;
}) {
  const count = photos.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)));
  const [dragX, setDragX] = useState(0);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; t: number; ox: number; oy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 400));

  // A photo deleted while the viewer is open: stay in range.
  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(count - 1, 0));
  }, [count, index]);

  const go = useCallback(
    (delta: number) => {
      setZoom({ scale: 1, x: 0, y: 0 });
      setIndex((i) => Math.min(Math.max(i + delta, 0), count - 1));
    },
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [go, onClose]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { dist: distance(), scale: zoom.scale };
      gesture.current = null;
      setDragX(0);
    } else if (pointers.current.size === 1) {
      gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), ox: zoom.x, oy: zoom.y, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      setZoom((z) => ({ ...z, scale: Math.min(5, Math.max(1, pinch.current!.scale * (distance() / pinch.current!.dist))) }));
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
    if (zoom.scale > 1) setZoom((z) => ({ ...z, x: g.ox + dx, y: g.oy + dy }));
    else {
      // The first / last photo resists being pulled past the end.
      const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
      setDragX(atEdge ? dx / 3 : dx);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    if (zoom.scale <= 1.02 && zoom.scale !== 1) setZoom({ scale: 1, x: 0, y: 0 });
    if (!g) return;
    if (zoom.scale <= 1) {
      const dx = e.clientX - g.x;
      const fast = Math.abs(dx) / Math.max(1, Date.now() - g.t) > 0.5;
      setDragX(0);
      if ((Math.abs(dx) > width * 0.18 || (fast && Math.abs(dx) > 30)) && g.moved) {
        go(dx < 0 ? 1 : -1);
        return;
      }
    }
    if (!g.moved) {
      // Double tap: zoom in / out.
      const now = Date.now();
      if (now - lastTap.current < 300) {
        setZoom((z) => (z.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  const photo = photos[index];
  const visibleActions = (actions ?? []).filter((a) => a.show !== false);

  return createPortal(
    <div className="chat-viewer chat-album-viewer" role="dialog" aria-label="Photos" data-testid="chat-album-viewer">
      <div className="chat-album-top" onClick={(e) => e.stopPropagation()}>
        <span className="chat-album-counter" data-testid="chat-album-counter" aria-live="polite">
          {albumCounter(index, count)}
        </span>
        <div className="chat-album-actions">
          {photo &&
            visibleActions.map((a) => (
              <button key={a.id} type="button" className="chat-album-action" onClick={() => onAction?.(a.id, photo, index)} aria-label={a.label} title={a.label}>
                <span aria-hidden="true">{a.icon}</span>
              </button>
            ))}
          <button type="button" className="chat-album-action" onClick={onClose} aria-label="Close photos" title="Close">
            ✕
          </button>
        </div>
      </div>
      <div
        className="chat-album-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={`chat-album-track${dragX === 0 ? ' settle' : ''}`}
          style={{ transform: `translateX(calc(${-index * 100}% + ${dragX}px))` }}
        >
          {photos.map((p, i) => (
            <ViewerSlide key={p.id} photo={p} active={i === index} zoom={zoom} onZoom={setZoom} />
          ))}
        </div>
      </div>
      {index > 0 && (
        <button type="button" className="chat-album-arrow prev" onClick={() => go(-1)} aria-label="Previous photo">
          ‹
        </button>
      )}
      {index < count - 1 && (
        <button type="button" className="chat-album-arrow next" onClick={() => go(1)} aria-label="Next photo" data-testid="chat-album-next">
          ›
        </button>
      )}
      {caption && <div className="chat-viewer-caption">{caption}</div>}
    </div>,
    document.body,
  );
}
