import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  activeGoalProgress,
  applyQuestAction,
  availableActions,
  conditionObjectIds,
  createQuestState,
  emojiFor,
  heldObjects,
  objectsAt,
  objectsInReach,
  resetQuestState,
  terrainAt,
  type QuestDirection,
  type QuestPlayerAction,
  type QuestRejection,
  type QuestState,
  type QuestWorld,
} from '@shared/quest';
import { completeQuest, getQuest } from '../api/client';
import { Confetti } from '../components/Confetti';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import './QuestPage.css';

/** Chinese nudges for a move the world refused — the game speaks Chinese too. */
const REJECTION_TEXT: Record<QuestRejection, { hanzi: string; english: string }> = {
  blocked: { hanzi: '走不过去', english: "can't get through" },
  out_of_bounds: { hanzi: '到边儿了', english: "that's the edge of the map" },
  out_of_reach: { hanzi: '太远了', english: 'too far away — walk closer' },
  not_portable: { hanzi: '拿不起来', english: "you can't pick that up" },
  hands_full: { hanzi: '手里满了', english: 'your hands are full' },
  not_held: { hanzi: '你没拿着', english: "you're not holding that" },
  unknown_object: { hanzi: '找不到', english: "that's not here" },
  unknown_action: { hanzi: '做不了', english: "you can't do that" },
  action_unavailable: { hanzi: '现在不行', english: 'not right now' },
};

const REVEAL_KEY = 'quest-reveal';

interface Toast {
  hanzi: string;
  sub?: string;
  bad?: boolean;
}

/** Speaks Chinese through the shared offline-capable TTS cache. */
function useSpeak() {
  const playerRef = useRef(createAudioPlayer());
  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);
  return useCallback((text: string) => {
    if (!text) return;
    const playId = playerRef.current.claim();
    void getTTSWithCache(text).then((blob) => {
      if (!blob || !playerRef.current.isCurrent(playId)) return;
      playerRef.current.play(blob);
    });
  }, []);
}

export function QuestPlayPage() {
  const { id = '' } = useParams();

  const questQuery = useQuery({
    queryKey: ['quest', id],
    queryFn: () => getQuest(id),
    // Poll while the level is still being written.
    refetchInterval: (query) => (query.state.data?.status === 'generating' ? 3000 : false),
  });

  const quest = questQuery.data;

  if (questQuery.isLoading) {
    return (
      <div className="container quest-page">
        <div className="quest-loading">Loading…</div>
      </div>
    );
  }

  if (questQuery.isError || !quest) {
    return (
      <div className="container quest-page">
        <p>Couldn't load this quest.</p>
        <Link to="/quests" className="btn btn-secondary">← Back to quests</Link>
      </div>
    );
  }

  if (quest.status === 'generating') {
    return (
      <div className="container quest-page">
        <div className="quest-loading">
          <div className="quest-loading-emoji">🗺️</div>
          <p>Claude is drawing the map, placing the objects and writing the instructions…</p>
          <p style={{ fontSize: '0.8rem' }}>This usually takes a minute or two.</p>
        </div>
        <Link to="/quests" className="btn btn-secondary btn-block">← Back to quests</Link>
      </div>
    );
  }

  if (quest.status === 'error' || !quest.world) {
    return (
      <div className="container quest-page">
        <h1 style={{ fontSize: '1.2rem' }}>That level didn't come out playable</h1>
        <p style={{ color: 'var(--color-text-light)' }}>{quest.error || 'Generation failed.'}</p>
        <Link to="/quests" className="btn btn-primary btn-block">← Back to quests</Link>
      </div>
    );
  }

  return <QuestGame questId={quest.id} world={quest.world} />;
}

