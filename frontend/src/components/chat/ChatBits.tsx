import { useEffect, useState } from 'react';
import type { ReceiptKind } from '../../services/chatThread';
import { SpinnerButton } from './SpinnerButton';

/** "Minghui is typing…" with the three bouncing dots. */
export function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="chat-typing-row" role="status" aria-live="polite" data-testid="chat-typing">
      <div className="chat-bubble typing" aria-hidden="true">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
      <span className="chat-typing-label">{name} is typing…</span>
    </div>
  );
}

/** Under my newest message: "Seen" or "Sent ✓". */
export function ReceiptLine({ kind }: { kind: ReceiptKind }) {
  return (
    <span className={`chat-receipt ${kind}`} data-testid="chat-receipt">
      {kind === 'seen' ? 'Seen' : 'Sent ✓'}
    </span>
  );
}

/** A pending / failed send's state, in place of the timestamp. */
export function OutboxState({
  status,
  onRetry,
  onDiscard,
}: {
  status: 'pending' | 'sending' | 'failed';
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (status === 'failed') {
    return (
      <span className="chat-outbox-failed" data-testid="chat-send-failed">
        <button type="button" className="chat-outbox-retry" onClick={onRetry}>
          Not sent · Tap to retry
        </button>
        <button type="button" className="chat-outbox-discard" onClick={onDiscard} aria-label="Discard this message">
          ✕
        </button>
      </span>
    );
  }
  return (
    <span className="chat-outbox-pending" title="Sending…" aria-label="Sending" data-testid="chat-send-pending">
      🕓
    </span>
  );
}

/** The round ↓ "jump to latest" button, with a badge when new messages arrived while scrolled up. */
export function NewMessagesPill({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="chat-new-pill"
      onClick={onClick}
      data-testid="chat-new-pill"
      aria-label={count > 0 ? `${count} new message${count === 1 ? '' : 's'} — jump to latest` : 'Jump to latest'}
    >
      <span aria-hidden="true">↓</span>
      {count > 0 && <span className="chat-new-pill-badge">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

/** Edit my message (or a photo's caption). */
export function EditMessageSheet({
  initial,
  isCaption,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: string;
  isCaption: boolean;
  busy: boolean;
  error: string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const unchanged = text.trim() === initial.trim();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal idk-dialog-modal" role="dialog" aria-label="Edit message" onClick={(e) => e.stopPropagation()}>
        <h3>{isCaption ? 'Edit caption' : 'Edit message'}</h3>
        <textarea
          className="idk-input chat-edit-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          aria-label="Message text"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !unchanged && (text.trim() || isCaption)) {
              e.preventDefault();
              onSave(text.trim());
            }
          }}
        />
        {error && (
          <div className="chat-notice chat-notice-error" role="alert">
            <span className="chat-notice-text">{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <SpinnerButton
            type="button"
            className="btn btn-primary"
            busy={busy}
            disabled={unchanged || (!isCaption && !text.trim())}
            onClick={() => onSave(text.trim())}
          >
            Save
          </SpinnerButton>
        </div>
      </div>
    </div>
  );
}

/** "Delete this message?" — for everyone. */
export function ConfirmDeleteSheet({
  busy,
  onConfirm,
  onCancel,
  count = 1,
  photos = false,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Several at once: every photo of an album ("Delete all"). */
  count?: number;
  photos?: boolean;
}) {
  const many = count > 1;
  const title = many ? `Delete these ${count} ${photos ? 'photos' : 'messages'}?` : photos ? 'Delete this photo?' : 'Delete this message?';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal idk-dialog-modal" role="alertdialog" aria-label="Delete message" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="modal-subtitle">{many ? 'They will be removed for both of you.' : 'It will be removed for both of you.'}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <SpinnerButton type="button" className="btn btn-danger chat-delete-confirm" busy={busy} onClick={onConfirm}>
            Delete
          </SpinnerButton>
        </div>
      </div>
    </div>
  );
}
