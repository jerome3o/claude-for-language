import type { SentenceCoachResult } from '../../types';
import { CorrectionDiffLine } from './ChatCorrection';

export type DraftCheck =
  | { kind: 'loading'; draft: string }
  | { kind: 'ready'; draft: string; result: SentenceCoachResult }
  | { kind: 'error'; draft: string; text: string };

/**
 * "Check my Chinese" before sending (docs/CHAT.md PR 3): above the compose
 * box, the corrected sentence marked against my draft, the short critique,
 * and "Use this" (replaces the draft) / "Send as is".
 */
export function CheckDraftPanel({
  check,
  onUse,
  onSendAsIs,
  onRetry,
  onClose,
}: {
  check: DraftCheck;
  onUse: (text: string) => void;
  onSendAsIs: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const result = check.kind === 'ready' ? check.result : null;
  const corrected = result?.corrected?.hanzi?.trim() || '';
  const good = !!result && (result.isCorrect || !corrected || corrected === check.draft.trim());
  return (
    <div className="chat-check-panel" role="region" aria-label="Check my Chinese" data-testid="chat-check-panel">
      <div className="chat-check-head">
        <span>{check.kind === 'loading' ? 'Checking your Chinese…' : good ? '✓ Looks good' : '✏️ Suggested'}</span>
        <button type="button" className="chat-check-close" onClick={onClose} aria-label="Close the check">
          ×
        </button>
      </div>
      {check.kind === 'loading' && (
        <div className="chat-check-loading" role="status">
          <span className="chat-spinner" aria-hidden="true" />
        </div>
      )}
      {check.kind === 'error' && (
        <>
          <div className="chat-check-critique">{check.text}</div>
          <div className="chat-check-actions">
            <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onSendAsIs}>
              Send as is
            </button>
          </div>
        </>
      )}
      {result && (
        <>
          {!good && (
            <div className="chat-check-diff">
              <CorrectionDiffLine original={check.draft} corrected={corrected} />
              {result.corrected.pinyin && <div className="chat-check-pinyin">{result.corrected.pinyin}</div>}
            </div>
          )}
          {result.critique && <div className="chat-check-critique">{result.critique}</div>}
          <div className="chat-check-actions">
            {good ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={onSendAsIs}>
                Send
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onUse(corrected)}>
                  Use this
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={onSendAsIs}>
                  Send as is
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
