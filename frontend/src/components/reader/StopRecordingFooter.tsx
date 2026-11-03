/**
 * ONE big red "■ Stop recording" (then a quiet "Checking…" while the take is judged): the graded reader's
 * read-aloud footer (`ReadAloudStopFooter`) and the sentence takes' pinned bar (study/SentencePractise.tsx
 * `SentenceStopBar`). Kept light — no rules imported — so both can use it.
 */
import './ReadAloud.css';

export function StopRecordingFooter({ recording, onStop, label, checkingLabel, testId }: {
  recording: boolean;
  onStop: () => void;
  label: string;
  checkingLabel: string;
  testId: string;
}) {
  return (
    <div className="study-reader-nav reader-read-aloud-footer" data-testid="reader-read-aloud-footer">
      <button
        type="button"
        className={`btn reader-read-aloud-stop-btn${recording ? '' : ' checking'}`}
        onClick={onStop}
        disabled={!recording}
        data-testid={testId}
      >
        {recording ? (
          <>
            <span className="reader-read-aloud-stop-square" aria-hidden="true" />
            {label}
          </>
        ) : (
          <>
            <span className="spinner reader-read-aloud-spinner" aria-hidden="true" />
            {checkingLabel}
          </>
        )}
      </button>
    </div>
  );
}
