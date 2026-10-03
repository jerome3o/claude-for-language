import { useEffect, useState } from 'react';

/**
 * Picked photos before they go: the (already compressed) pictures — one large,
 * several as a strip with ✕ to drop one — an optional caption (sent with the
 * first), Send / Cancel. Enter sends. Each photo goes as its own message.
 */
export function PhotoComposeSheet({
  blobs,
  onSend,
  onRemove,
  onCancel,
}: {
  blobs: Blob[];
  onSend: (caption: string) => void;
  onRemove?: (index: number) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState('');
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const u = blobs.map((b) => URL.createObjectURL(b));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [blobs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal chat-photo-compose" role="dialog" aria-label={blobs.length > 1 ? `Send ${blobs.length} photos` : 'Send a photo'} onClick={(e) => e.stopPropagation()}>
        {blobs.length === 1 ? (
          <div className="chat-photo-compose-img">{urls[0] && <img src={urls[0]} alt="Photo to send" />}</div>
        ) : (
          <div className="chat-photo-compose-strip" data-testid="photo-compose-strip">
            {urls.map((u, i) => (
              <div key={u} className="chat-photo-compose-thumb">
                <img src={u} alt={`Photo ${i + 1} of ${urls.length}`} />
                {onRemove && (
                  <button type="button" className="chat-photo-compose-remove" onClick={() => onRemove(i)} aria-label={`Remove photo ${i + 1}`}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <form
          className="chat-photo-compose-row"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(caption.trim());
          }}
        >
          <input
            type="text"
            className="chat-input"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption…"
            aria-label="Caption"
            maxLength={2000}
            autoFocus
          />
          <button type="submit" className="btn btn-primary chat-send" data-testid="photo-send">
            {blobs.length > 1 ? `Send ${blobs.length}` : 'Send'}
          </button>
        </form>
        <button type="button" className="btn btn-secondary chat-photo-compose-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
