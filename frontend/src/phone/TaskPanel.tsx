/**
 * The learning aids around the phone (English — they are not part of the simulated UI): the
 * task card (situation, goal in English + Chinese, the facts you need, the goal checklist), the
 * 💡 hint bubble (the next step in English, then the Chinese to look for), and the finish
 * summary (time, hints, mistakes, slips, bonus, the task's words with "+ Add as card").
 */
import { useState } from 'react';
import { formatDuration, goalStates, PHONE_APPS, type PhoneEvent, type ScenarioResult, type ScenarioSpec } from '@shared/phone';
import { AddChunkModal } from '../components/AddChunkModal';
import { ExplorableText } from '../components/explorer/ExplorableText';
import { track } from '../services/analytics';

const LEVEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function TaskCard(props: { spec: ScenarioSpec; events: PhoneEvent[]; onClose?: () => void; onGiveUp: () => void; onRestart: () => void; onExit: () => void; inline?: boolean }) {
  const { spec } = props;
  const states = goalStates(spec, props.events);
  const [zh, setZh] = useState(false);
  return (
    <div className={`ph-task${props.inline ? ' ph-task-inline' : ''}`} data-testid="phone-task" data-no-explore>
      <div className="ph-task-head">
        <span className={`ph-level ph-level-${spec.difficulty}`}>{LEVEL[spec.difficulty]}</span>
        <b>{spec.title.en}</b>
        {props.onClose && (
          <button type="button" className="ph-task-x" onClick={props.onClose} aria-label="Hide the task" data-testid="phone-task-close">
            ✕
          </button>
        )}
      </div>
      <p className="ph-task-situation">{spec.situation}</p>
      <div className="ph-task-goal">
        <span className="ph-task-label">Your task</span>
        <p data-testid="phone-task-goal">{spec.goal.en}</p>
        <button type="button" className="ph-task-zh-toggle" onClick={() => setZh((v) => !v)} aria-pressed={zh}>
          {zh ? 'Hide the Chinese' : 'In Chinese'}
        </button>
        {zh && (
          <p className="ph-task-zh" lang="zh-CN">
            <ExplorableText text={spec.goal.zh} source="phone" />
          </p>
        )}
      </div>
      {spec.facts && spec.facts.length > 0 && (
        <ul className="ph-task-facts">
          {spec.facts.map((f, i) => (
            <li key={i}>{f.en}</li>
          ))}
        </ul>
      )}
      <ul className="ph-task-goals" data-testid="phone-task-goals">
        {states.map(({ goal, done }) => (
          <li key={goal.id} className={done ? 'done' : ''}>
            <span>{done ? '✓' : goal.optional ? '☆' : '○'}</span>
            {goal.label.en}
          </li>
        ))}
      </ul>
      <p className="ph-task-tip">Long-press any Chinese on the phone to look it up. 💡 shows the next step.</p>
      <div className="ph-task-actions">
        <button type="button" onClick={props.onExit} data-testid="phone-exit">
          Leave (progress kept)
        </button>
        <button type="button" onClick={props.onRestart}>
          Start over
        </button>
        <button type="button" onClick={props.onGiveUp} data-testid="phone-give-up">
          I'm done
        </button>
      </div>
      <p className="ph-task-apps">Apps: {spec.apps.map((a) => `${PHONE_APPS[a].name} (${PHONE_APPS[a].kind_en})`).join(' · ')}</p>
    </div>
  );
}

export function HintBubble(props: { spec: ScenarioSpec; index: number; onNext: () => void; onClose: () => void; canNext: boolean }) {
  const h = props.spec.hints[props.index];
  if (!h) return null;
  return (
    <div className="ph-hint" data-testid="phone-hint" data-no-explore>
      <div className="ph-hint-head">
        💡 Step {props.index + 1} of {props.spec.hints.length}
        <button type="button" onClick={props.onClose} aria-label="Close the hint">
          ✕
        </button>
      </div>
      <p>{h.en}</p>
      <p className="ph-hint-zh" lang="zh-CN">
        <ExplorableText text={h.zh} source="phone" />
      </p>
      {props.canNext && (
        <button type="button" className="ph-hint-next" onClick={props.onNext} data-testid="phone-hint-next">
          Next hint
        </button>
      )}
    </div>
  );
}

