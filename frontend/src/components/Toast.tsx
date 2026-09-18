import { useCallback, useEffect, useState } from 'react';
import './Toast.css';

/**
 * Lightweight transient notice — the replacement for browser `alert()`.
 *
 * Usage:
 *   const [toast, showToast] = useToast();
 *   ...
 *   showToast('Could not import that file');
 *   ...
 *   <Toast message={toast} />
 *
 * The message clears itself after `durationMs` (default 3.5 s). Showing a
 * new message restarts the timer. Errors that the user needs to act on
 * belong in an inline `.inline-error` block next to the control instead.
 */
export function useToast(durationMs = 3500): [string | null, (msg: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(t);
  }, [toast, durationMs]);
  const show = useCallback((msg: string) => {
    // Re-showing the same text should still restart the timer: clear then set.
    setToast(null);
    // A microtask is enough for React to see two distinct updates.
    queueMicrotask(() => setToast(msg));
  }, []);
  return [toast, show];
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="app-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

/** Inline error block (the Sentence Coach style) for failures next to the control that caused them. */
export function InlineError({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="inline-error" role="alert">
      <span className="inline-error-text">{message}</span>
      {onDismiss && (
        <button type="button" className="inline-error-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
