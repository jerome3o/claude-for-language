import { useEffect, useState } from 'react';
import { VoiceTextInput } from '../voice/VoiceTextInput';
import { AnnotationCanvas } from '../AnnotationCanvas';
import { getConsoleBuffer } from '../../utils/consoleBuffer';
import { feedbackContext, queueFeedback } from '../../services/feedback';
import { track, trackError } from '../../services/analytics';
import { FEEDBACK_COPY, FEEDBACK_MAX_MESSAGE, feedbackContextLine, type FeedbackKind, type FeedbackVia } from '@shared/feedback';

export interface FeedbackSheetProps {
  via: FeedbackVia;
  /** The page it was opened on. */
  path: string;
  /** The screen as it was when the sheet was asked for (JPEG data URL), or null. */
  screenshot: string | null;
  onClose: () => void;
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

/**
 * "Send feedback" (docs/FEEDBACK.md): 💡 Idea / 🐛 Something's wrong, a voice-first message box, the
 * screenshot of the page (tap to draw on it, untick to leave it out), opt-in console logs. Sent at
 * once, or saved and sent when back online.
 */
export function FeedbackSheet({ via, path, screenshot, onClose }: FeedbackSheetProps) {
  const [kind, setKind] = useState<FeedbackKind>(via === 'shake' ? 'bug' : 'feedback');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<string | null>(screenshot);
  const [includeShot, setIncludeShot] = useState(!!screenshot);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'sent' | 'queued' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const context = feedbackContext(via, path);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onClose, 1600);
    return () => window.clearTimeout(t);
  }, [done, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !annotating) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, annotating, onClose]);

  const hasShot = includeShot && !!shot;
  const send = async (text: string) => {
    if (busy) return;
    if (!text.trim() && !hasShot) {
      setError('Write a message or keep the screenshot.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob = hasShot && shot ? await dataUrlToBlob(shot) : null;
      const logs = includeLogs ? getConsoleBuffer()?.getLogsAsString() ?? null : null;
      const out = await queueFeedback({ message: text.slice(0, FEEDBACK_MAX_MESSAGE), kind, context, consoleLogs: logs, screenshot: blob });
      track('feedback.sent', { via, kind, has_screenshot: !!blob, queued: !out.sent });
      setDone(out.sent ? 'sent' : 'queued');
    } catch (err) {
      trackError('feedback_send', err);
      setError(err instanceof Error ? err.message : 'Could not send feedback');
    } finally {
      setBusy(false);
    }
  };

  if (annotating && shot) {
    return (
      <AnnotationCanvas
        screenshotDataUrl={shot}
        onSave={(url) => { setShot(url); setAnnotating(false); setEdited(true); }}
        onCancel={() => setAnnotating(false)}
      />
    );
  }

  const line = feedbackContextLine(context);

  return (
    <div className="feedback-modal-overlay" onClick={() => { if (!busy) onClose(); }} data-html2canvas-ignore>
      <div className="feedback-modal" role="dialog" aria-modal="true" aria-label={FEEDBACK_COPY.title} onClick={(e) => e.stopPropagation()} data-testid="feedback-sheet">
        <div className="feedback-modal-header">
          <h3>{FEEDBACK_COPY.title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>&times;</button>
        </div>

        {done ? (
          <div className="feedback-success" data-testid="feedback-done">
            <p>{done === 'sent' ? FEEDBACK_COPY.sent : FEEDBACK_COPY.queued}</p>
          </div>
        ) : (
          <>
            <div className="feedback-kind-chips" role="radiogroup" aria-label="What kind of feedback">
              {(['bug', 'feedback'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={`feedback-kind-chip${kind === k ? ' is-on' : ''}`}
                  onClick={() => setKind(k)}
                  disabled={busy}
                  data-testid={`feedback-kind-${k}`}
                >
                  {k === 'bug' ? FEEDBACK_COPY.bugChip : FEEDBACK_COPY.ideaChip}
                </button>
              ))}
            </div>

            <VoiceTextInput
              surface="feedback"
              value={message}
              onChange={setMessage}
              onSubmit={(answer) => void send(answer.text)}
              placeholder={FEEDBACK_COPY.placeholder}
              listeningPlaceholder="Listening… what happened?"
              submitLabel={busy ? 'Sending…' : 'Send'}
              multiline
              lang="en"
              disabled={busy}
              testId="feedback-input"
            />

            {shot && (
              <div className="feedback-shot">
                <label className="feedback-checkbox-label">
                  <input type="checkbox" checked={includeShot} onChange={(e) => setIncludeShot(e.target.checked)} disabled={busy} data-testid="feedback-include-shot" />
                  <span>{FEEDBACK_COPY.screenshotOn}</span>
                </label>
                {includeShot && (
                  <button type="button" className="feedback-screenshot-btn" onClick={() => setAnnotating(true)} disabled={busy}>
                    <img src={shot} alt="Screenshot of the page" className="feedback-shot-img" />
                    {edited && <span className="feedback-annotated-badge">edited</span>}
                    <span className="feedback-screenshot-hint">Tap to draw on it or cover something</span>
                  </button>
                )}
                {includeShot && <p className="feedback-shot-note">{FEEDBACK_COPY.screenshotNote} It may miss videos and drawings.</p>}
              </div>
            )}

            <label className="feedback-checkbox-label feedback-logs">
              <input type="checkbox" checked={includeLogs} onChange={(e) => setIncludeLogs(e.target.checked)} disabled={busy} />
              <span>Include console logs (for bugs)</span>
            </label>

            {line && <div className="feedback-context">{line}</div>}
            {error && <div className="study-inline-error" role="alert">{error}</div>}

            {!message.trim() && hasShot && (
              <div className="feedback-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void send('')} disabled={busy} data-testid="feedback-send-shot">
                  Send the screenshot only
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
