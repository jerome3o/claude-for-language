import { addDays, localDate, shortDay, splitIntoDays, suggestSplitDays, hasOneOff, type HomeworkMode } from '@shared/homework';
import './homework-tutor.css';

const MODES: Array<{ mode: HomeworkMode; title: string; sub: string }> = [
  { mode: 'one_off', title: 'One-off', sub: 'Once, by a date' },
  { mode: 'fsrs', title: 'Long-term', sub: 'Spaced review' },
  { mode: 'both', title: 'Both', sub: 'Once by a date, then long-term' },
];

interface Props {
  mode: HomeworkMode;
  onMode: (mode: HomeworkMode) => void;
  dueDate: string | null;
  onDueDate: (date: string) => void;
  /** Decks: how many words (enables "spread over N days"). */
  wordCount?: number;
  splitDays?: number;
  onSplitDays?: (days: number) => void;
  /** Radio-group name, unique per picker on a page. */
  name: string;
}

/**
 * How the student does this: a one-off pass by a date, long-term (FSRS)
 * review, or both — plus the due date and, for words, "spread over N days".
 */
export function HomeworkModePicker({ mode, onMode, dueDate, onDueDate, wordCount, splitDays = 1, onSplitDays, name }: Props) {
  const today = localDate();
  const quick = [
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'In 2 days', date: addDays(today, 2) },
    { label: 'In a week', date: addDays(today, 7) },
  ];
  const oneOff = hasOneOff(mode);
  const canSplit = oneOff && !!onSplitDays && (wordCount ?? 0) > 1;
  const parts = canSplit && dueDate && splitDays > 1 ? splitIntoDays(Array.from({ length: wordCount! }, (_, i) => i), splitDays, dueDate) : [];
  const suggestion = wordCount ? suggestSplitDays(wordCount) : 1;

  return (
    <div className="hwt-picker">
      <div className="hwt-modes" role="radiogroup" aria-label="How they study it">
        {MODES.map((m) => (
          <label key={m.mode} className={`hwt-mode${mode === m.mode ? ' selected' : ''}`}>
            <input type="radio" name={name} checked={mode === m.mode} onChange={() => onMode(m.mode)} />
            <strong>{m.title}</strong>
            <span>{m.sub}</span>
          </label>
        ))}
      </div>

      {oneOff && (
        <div className="hwt-due">
          <label className="hwt-due-label">
            <span>{parts.length > 1 ? 'First day due' : 'Due'}</span>
            <input type="date" value={dueDate ?? ''} min={today} onChange={(e) => e.target.value && onDueDate(e.target.value)} data-testid={`${name}-due`} />
          </label>
          <div className="hwt-quick">
            {quick.map((q) => (
              <button key={q.label} type="button" className={`hwt-chip${dueDate === q.date ? ' selected' : ''}`} onClick={() => onDueDate(q.date)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canSplit && (
        <div className="hwt-split">
          <label>
            <span>Spread the {wordCount} words over</span>
            <select value={splitDays} onChange={(e) => onSplitDays!(Number(e.target.value))} data-testid={`${name}-split`}>
              {[1, 2, 3, 4, 5, 7].filter((d) => d <= Math.max(1, wordCount!)).map((d) => (
                <option key={d} value={d}>{d === 1 ? '1 day (all at once)' : `${d} days`}</option>
              ))}
            </select>
          </label>
          {splitDays === 1 && suggestion > 1 && (
            <button type="button" className="btn-link hwt-suggest" onClick={() => onSplitDays!(Math.min(suggestion, 7))}>
              That&rsquo;s a lot at once — spread over {Math.min(suggestion, 7)} days?
            </button>
          )}
          {parts.length > 1 && (
            <ul className="hwt-parts">
              {parts.map((p) => (
                <li key={p.index}>
                  Day {p.index + 1} · due {shortDay(p.due_date)} · {p.items.length} {p.items.length === 1 ? 'word' : 'words'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
