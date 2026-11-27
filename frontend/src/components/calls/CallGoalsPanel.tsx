/**
 * 🎯 Structures to use in the call (shared/calls/goals.ts, docs/VIDEO_CALLS.md "Structures to use"):
 * the top-bar chip both people see ("🎯 1/4") and the panel it opens — the list, each structure big
 * with its line, meaning and the lesson's example (▶), ✓ + what he said when used, "✓ checking…"
 * while the check runs, the near miss; ↑ / ↓ / ✕ for either person, ✓ Tick / Untick for the tutor;
 * "Add a structure" (a pattern like 一…就…). A per-device panel over the stage (not a stage tile: on
 * Same view a tile would pull the tutor's stage along whenever the student looks at his goals).
 */
import { useState } from 'react';
import {
  formatOffset,
  goalHitCaption,
  goalListenNote,
  goalSourceLine,
  goalsChipAria,
  goalsChipLabel,
  goalsEmptyText,
  goalsIntro,
  GOALS_ADD_PLACEHOLDER,
  GOALS_LIST_MAX,
  GOALS_TITLE,
  GOAL_CHECKING_LABEL,
  GOAL_TICK_LABEL,
  GOAL_UNTICK_LABEL,
  parseGoalPattern,
  type CallGoal,
  type CallGoals,
  type CallGoalsAction,
  type GoalListenStatus,
} from '@shared/calls';
import { useLessonSpeak } from '../editor/useLessonSpeak';
import { track } from '../../services/analytics';