export function QuestGame({ questId, world }: { questId: string; world: QuestWorld }) {
  const [state, setState] = useState<QuestState>(() => createQuestState(world));
  const [toast, setToast] = useState<Toast | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [reveal, setReveal] = useState<{ pinyin: boolean; english: boolean }>(() => {
    try {
      const saved = localStorage.getItem(REVEAL_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { pinyin: false, english: false };
  });
  const speak = useSpeak();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportedRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(REVEAL_KEY, JSON.stringify(reveal));
    } catch {
      // ignore
    }
  }, [reveal]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const flash = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const goal = state.world.goals[state.activeGoalIndex] ?? null;

  // Read each new instruction aloud — this is a listening exercise too.
  const spokenGoalRef = useRef<string | null>(null);
  useEffect(() => {
    if (!goal || spokenGoalRef.current === goal.id) return;
    spokenGoalRef.current = goal.id;
    speak(goal.instruction.hanzi);
  }, [goal, speak]);

  useEffect(() => {
    setShowHint(false);
  }, [state.activeGoalIndex]);

  const act = useCallback(
    (action: QuestPlayerAction) => {
      setState((current) => {
        const result = applyQuestAction(current, action);
        if (!result.ok) {
          const reason = REJECTION_TEXT[result.rejection ?? 'action_unavailable'];
          flash({ hanzi: reason.hanzi, sub: reason.english, bad: true });
          return current;
        }
        if (result.completedGoals.length > 0) {
          const finished = current.world.goals.find((g) => g.id === result.completedGoals[0]);
          const success = finished?.success;
          flash({
            hanzi: success?.hanzi || '做对了！',
            sub: success?.english || 'Nicely done',
          });
          speak(success?.hanzi || '做对了');
        }
        return result.state;
      });
    },
    [flash, speak]
  );

  // Report the finish once, so a replay doesn't inflate the play count.
  useEffect(() => {
    if (!state.finished || reportedRef.current) return;
    reportedRef.current = true;
    void completeQuest(questId, state.moves).catch(() => {
      // Best effort — the level is finished whether or not the server hears.
    });
  }, [state.finished, state.moves, questId]);

  const replay = useCallback(() => {
    reportedRef.current = false;
    spokenGoalRef.current = null;
    setState((current) => resetQuestState(current));
  }, []);

  // Desktop keyboard: arrows/WASD walk, space picks up or puts down.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const directions: Record<string, QuestDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
      };
      const direction = directions[e.key];
      if (direction) {
        e.preventDefault();
        act({ type: 'move', direction });
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        setState((current) => {
          const held = heldObjects(current)[0];
          if (held) {
            const result = applyQuestAction(current, { type: 'put_down', object: held.id });
            return result.ok ? result.state : current;
          }
          const target = objectsInReach(current).find((o) => o.portable);
          if (!target) return current;
          const result = applyQuestAction(current, { type: 'pick_up', object: target.id });
          return result.ok ? result.state : current;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  const carried = heldObjects(state);
  const pickable = objectsInReach(state).filter(
    (obj) => obj.portable && state.held.length < Math.max(1, state.world.carry_limit)
  );
  const verbs = availableActions(state);
  const progress = activeGoalProgress(state);
  const highlighted = useMemo(
    () => (showHint && goal ? new Set(conditionObjectIds(goal.condition)) : new Set<string>()),
    [showHint, goal]
  );

  return (
    <div className="container quest-page">
      <div className="quest-game">
        <div className="quest-topbar">
          <Link to="/quests" className="btn-link" style={{ padding: 0 }}>← Quests</Link>
          <span className="quest-topbar-title">{state.world.title.hanzi}</span>
          <span>{state.moves} 步</span>
        </div>

        {state.finished ? (
          <>
            <Confetti />
            <div className="quest-finish">
              <h2>完成了！</h2>
              <div className="quest-finish-sub">
                All {state.world.goals.length} instructions carried out in {state.moves} moves.
              </div>
              <div className="quest-finish-actions">
                <button className="btn btn-secondary" onClick={replay}>再玩一次 Play again</button>
                <Link to="/quests" className="btn btn-primary">Back to quests</Link>
              </div>
            </div>
          </>
        ) : (
          goal && (
            <div className="quest-instruction">
              <div className="quest-instruction-meta">
                <span>
                  任务 {state.activeGoalIndex + 1} / {state.world.goals.length}
                  {progress && progress.total > 1 ? ` · 第 ${Math.min(progress.done + 1, progress.total)} 步 / ${progress.total}` : ''}
                </span>
                <span className="quest-pips">
                  {state.world.goals.map((g, i) => (
                    <span
                      key={g.id}
                      className={`quest-pip ${
                        i < state.activeGoalIndex
                          ? 'quest-pip-done'
                          : i === state.activeGoalIndex
                            ? 'quest-pip-active'
                            : ''
                      }`}
                    />
                  ))}
                </span>
              </div>

              <div className="quest-instruction-text">
                <div className="quest-instruction-hanzi">{goal.instruction.hanzi}</div>
                <button
                  className="quest-speak-btn"
                  onClick={() => speak(goal.instruction.hanzi)}
                  aria-label="Play instruction"
                >
                  🔊
                </button>
              </div>

              {reveal.pinyin && <div className="quest-instruction-pinyin">{goal.instruction.pinyin}</div>}
              {reveal.english && <div className="quest-instruction-english">{goal.instruction.english}</div>}

              {showHint && goal.hint && (
                <div className="quest-instruction-hint">
                  💡 {goal.hint.hanzi}
                  {reveal.pinyin && <div>{goal.hint.pinyin}</div>}
                  {reveal.english && <div>{goal.hint.english}</div>}
                </div>
              )}

              <div className="quest-reveal-row">
                <button
                  className={`quest-reveal-btn ${reveal.pinyin ? 'quest-reveal-btn-on' : ''}`}
                  onClick={() => setReveal((r) => ({ ...r, pinyin: !r.pinyin }))}
                >
                  拼音
                </button>
                <button
                  className={`quest-reveal-btn ${reveal.english ? 'quest-reveal-btn-on' : ''}`}
                  onClick={() => setReveal((r) => ({ ...r, english: !r.english }))}
                >
                  English
                </button>
                {goal.hint && (
                  <button
                    className={`quest-reveal-btn ${showHint ? 'quest-reveal-btn-on' : ''}`}
                    onClick={() => setShowHint((h) => !h)}
                  >
                    💡 提示
                  </button>
                )}
              </div>
            </div>
          )
        )}

        <QuestMap state={state} toast={toast} highlighted={highlighted} />

        {!state.finished && (
          <>
            <div className="quest-hands">
              {carried.length > 0 ? (
                <>
                  拿着：
                  {carried.map((obj) => (
                    <span key={obj.id} className="quest-hands-item">
                      {emojiFor(obj, state.objects[obj.id])} {obj.hanzi}
                    </span>
                  ))}
                </>
              ) : (
                <span>手里是空的</span>
              )}
            </div>

            <div className="quest-controls">
              <div className="quest-dpad">
                <button className="quest-dpad-up" onClick={() => act({ type: 'move', direction: 'up' })} aria-label="Up">↑</button>
                <button className="quest-dpad-left" onClick={() => act({ type: 'move', direction: 'left' })} aria-label="Left">←</button>
                <button className="quest-dpad-right" onClick={() => act({ type: 'move', direction: 'right' })} aria-label="Right">→</button>
                <button className="quest-dpad-down" onClick={() => act({ type: 'move', direction: 'down' })} aria-label="Down">↓</button>
              </div>

              <div className="quest-verbs">
                {pickable.map((obj) => (
                  <button
                    key={`pick-${obj.id}`}
                    className="quest-verb quest-verb-carry"
                    onClick={() => act({ type: 'pick_up', object: obj.id })}
                  >
                    <span className="quest-verb-main">
                      拿起 {emojiFor(obj, state.objects[obj.id])}
                    </span>
                    <span className="quest-verb-sub">ná qǐ {obj.pinyin}</span>
                  </button>
                ))}
                {carried.map((obj) => (
                  <button
                    key={`drop-${obj.id}`}
                    className="quest-verb quest-verb-carry"
                    onClick={() => act({ type: 'put_down', object: obj.id })}
                  >
                    <span className="quest-verb-main">
                      放下 {emojiFor(obj, state.objects[obj.id])}
                    </span>
                    <span className="quest-verb-sub">fàng xià {obj.pinyin}</span>
                  </button>
                ))}
                {verbs.map(({ object, action }) => (
                  <button
                    key={`${object.id}-${action.id}`}
                    className="quest-verb"
                    onClick={() => act({ type: 'interact', object: object.id, action: action.id })}
                  >
                    <span className="quest-verb-main">
                      {action.hanzi} {emojiFor(object, state.objects[object.id])}
                    </span>
                    <span className="quest-verb-sub">
                      {action.pinyin} {object.pinyin}
                    </span>
                  </button>
                ))}
                {pickable.length === 0 && carried.length === 0 && verbs.length === 0 && (
                  <div className="quest-verbs-empty">走到东西旁边，这里就会出现动词按钮。</div>
                )}
              </div>
            </div>
          </>
        )}

        <details className="quest-panel">
          <summary>📋 任务 Goals ({state.completedGoals.length}/{state.world.goals.length})</summary>
          <div className="quest-panel-body">
            {state.world.goals.map((g, i) => {
              const done = i < state.activeGoalIndex;
              const locked = i > state.activeGoalIndex;
              return (
                <div
                  key={g.id}
                  className={`quest-goal-item ${done ? 'quest-goal-done' : ''} ${locked ? 'quest-goal-locked' : ''}`}
                >
                  <span>{done ? '✅' : locked ? '🔒' : '▶️'}</span>
                  <span>{locked ? '？？？' : g.instruction.hanzi}</span>
                </div>
              );
            })}
          </div>
        </details>

        <details className="quest-panel">
          <summary>📖 词汇 Glossary ({state.world.glossary.length})</summary>
          <div className="quest-panel-body">
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', margin: '0 0 0.5rem' }}>
              {state.world.scenario.hanzi}
            </p>
            {state.world.glossary.map((entry, i) => (
              <div key={`${entry.hanzi}-${i}`} className="quest-glossary-item">
                <span className={`quest-pos quest-pos-${entry.pos}`}>{entry.pos}</span>
                <span>
                  <span className="quest-glossary-hanzi">{entry.hanzi}</span>{' '}
                  <span className="quest-glossary-pinyin">{entry.pinyin}</span>{' '}
                  <span className="quest-glossary-english">{entry.english}</span>
                  {entry.note && <span className="quest-glossary-note">{entry.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </details>

        {!state.finished && (
          <button className="btn btn-link" onClick={replay}>重新开始 Restart level</button>
        )}
      </div>
    </div>
  );
}

function QuestMap({
  state,
  toast,
  highlighted,
}: {
  state: QuestState;
  toast: Toast | null;
  highlighted: Set<string>;
}) {
  const { world } = state;

  // The map has to share one screen with the instruction card and the controls,
  // so tiles are sized off both the viewport width and what's left vertically.
  const tileStyle = {
    '--quest-tile': `clamp(26px, min((100vw - 2.5rem) / ${world.width}, (100svh - 26rem) / ${world.height}), 64px)`,
  } as CSSProperties;

  const tiles: Array<{ key: string; x: number; y: number }> = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      tiles.push({ key: `${x}-${y}`, x, y });
    }
  }

  return (
    <div className="quest-map-wrap">
      <div className="quest-map" style={tileStyle}>
        <div
          className="quest-tiles"
          style={{ gridTemplateColumns: `repeat(${world.width}, var(--quest-tile))` }}
        >
          {tiles.map(({ key, x, y }) => {
            const terrain = terrainAt(world, x, y);
            return (
              <div
                key={key}
                className="quest-tile"
                style={{ background: terrain?.color ?? '#e5e7eb' }}
              >
                {terrain?.emoji && <span className="quest-tile-decor">{terrain.emoji}</span>}
              </div>
            );
          })}
        </div>

        <div className="quest-sprites">
          {tiles.map(({ key, x, y }) => {
            const here = objectsAt(state, x, y);
            if (here.length === 0) return null;
            return (
              <div
                key={`obj-${key}`}
                className={`quest-sprite ${here.length > 1 ? 'quest-sprite-stack' : ''}`}
                style={{
                  left: `calc(${x} * var(--quest-tile))`,
                  top: `calc(${y} * var(--quest-tile))`,
                }}
              >
                {here.map((obj) => (
                  <span
                    key={obj.id}
                    className={highlighted.has(obj.id) ? 'quest-sprite-target' : undefined}
                    title={`${obj.hanzi} ${obj.pinyin}`}
                  >
                    {emojiFor(obj, state.objects[obj.id])}
                  </span>
                ))}
              </div>
            );
          })}

          <div
            className="quest-sprite quest-sprite-player"
            style={{
              transform: `translate(calc(${state.player.x} * var(--quest-tile)), calc(${state.player.y} * var(--quest-tile)))`,
            }}
          >
            {world.player.emoji}
          </div>
        </div>

        {toast && (
          <div className={`quest-toast ${toast.bad ? 'quest-toast-bad' : ''}`}>
            <div>{toast.hanzi}</div>
            {toast.sub && <div className="quest-toast-sub">{toast.sub}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
