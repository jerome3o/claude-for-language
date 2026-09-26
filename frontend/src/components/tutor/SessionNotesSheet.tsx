import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitSessionNotes } from '../../api/tutorNotes';
import type { SessionNotesJob, SessionNotesPriority } from '../../types/tutorNotes';
import { useNetwork } from '../../contexts/NetworkContext';
import './tutor-dashboard.css';
import './session-notes.css';

interface Props {
  relId: string;
  studentName: string;
  onClose: () => void;
  /** Called with the new job once it was accepted. */
  onSubmitted?: (job: SessionNotesJob) => void;
}

const MAX_CHARS = 120_000;

function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "Send session notes" bottom sheet: paste (or pick a text file of) the raw
 * notes from a lesson. The assistant works through them in the background;
 * the sheet closes as soon as the job is accepted and the section shows its
 * progress.
 */
export function SessionNotesSheet({ relId, studentName, onClose, onSubmitted }: Props) {
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [lessonAt, setLessonAt] = useState(todayInput());
  const [priority, setPriority] = useState<SessionNotesPriority>('core');
  const [autoShare, setAutoShare] = useState(true);
  const [logLesson, setLogLesson] = useState(true);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    textRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submit = useMutation({
    mutationFn: () =>
      submitSessionNotes(relId, {
        notes: notes.trim(),
        title: title.trim() || undefined,
        lesson_at: lessonAt || undefined,
        priority,
        auto_share: autoShare,
        log_lesson: logLesson,
      }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['session-notes', relId] });
      queryClient.invalidateQueries({ queryKey: ['lesson-log', relId] });
      onSubmitted?.(job);
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not send the notes'),
  });

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('That file is too big — paste the text instead');
      return;
    }
    try {
      const text = await file.text();
      setNotes((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
      setFileNote(`${file.name} added`);
      setError(null);
    } catch {
      setError('Could not read that file');
    }
  };

  const chars = notes.trim().length;
  const tooShort = chars < 20;
  const tooLong = chars > MAX_CHARS;

  return (
    <div className="td-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="td-sheet sn-sheet" role="dialog" aria-modal="true" aria-labelledby="sn-sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="td-sheet-head">
          <h2 id="sn-sheet-title">Session notes for {studentName}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form
          className="td-sheet-body sn-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort || tooLong || submit.isPending) return;
            setError(null);
            submit.mutate();
          }}
        >
          <p className="sn-help">
            Paste your raw notes from the lesson — any length, any format. The assistant reads them alongside {studentName}&rsquo;s
            existing cards and struggles, makes a deck of cards for the words you taught, and writes a mini lesson only when the notes
            show a grammar point with example sentences.
          </p>

          <label className="sn-label" htmlFor="sn-notes">Notes</label>
          <textarea
            id="sn-notes"
            ref={textRef}
            className="sn-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={'e.g.\n今天复习了点菜。新词：菜单 càidān menu, 服务员 fúwùyuán waiter…\n把 sentences: 把门关上。把书放在桌子上。\nHe keeps confusing 银行 and 很行…'}
            rows={9}
            data-testid="sn-notes"
          />
          <div className="sn-meta">
            <span className={tooLong ? 'sn-count over' : 'sn-count'}>{chars.toLocaleString()} characters{tooLong ? ` · max ${MAX_CHARS.toLocaleString()}` : ''}</span>
            <button type="button" className="btn-link" onClick={() => fileRef.current?.click()}>
              📎 Add a text file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.csv,text/plain,text/markdown"
              hidden
              onChange={(e) => {
                void onPickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {fileNote && <div className="sn-filenote">{fileNote}</div>}

          <div className="sn-row">
            <label className="sn-field">
              <span className="sn-label">Title <span className="sn-optional">(optional)</span></span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Restaurant ordering" maxLength={120} />
            </label>
            <label className="sn-field sn-field-date">
              <span className="sn-label">Lesson date</span>
              <input type="date" value={lessonAt} onChange={(e) => setLessonAt(e.target.value)} />
            </label>
          </div>

          <fieldset className="sn-options">
            <legend className="sn-label">When it&rsquo;s ready</legend>
            <label className="sn-check">
              <input type="checkbox" checked={autoShare} onChange={(e) => setAutoShare(e.target.checked)} />
              <span>Send the deck (and any lesson or reader) to {studentName} automatically</span>
            </label>
            {autoShare && (
              <div className="sn-priority" role="radiogroup" aria-label="Where in their queue">
                <label className={`sn-radio ${priority === 'core' ? 'active' : ''}`}>
                  <input type="radio" name="sn-priority" checked={priority === 'core'} onChange={() => setPriority('core')} />
                  <span><strong>Core</strong> · top of their queue</span>
                </label>
                <label className={`sn-radio ${priority === 'non_urgent' ? 'active' : ''}`}>
                  <input type="radio" name="sn-priority" checked={priority === 'non_urgent'} onChange={() => setPriority('non_urgent')} />
                  <span><strong>Non-urgent</strong> · after their other decks</span>
                </label>
              </div>
            )}
            {!autoShare && <div className="sn-hint">The deck stays in your library until you send it from Send homework.</div>}
            <label className="sn-check">
              <input type="checkbox" checked={logLesson} onChange={(e) => setLogLesson(e.target.checked)} />
              <span>Also log this as a lesson (Insights counts &ldquo;since last lesson&rdquo; from it)</span>
            </label>
          </fieldset>

          {error && <div className="td-error" role="alert">{error}</div>}
          {!isOnline && <div className="td-error">You&rsquo;re offline — the notes can be sent once you&rsquo;re back online.</div>}

          <div className="sn-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={tooShort || tooLong || submit.isPending || !isOnline} data-testid="sn-submit">
              {submit.isPending ? 'Sending…' : 'Start'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
