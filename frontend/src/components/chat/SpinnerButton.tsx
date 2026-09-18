import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface SpinnerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy: boolean;
  children: ReactNode;
}

/**
 * A button that shows a small spinner in place of its label while `busy`,
 * keeping its width so the layout doesn't jump.
 */
export function SpinnerButton({ busy, children, className = '', disabled, ...rest }: SpinnerButtonProps) {
  return (
    <button
      {...rest}
      className={`${className} spinner-btn ${busy ? 'is-busy' : ''}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="spinner-btn-label">{children}</span>
      {busy && <span className="chat-spinner spinner-btn-spinner" aria-hidden="true" />}
    </button>
  );
}
