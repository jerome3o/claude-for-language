import { useEffect, useState } from 'react';

/**
 * A picked photo before it goes: the (already compressed) picture, an optional
 * caption, Send / Cancel. Enter sends.
 */
export function PhotoComposeSheet({
  blob,
  onSend,
  onCancel,
}: {
  blob: Blob;
  onSend: (caption: string) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState('');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal chat-photo-compose" role="dialog" aria-label="Send a photo" onClick={(e) => e.stopPropagation()}>
        <div className="chat-photo-compose-img">{url && <img src={url} alt="Photo to send" />}</div>
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
            Send
          </button>
        </form>
        <button type="button" className="btn btn-secondary chat-photo-compose-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
