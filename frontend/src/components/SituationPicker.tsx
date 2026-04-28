import type { Situation } from '../api/client';
import '../pages/RoleplayPage.css';

export function SituationPicker(props: {
  situations: Situation[];
  busy: boolean;
  onPick: (s: Situation) => void;
}) {
  const { situations, busy, onPick } = props;
  return (
    <div className="rp-sit-list">
      {situations.map((s) => (
        <button key={s.id} className="rp-sit" onClick={() => onPick(s)} disabled={busy}>
          <div className="rp-sit-title">{s.title}</div>
          <div className="rp-sit-goal">{s.goal}</div>
        </button>
      ))}
    </div>
  );
}
