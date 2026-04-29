import type { Situation } from '../api/client';
import '../pages/RoleplayPage.css';

export function SituationPicker(props: {
  situations: Situation[];
  busy: boolean;
  onPick: (s: Situation) => void;
  highlightId?: string;
}) {
  const { situations, busy, onPick, highlightId } = props;
  const sorted = highlightId
    ? [...situations].sort((a, b) => (a.id === highlightId ? -1 : b.id === highlightId ? 1 : 0))
    : situations;
  return (
    <div className="rp-sit-list">
      {sorted.map((s) => (
        <button key={s.id} className="rp-sit" onClick={() => onPick(s)} disabled={busy}>
          <div className="rp-sit-title">
            {s.title}
            {s.id === highlightId && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#2952cc' }}>
                · today's pick
              </span>
            )}
          </div>
          <div className="rp-sit-goal">{s.goal}</div>
        </button>
      ))}
    </div>
  );
}
