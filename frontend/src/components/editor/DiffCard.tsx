/**
 * Compact rendering of a lesson diff — added / removed / moved / changed
 * exercises with type icons, plus title/section changes. Used for Claude's
 * proposals in the editor chat.
 */

import { LessonDiff, LessonExercise, exercisePrimaryText } from '@shared/lesson';

export const EXERCISE_ICONS: Record<LessonExercise['type'], string> = {
  note: '📖',
  scramble: '🧩',
  choice: '🔘',
  translate: '✍️',
  match: '🔗',
  describe_image: '🖼',
  speak: '🎤',
  listen_choice: '👂',
  listen_translate: '👂',
};

export const EXERCISE_TYPE_NAMES: Record<LessonExercise['type'], string> = {
  note: 'Note',
  scramble: 'Word order',
  choice: 'Multiple choice',
  translate: 'Translate',
  match: 'Match pairs',
  describe_image: 'Describe picture',
  speak: 'Speak',
  listen_choice: 'Listen & pick',
  listen_translate: 'Listen & translate',
};

function short(value: unknown, max = 50): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ExerciseLabel({ exercise }: { exercise: LessonExercise }) {
  return (
    <span className="diff-exercise-label">
      <span className="diff-exercise-icon" aria-hidden="true">{EXERCISE_ICONS[exercise.type] ?? '•'}</span>
      <span className="diff-exercise-type">{EXERCISE_TYPE_NAMES[exercise.type] ?? exercise.type}</span>
      <span className="diff-exercise-text">{short(exercisePrimaryText(exercise))}</span>
    </span>
  );
}

export function DiffCard({ diff }: { diff: LessonDiff }) {
  if (!diff.changed) {
    return <div className="diff-card empty">No changes — the proposal matches the current lesson.</div>;
  }
  return (
    <div className="diff-card">
      {diff.meta.map(m => (
        <div key={m.field} className="diff-row meta">
          <span className="diff-badge changed">~</span>
          <span>
            <strong>{m.field}</strong>: <s>{short(m.before)}</s> → {short(m.after)}
          </span>
        </div>
      ))}
      {diff.sections.map((s, i) => (
        <div key={`s${i}`} className="diff-row section">
          <span className={`diff-badge ${s.kind === 'added' ? 'added' : s.kind === 'removed' ? 'removed' : 'changed'}`}>
            {s.kind === 'added' ? '+' : s.kind === 'removed' ? '−' : '~'}
          </span>
          <span>
            {s.kind === 'renamed'
              ? <>Section {s.index + 1} renamed: <s>{s.before || 'untitled'}</s> → {s.after || 'untitled'}</>
              : <>Section {s.index + 1} “{s.title || 'untitled'}” {s.kind} ({s.exerciseCount} exercises)</>}
          </span>
        </div>
      ))}
      {diff.exercises.map((e, i) => {
        const cls = e.kind === 'added' ? 'added' : e.kind === 'removed' ? 'removed' : e.kind === 'moved' ? 'moved' : 'changed';
        const sym = e.kind === 'added' ? '+' : e.kind === 'removed' ? '−' : e.kind === 'moved' ? '↕' : '~';
        return (
          <div key={`e${i}`} className={`diff-row ${cls}`}>
            <span className={`diff-badge ${cls}`}>{sym}</span>
            <div className="diff-row-body">
              <div className="diff-where">
                §{e.section + 1}.{e.index + 1}
                {e.kind === 'moved' && <> (from §{e.fromSection + 1}.{e.fromIndex + 1})</>}
              </div>
              <ExerciseLabel exercise={e.kind === 'changed' ? e.after : e.exercise} />
              {e.kind === 'changed' && e.fields.length > 0 && (
                <ul className="diff-fields">
                  {e.fields.map(f => (
                    <li key={f.field}>
                      <strong>{f.field}</strong>: {f.before != null && <s>{short(f.before, 40)}</s>} {f.before != null && f.after != null && '→ '}{f.after != null && short(f.after, 40)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
