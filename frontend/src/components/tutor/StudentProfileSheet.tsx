import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  STUDENT_LEVELS,
  STUDENT_LEVEL_LABELS,
  STUDENT_PROFILE_EXAMPLES,
  STUDENT_PROFILE_HINTS,
  STUDENT_PROFILE_MAX_CHARS,
  STUDENT_PROFILE_MAX_WORDS_PER_LESSON,
  applyStudentProfileExample,
  isStudentProfileEmpty,
  parseStudentProfileInput,
  sameStudentProfile,
  type StudentProfileExample,
  type StudentProfileFields,
} from '@shared/students';
import { saveStudentProfile } from '../../api/studentProfile';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';
import './tutor-dashboard.css';
import './student-profile.css';

interface Props {
  relId: string;
  studentName: string;
  /** What is saved now (Save is enabled once the draft differs from it). */
  saved: StudentProfileFields;
  /** Where the draft starts: the saved profile, or an example picked on the page. */
  initial?: StudentProfileFields;
  onClose: () => void;
}

function Choice<T extends string | boolean>({
  value,
  options,
  onChange,
  label,
  name,
}: {
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T | null) => void;
  label: string;
  name: string;
}) {
  return (
    <div className="sp-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            className={`sp-chip ${active ? 'active' : ''}`}
            data-testid={`sp-${name}-${String(o.value)}`}
            // Tapping the chosen one again clears it: every field is optional.
            onClick={() => onChange(active ? null : o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ExampleCard({ example, mode, onUse }: { example: StudentProfileExample; mode: 'use' | 'insert'; onUse: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sp-example" data-testid={`sp-example-${example.id}`}>
      <div className="sp-example-head">
        <div>
          <div className="sp-example-title">{example.title}</div>
          <div className="sp-example-summary">{example.summary}</div>
        </div>
      </div>
      {open && <pre className="sp-example-text">{example.profile.body}</pre>}
      <div className="sp-example-actions">
        <button type="button" className="btn-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide' : 'Read it'}
        </button>
        <button type="button" className="btn btn-secondary sp-small" onClick={onUse} data-testid={`sp-use-${example.id}`}>
          {mode === 'use' ? 'Use this' : 'Insert'}
        </button>
      </div>
    </div>
  );
}

/**
 * The editor for the tutor's private profile of a student: a few optional
 * facts the assistant acts on directly (level, handwriting, words per lesson)
 * and free text. Examples to start from sit beside it (below on phones).
 */
export function StudentProfileSheet({ relId, studentName, saved, initial = saved, onClose }: Props) {
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StudentProfileFields>(initial);
  const [wordsText, setWordsText] = useState(initial.words_per_lesson != null ? String(initial.words_per_lesson) : '');
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !sameStudentProfile(draft, saved);

  const close = () => {
    if (dirty && !confirm('Discard your changes to the profile?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const save = useMutation({
    mutationFn: (fields: StudentProfileFields) => saveStudentProfile(relId, fields),
    onSuccess: (profile) => {
      track('tutor.student_profile_save');
      queryClient.setQueryData(['student-profile', relId], profile);
      queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['student-overview', relId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save the profile'),
  });

  const setWords = (text: string) => {
    setWordsText(text);
    const n = Number(text);
    setDraft((d) => ({ ...d, words_per_lesson: text.trim() === '' ? null : Number.isFinite(n) ? n : d.words_per_lesson }));
  };

  const applyExample = (ex: StudentProfileExample) => {
    const next = applyStudentProfileExample(draft, ex.profile);
    setDraft(next);
    setWordsText(next.words_per_lesson != null ? String(next.words_per_lesson) : '');
    setError(null);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const wordsInvalid = wordsText.trim() !== '' && parseStudentProfileInput({ words_per_lesson: Number(wordsText) }).problems.length > 0;
  const chars = draft.body.trim().length;
  const tooLong = chars > STUDENT_PROFILE_MAX_CHARS;
  const empty = isStudentProfileEmpty(draft);
  const exampleMode = empty ? 'use' : 'insert';

  return (
    <div className="td-sheet-backdrop" onClick={close} role="presentation">
      <div className="td-sheet sp-sheet" role="dialog" aria-modal="true" aria-labelledby="sp-sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="td-sheet-head">
          <h2 id="sp-sheet-title">Student profile · {studentName}</h2>
          <button type="button" className="td-sheet-close" onClick={close} aria-label="Close">×</button>
        </div>
        <form
          className="td-sheet-body sp-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooLong || wordsInvalid || save.isPending) return;
            const { value, problems } = parseStudentProfileInput(draft);
            if (!value) {
              setError(problems.join(' · '));
              return;
            }
            setError(null);
            save.mutate(value);
          }}
        >
          <p className="sp-private-note">
            <span aria-hidden="true">🔒</span> Only you can see this — {studentName} never does. Claude follows it whenever it makes
            homework, mini lessons, readers or cards for {studentName}.
          </p>

          <div className="sp-layout">
            <div className="sp-main">
              <fieldset className="sp-facts-edit">
                <legend className="sn-label">At a glance <span className="sn-optional">(optional)</span></legend>
                <div className="sp-field">
                  <span className="sp-field-label">Level</span>
                  <Choice
                    name="level"
                    label="Level"
                    value={draft.level}
                    options={STUDENT_LEVELS.map((l) => ({ value: l, label: STUDENT_LEVEL_LABELS[l] }))}
                    onChange={(level) => setDraft((d) => ({ ...d, level }))}
                  />
                </div>
                <div className="sp-field">
                  <span className="sp-field-label">Writes characters by hand</span>
                  <Choice<boolean>
                    name="handwriting"
                    label="Writes characters by hand"
                    value={draft.handwriting}
                    options={[
                      { value: true, label: 'Yes' },
                      { value: false, label: 'No — typing only' },
                    ]}
                    onChange={(handwriting) => setDraft((d) => ({ ...d, handwriting }))}
                  />
                </div>
                <label className="sp-field sp-field-inline">
                  <span className="sp-field-label">New words per lesson</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={STUDENT_PROFILE_MAX_WORDS_PER_LESSON}
                    className={`sp-number ${wordsInvalid ? 'invalid' : ''}`}
                    value={wordsText}
                    placeholder="e.g. 15"
                    onChange={(e) => setWords(e.target.value)}
                    data-testid="sp-words"
                  />
                </label>
                {wordsInvalid && <div className="td-error">A whole number from 1 to {STUDENT_PROFILE_MAX_WORDS_PER_LESSON}</div>}
              </fieldset>

              <label className="sn-label" htmlFor="sp-body">What kind of learner is {studentName}, and what homework suits them?</label>
              <textarea
                id="sp-body"
                ref={textRef}
                className="sn-textarea sp-textarea"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder={`e.g. Adult beginner, learning for travel. Doesn't write characters by hand.\n- Audio first for every new word\n- 10–20 cards a lesson — mastery over volume\n- Likes football and cooking (reader topics)\n- Mixes up 2nd and 3rd tone`}
                rows={10}
                data-testid="sp-body"
              />
              <div className="sn-meta">
                <span className={tooLong ? 'sn-count over' : 'sn-count'}>
                  {chars.toLocaleString()} / {STUDENT_PROFILE_MAX_CHARS.toLocaleString()} characters · Markdown is fine
                </span>
              </div>
            </div>

            <aside className="sp-aside">
              <div className="sn-label">{empty ? 'Start from an example' : 'Examples'}</div>
              <div className="sp-examples">
                {STUDENT_PROFILE_EXAMPLES.map((ex) => (
                  <ExampleCard key={ex.id} example={ex} mode={exampleMode} onUse={() => applyExample(ex)} />
                ))}
              </div>
              <div className="sp-hints">
                <div className="sn-label">Useful to include</div>
                <ul>
                  {STUDENT_PROFILE_HINTS.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>

          {error && <div className="td-error" role="alert">{error}</div>}
          {!isOnline && <div className="td-error">You&rsquo;re offline — the profile can be saved once you&rsquo;re back online.</div>}

          <div className="sn-actions sp-actions">
            <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!dirty || tooLong || wordsInvalid || save.isPending || !isOnline} data-testid="sp-save">
              {save.isPending ? 'Saving…' : empty && !isStudentProfileEmpty(saved) ? 'Clear profile' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
