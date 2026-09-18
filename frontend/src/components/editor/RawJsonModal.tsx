/**
 * "Advanced → Raw JSON": edit the spec as text. Parse errors and validator
 * problems are shown before anything is applied to the form. Defaults to
 * the lesson validator; the reader editor passes validateReaderSpec.
 */

import { useState } from 'react';
import { validateLessonSpec } from '@shared/lesson';

export function RawJsonModal<TSpec>({ spec, onApply, onClose, validate = validateLessonSpec, subject = 'lesson' }: {
  spec: TSpec;
  onApply: (spec: TSpec) => void;
  onClose: () => void;
  validate?: (value: unknown) => string[];
  subject?: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(spec, null, 2));
  const [problems, setProblems] = useState<string[]>([]);

  function apply() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setProblems([`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`]);
      return;
    }
    const errors = validate(parsed);
    if (errors.length > 0) {
      setProblems(errors);
      return;
    }
    onApply(parsed as TSpec);
  }

  return (
    <div className="ed-modal-overlay" onClick={onClose}>
      <div className="ed-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Raw JSON">
        <div className="ed-modal-head">
          <span>Raw JSON</span>
          <button type="button" className="ed-mini-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ed-modal-body">
          <p className="ed-hint">The {subject} spec exactly as it is stored. Edit and apply — changes go into the form (unsaved until you press Save).</p>
          <textarea className="ed-input" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
          {problems.length > 0 && (
            <ul className="ed-errors">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
        </div>
        <div className="ed-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
