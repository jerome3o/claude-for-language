/**
 * "🎭 Practice a situation" — start a role-play with Claude (docs/CHAT.md "Practice with Claude";
 * shared/claude/practice.ts). A ready-made situation (ordering at a restaurant, a taxi…) or his own:
 * the situation, who Claude plays, who he is, and a level. Start = a practice thread with no message —
 * Claude speaks first — then the thread screen (`/chats/claude/:id`).
 *
 * Opened from the Chats tab's ✏️ picker, the old Claude page (Connections → Claude) and old
 * "new chat with Claude" links. Needs a connection (the scene is written by the server).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_PRACTICE_LEVEL, PRACTICE_LEVELS, PRACTICE_SCENARIOS, practiceContext, type PracticeLevel, type PracticeScenario } from '@shared/claude/practice';
import { startPracticeThread } from '../../services/claudeThreads';
import { useNetwork } from '../../contexts/NetworkContext';
import { track, trackError } from '../../services/analytics';
import { useAskLanguage } from '../../services/askClaudeLanguage';
import './practice-sheet.css';

export type PracticeStartSource = 'chats' | 'claude_page' | 'chat_link';

export interface PracticeSituationSheetProps {
  source: PracticeStartSource;
  onClose: () => void;
  /** Where ← on the thread screen goes (default: the Chats tab). */
  backTo?: string;
}

export function PracticeSituationSheet({ source, onClose, backTo = '/chats' }: PracticeSituationSheetProps) {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [language] = useAskLanguage();
  const [preset, setPreset] = useState<PracticeScenario | null>(null);
  const [scenario, setScenario] = useState('');
  const [aiRole, setAiRole] = useState('');
  const [userRole, setUserRole] = useState('');
  const [level, setLevel] = useState<PracticeLevel>(DEFAULT_PRACTICE_LEVEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (p: PracticeScenario) => {
    setPreset(p);
    setScenario(p.scenario);
    setAiRole(p.ai_role);
    setUserRole(p.user_role);
    setError(null);
  };

  const ctx = practiceContext({ scenario, ai_role: aiRole, user_role: userRole, level });
  // The fields were changed after a preset: it is his own situation now.
  const presetId = preset && preset.scenario === scenario.trim() && preset.ai_role === aiRole.trim() && preset.user_role === userRole.trim() ? preset.id : 'custom';

  const start = async () => {
    if (!ctx || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await startPracticeThread(ctx, { language });
      track('claude.practice_start', { source, preset: presetId, level });
      navigate(`/chats/claude/${encodeURIComponent(id)}?source=practice`, { state: { from: backTo } });
    } catch (err) {
      trackError('claude_practice_start', err);
      setError(err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : "Couldn't start the role-play — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="practice-sheet-backdrop" onClick={onClose}>
      <div className="practice-sheet" role="dialog" aria-label="Practice a situation" onClick={(e) => e.stopPropagation()} data-testid="practice-sheet">
        <div className="practice-sheet-body">
          <h2>🎭 Practice a situation</h2>
          <p className="practice-sheet-lead">Claude plays someone in the situation and talks with you in Chinese — Claude starts. Stuck? 💡 a hint, 🆘 how to say something, ✏️ a correction.</p>

          <div className="practice-presets" role="group" aria-label="Situations">
            {PRACTICE_SCENARIOS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`practice-preset${preset?.id === p.id ? ' on' : ''}`}
                aria-pressed={preset?.id === p.id}
                onClick={() => pick(p)}
                data-testid={`practice-preset-${p.id}`}
              >
                <span className="practice-preset-icon" aria-hidden="true">{p.icon}</span>
                <span className="practice-preset-text">
                  <strong>{p.label}</strong>
                  <span lang="zh">{p.scenario}</span>
                </span>
              </button>
            ))}
          </div>

          <label className="practice-field">
            <span>The situation</span>
            <textarea
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              rows={2}
              placeholder="e.g. 在咖啡店点咖啡 — or in English: buying a train ticket to Shanghai"
              data-testid="practice-scenario"
            />
          </label>
          <div className="practice-roles">
            <label className="practice-field">
              <span>Claude plays</span>
              <input value={aiRole} onChange={(e) => setAiRole(e.target.value)} placeholder="e.g. the barista" data-testid="practice-ai-role" />
            </label>
            <label className="practice-field">
              <span>You are</span>
              <input value={userRole} onChange={(e) => setUserRole(e.target.value)} placeholder="e.g. a customer" data-testid="practice-user-role" />
            </label>
          </div>

          <div className="practice-levels" role="radiogroup" aria-label="Level">
            {PRACTICE_LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={level === l.id}
                className={`practice-level${level === l.id ? ' on' : ''}`}
                onClick={() => setLevel(l.id)}
                title={l.hint}
                data-testid={`practice-level-${l.id}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="practice-level-hint">{PRACTICE_LEVELS.find((l) => l.id === level)?.hint}</p>

          {error && (
            <p className="practice-error" role="alert">
              {error}
            </p>
          )}
          {!isOnline && <p className="practice-error">Practising with Claude needs a connection.</p>}

          <div className="sheet-footer practice-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={!ctx || busy || !isOnline} data-testid="practice-start">
              {busy ? 'Starting…' : '▶ Start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PracticeSituationSheet;
