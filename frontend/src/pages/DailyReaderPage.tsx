import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSituations,
  getDecks,
  generateGradedReader,
  markDailyActivity,
  type Situation,
} from '../api/client';
import { SituationPicker } from '../components/SituationPicker';
import './RoleplayPage.css';

export function DailyReaderPage() {
  const navigate = useNavigate();
  const [situations, setSituations] = useState<Situation[]>([]);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSituations().then((r) => setSituations(r.situations)).catch((e) => setError(String(e)));
    getDecks().then((d) => setDeckIds(d.map((x) => x.id))).catch(() => {});
  }, []);

  async function pick(s: Situation) {
    if (deckIds.length === 0) {
      setError('No decks found — create some vocabulary first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const topic = `A short conversation between ${s.user_role} and ${s.ai_role}. ${s.scenario} The goal: ${s.goal}`;
      const reader = await generateGradedReader(deckIds, topic, 'beginner');
      void markDailyActivity('reader', reader.id).catch(() => {});
      navigate(`/readers/${reader.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="roleplay-page">
      <h1>Today's reader</h1>
      <p className="rp-sub">
        Pick a situation. A short two-person conversation will be generated mostly from your known
        vocabulary.
      </p>
      {error && <div className="rp-error">{error}</div>}
      {busy && <p className="rp-sub">Generating — this takes a moment…</p>}
      <SituationPicker situations={situations} busy={busy} onPick={pick} />
    </div>
  );
}