export function PhoneSummary(props: { spec: ScenarioSpec; result: ScenarioResult; gaveUp: boolean; onAgain: () => void; onList: () => void; onKeepGoing?: () => void }) {
  const { spec, result } = props;
  const [adding, setAdding] = useState<{ hanzi: string; pinyin: string; english: string } | null>(null);
  const goals = spec.goals;
  return (
    <div className="ph-summary-scrim" data-testid="phone-summary" data-no-explore>
      <div className="ph-summary">
        <div className={`ph-summary-head${result.success ? ' ok' : ''}`}>
          <span className="ph-summary-emoji">{result.success ? '🎉' : '📋'}</span>
          <b data-testid="phone-summary-title">{result.success ? 'Task complete!' : 'Task not finished'}</b>
          <small>{spec.title.en}</small>
        </div>
        <div className="ph-summary-stats">
          <span>
            <b data-testid="phone-summary-time">{formatDuration(result.duration_ms)}</b>
            <small>time</small>
          </span>
          <span>
            <b data-testid="phone-summary-hints">{result.hints_used}</b>
            <small>{result.hints_used === 1 ? 'hint' : 'hints'}</small>
          </span>
          <span>
            <b>{result.mistakes.length + result.slips}</b>
            <small>slips</small>
          </span>
          {result.bonus_total > 0 && (
            <span>
              <b>
                {result.bonus_done.length}/{result.bonus_total}
              </b>
              <small>bonus</small>
            </span>
          )}
        </div>
        <ul className="ph-task-goals">
          {goals.map((g) => {
            const done = result.goals_done.includes(g.id) || result.bonus_done.includes(g.id);
            return (
              <li key={g.id} className={done ? 'done' : ''}>
                <span>{done ? '✓' : g.optional ? '☆' : '✗'}</span>
                {g.label.en}
              </li>
            );
          })}
        </ul>
        {(result.mistakes.length > 0 || result.slips > 0) && (
          <div className="ph-summary-mistakes" data-testid="phone-summary-mistakes">
            <b>What went wrong</b>
            <ul>
              {result.mistakes.map((m) => (
                <li key={m.id}>
                  {m.label.en} <span lang="zh-CN">（{m.label.zh}）</span>
                </li>
              ))}
              {result.slips > 0 && <li>{result.slips === 1 ? 'One form or password slip' : `${result.slips} form or password slips`} (a wrong code, a missing field…)</li>}
            </ul>
          </div>
        )}
        <div className="ph-summary-words">
          <b>Words from this task</b>
          {spec.vocab.map((v) => (
            <div key={v.hanzi} className="ph-summary-word" data-testid="phone-summary-word">
              <span lang="zh-CN" className="ph-summary-hanzi">
                <ExplorableText text={v.hanzi} source="phone" />
              </span>
              <span className="ph-summary-py">
                {v.pinyin}
                <small>{v.english}</small>
              </span>
              <button
                type="button"
                onClick={() => {
                  setAdding(v);
                  track('phone.add_card', { scenario: spec.id, action: 'add' });
                }}
                data-testid="phone-add-card"
              >
                + Card
              </button>
            </div>
          ))}
        </div>
        <div className="ph-summary-actions">
          {props.onKeepGoing && (
            <button type="button" onClick={props.onKeepGoing}>
              Keep using the phone
            </button>
          )}
          <button type="button" onClick={props.onAgain} data-testid="phone-again">
            Try again
          </button>
          <button type="button" className="primary" onClick={props.onList} data-testid="phone-back-to-list">
            More tasks
          </button>
        </div>
      </div>
      {adding && <AddChunkModal chunk={adding} source="other" onClose={() => setAdding(null)} />}
    </div>
  );
}
