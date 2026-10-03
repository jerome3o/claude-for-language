import { checkKindLabel, type NoteCheckIssue } from '@shared/cards/check';
import './cardCheck.css';

/**
 * One "⚠ Possible issue": what is wrong, current → proposed, why, and the two
 * taps — Apply fix / Dismiss. Never applied automatically.
 */
export function CheckIssueBlock({
  issue,
  busy,
  error,
  onApply,
  onDismiss,
}: {
  issue: Pick<NoteCheckIssue, 'field' | 'kind' | 'current' | 'proposed' | 'reason'>;
  busy?: boolean;
  error?: string | null;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="check-issue" data-testid="check-issue" onClick={(e) => e.stopPropagation()} role="group" aria-label="Possible issue">
      <div className="check-issue-head">⚠ Possible issue · {checkKindLabel(issue.kind)}</div>
      <div className="check-issue-change">
        <span className="check-issue-current">{issue.current || (issue.field === 'english' ? '(no meaning)' : '(no pinyin)')}</span>
        <span aria-hidden="true">→</span>
        <span className="check-issue-proposed">{issue.proposed}</span>
      </div>
      <div className="check-issue-reason">{issue.reason}</div>
      <div className="check-issue-actions">
        <button type="button" className="btn btn-primary" onClick={onApply} disabled={busy} data-testid="check-issue-apply">
          {busy ? 'Saving…' : 'Apply fix'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDismiss} disabled={busy} data-testid="check-issue-dismiss">
          Dismiss
        </button>
      </div>
      {error && <div className="check-issue-error" role="alert">{error}</div>}
    </div>
  );
}
