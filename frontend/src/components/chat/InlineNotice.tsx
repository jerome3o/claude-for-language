import { useEffect } from 'react';

export type NoticeKind = 'error' | 'success' | 'info';

export interface Notice {
  kind: NoticeKind;
  text: string;
}

interface InlineNoticeProps {
  notice: Notice | null;
  onDismiss: () => void;
  /** Success/info notices go away by themselves after this long (ms). Errors stay. */
  autoDismissMs?: number;
  className?: string;
}

/**
 * The Coach-style inline notice (`.coach-error`) used instead of `alert()`:
 * a coloured strip with the message and a 44px dismiss target.
 */
export function InlineNotice({ notice, onDismiss, autoDismissMs = 4000, className = '' }: InlineNoticeProps) {
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const t = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [notice, autoDismissMs, onDismiss]);

  if (!notice) return null;

  return (
    <div
      className={`chat-notice chat-notice-${notice.kind} ${className}`.trim()}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <span className="chat-notice-text">{notice.text}</span>
      <button type="button" className="chat-notice-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/** Turn a thrown value into a short, human sentence. */
export function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (!message || message === 'Unknown error') return fallback;
  if (/AI is not configured|apiKey|authToken|authentication method/i.test(message)) {
    return `${fallback} AI isn't available right now.`;
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return `${fallback} Check your connection and try again.`;
  }
  return `${fallback} ${message.endsWith('.') ? message : message + '.'}`;
}
