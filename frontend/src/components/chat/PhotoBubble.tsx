import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fitImage } from '../../services/chatThread';
import { useChatMedia } from '../../services/chatMedia';

const MAX_W = 280;
const MAX_H = 340;

/**
 * A photo in the chat: a rounded box sized from the attachment's width / height
 * before the bytes arrive (no layout jump), the picture fetched once with auth
 * and cached on the device. Tap → full-screen viewer.
 */
export function PhotoBubble({
  messageId,
  mediaUrl,
  width,
  height,
  localBlob,
  onOpen,
}: {
  messageId: string;
  mediaUrl: string | null | undefined;
  width: number;
  height: number;
  localBlob?: Blob | null;
  onOpen: (url: string) => void;
}) {
  const { url, error, retry } = useChatMedia(messageId, mediaUrl, localBlob);
  const box = fitImage(width, height, MAX_W, MAX_H);
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      type="button"
      className={`chat-photo${loaded ? ' loaded' : ''}`}
      style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}
      onClick={(e) => {
        e.stopPropagation();
        if (url) onOpen(url);
        else if (error) retry();
      }}
      aria-label={error ? "Photo didn't load — tap to retry" : 'Open photo'}
      data-testid="chat-photo"
    >
      {url && <img src={url} alt="" onLoad={() => setLoaded(true)} draggable={false} />}
      {error && <span className="chat-photo-error">Photo didn't load · Tap to retry</span>}
    </button>
  );
}

/** Full-screen photo: tap the backdrop / ✕ / Escape to close; pinch or double-tap to zoom. */
export function PhotoViewer({ url, caption, onClose }: { url: string; caption?: string | null; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTap = useRef(0);
  const moved = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      pinch.current = { dist: distance(), scale };
      drag.current = null;
    } else if (pointers.current.size === 1 && scale > 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      moved.current = true;
      setScale(Math.min(5, Math.max(1, pinch.current.scale * (distance() / pinch.current.dist))));
    } else if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      setOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      if (scale <= 1.02) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    }
  };
  const onImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (scale > 1) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      } else setScale(2.5);
      lastTap.current = 0;
    } else lastTap.current = now;
  };

  return createPortal(
    <div className="chat-viewer" role="dialog" aria-label="Photo" onClick={onClose} data-testid="chat-photo-viewer">
      <button type="button" className="chat-viewer-close" onClick={onClose} aria-label="Close photo">
        ✕
      </button>
      <img
        src={url}
        alt={caption || 'Photo'}
        className="chat-viewer-img"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        onClick={onImageClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => setScale((s) => Math.min(5, Math.max(1, s * (e.deltaY < 0 ? 1.15 : 0.87))))}
        draggable={false}
      />
      {caption && (
        <div className="chat-viewer-caption" onClick={(e) => e.stopPropagation()}>
          {caption}
        </div>
      )}
    </div>,
    document.body,
  );
}