export function CallGoalsChip({ goals, open, onToggle, flash }: { goals: CallGoals | null; open: boolean; onToggle: () => void; flash: boolean }) {
  const label = goalsChipLabel(goals);
  if (label === null) return null;
  const done = !!goals && goals.goals.length > 0 && goals.goals.every((g) => g.status === 'used');
  return (
    <button
      type="button"
      className={`call-goals-chip${done ? ' done' : ''}${flash ? ' flash' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={goalsChipAria(goals)}
      title="Structures to use in this call"
      data-testid="call-goals-chip"
    >
      {label}
    </button>
  );
}

interface PanelProps {
  goals: CallGoals;
  isStudent: boolean;
  /** I may tick / untick by hand (the tutor; anyone in a solo call). */
  canTick: boolean;
  listenStatus: GoalListenStatus;
  /** The call's start in room time (a tick shows "at 12:31" into the call). */
  startedAt: number | null;
  onAction: (a: CallGoalsAction) => void;
  onClose: () => void;
}

function GoalRow({ g, i, n, canTick, startedAt, onAction, speak }: { g: CallGoal; i: number; n: number; canTick: boolean; startedAt: number | null; onAction: PanelProps['onAction']; speak: (t: string) => void }) {
  return (
    <li className={`call-goal ${g.status}`} data-testid={`call-goal-${i}`} data-status={g.status}>
      <div className="call-goal-head">
        <span className="call-goal-mark" aria-hidden="true">{g.status === 'used' ? '✓' : g.status === 'checking' ? '…' : '○'}</span>
        <span className="call-goal-name" lang="zh">{g.name}</span>
        <span className="call-goal-tools">
          {i > 0 && <button type="button" onClick={() => onAction({ kind: 'move', id: g.id, to: i - 1 })} aria-label={`Move ${g.name} up`}>↑</button>}
          {i < n - 1 && <button type="button" onClick={() => onAction({ kind: 'move', id: g.id, to: i + 1 })} aria-label={`Move ${g.name} down`}>↓</button>}
          <button type="button" onClick={() => onAction({ kind: 'remove', id: g.id })} aria-label={`Remove ${g.name}`} data-testid={`call-goal-remove-${i}`}>✕</button>
        </span>
      </div>
      {g.line && <div className="call-goal-line" lang="zh">{g.line}</div>}
      {g.meaning && <div className="call-goal-meaning">{g.meaning}</div>}
      {g.example && (
        <button type="button" className="call-goal-example" lang="zh" onClick={() => speak(g.example!)} title="Listen">
          ▶ {g.example}
        </button>
      )}
      {g.status === 'used' && g.used && (
        <div className="call-goal-hit" data-testid={`call-goal-hit-${i}`}>
          <span className="call-goal-hit-caption">{goalHitCaption(g.used)}{startedAt && g.used.at >= startedAt ? ` · ${formatOffset(g.used.at - startedAt)}` : ''}</span>
          {g.used.text && <span className="call-goal-said" lang="zh">“{g.used.text}”</span>}
        </div>
      )}
      {g.status === 'checking' && g.checking && (
        <div className="call-goal-hit checking" data-testid={`call-goal-checking-${i}`}>
          <span className="call-goal-hit-caption">{GOAL_CHECKING_LABEL}</span>
          <span className="call-goal-said" lang="zh">“{g.checking.text}”</span>
        </div>
      )}
      {g.status === 'near' && g.near && (
        <div className="call-goal-hit near" data-testid={`call-goal-near-${i}`}>
          <span className="call-goal-hit-caption">Close — not quite the structure:</span>
          <span className="call-goal-said" lang="zh">“{g.near.text}”</span>
        </div>
      )}
      <div className="call-goal-foot">
        <span className="call-goal-source">{goalSourceLine(g)}</span>
        {canTick && g.status !== 'used' && (
          <button type="button" className="call-goal-tick" onClick={() => onAction({ kind: 'tick', id: g.id })} data-testid={`call-goal-tick-${i}`}>{GOAL_TICK_LABEL}</button>
        )}
        {canTick && (g.status === 'used' || g.status === 'checking') && (
          <button type="button" className="call-goal-untick" onClick={() => onAction({ kind: 'untick', id: g.id })} data-testid={`call-goal-untick-${i}`}>{GOAL_UNTICK_LABEL}</button>
        )}
      </div>
    </li>
  );
}

export function CallGoalsPanel({ goals, isStudent, canTick, listenStatus, startedAt, onAction, onClose }: PanelProps) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const speak = useLessonSpeak();
  const note = goalListenNote(listenStatus, isStudent);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseGoalPattern(text);
    if (!p) {
      setProblem('Type a pattern with its Chinese words, e.g. 一…就… or 除了…还…');
      return;
    }
    if (goals.goals.some((g) => g.name === p.name)) {
      setProblem('That one is already on the list.');
      return;
    }
    onAction({ kind: 'add', text });
    track('call.goals_add', { fixed: p.fixed.length });
    setText('');
    setProblem(null);
  };
  return (
    <section className="call-goals-panel" aria-label="Structures to use" data-testid="call-goals-panel">
      <header className="call-goals-header">
        <h2>{GOALS_TITLE}</h2>
        <button type="button" className="call-goals-close" onClick={onClose} aria-label="Close structures" data-testid="call-goals-close">✕</button>
      </header>
      <p className="call-goals-intro">{goals.goals.length ? goalsIntro(isStudent, goals.student_name) : goalsEmptyText(isStudent, goals.student_name, goals.available)}</p>
      {note && goals.goals.length > 0 && <p className={`call-goals-listen ${listenStatus}`} data-testid="call-goals-listen">{note}</p>}
      {goals.goals.length > 0 && (
        <ol className="call-goals-list">
          {goals.goals.map((g, i) => (
            <GoalRow key={g.id} g={g} i={i} n={goals.goals.length} canTick={canTick} startedAt={startedAt} onAction={onAction} speak={speak} />
          ))}
        </ol>
      )}
      {goals.goals.length < GOALS_LIST_MAX && (
        <form className="call-goals-add" onSubmit={add}>
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setProblem(null); }}
            placeholder={GOALS_ADD_PLACEHOLDER}
            lang="zh"
            aria-label="Add a structure"
            data-testid="call-goals-input"
          />
          <button type="submit" disabled={!text.trim()} data-testid="call-goals-add">Add</button>
        </form>
      )}
      {problem && <p className="call-goals-problem" role="alert">{problem}</p>}
    </section>
  );
}
