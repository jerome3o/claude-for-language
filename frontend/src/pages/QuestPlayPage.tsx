import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { completeQuest, getQuest, retryQuest } from '../api/client';
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

/** Praise sits long enough to actually be read; a refusal can go quickly. */
const TOAST_MS = { good: 4500, bad: 1800 };

const REVEAL_KEY = 'quest-reveal';

interface RevealSettings {
  /** Pinyin under the instruction. */
  pinyin: boolean;
  /** English under the instruction. */
  english: boolean;
  /**
   * Pinyin under the verbs on the action buttons. Off by default — the buttons
   * always carry the characters, so reading them is part of the exercise.
   */
  buttonPinyin: boolean;
}

const DEFAULT_REVEAL: RevealSettings = { pinyin: false, english: false, buttonPinyin: false };

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

/**
 * Live size of the play area. The board is sized in JS rather than CSS because
 * it has to fill whatever is left after the instruction and the controls, on a
 * screen that never scrolls.
 */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

export function QuestPlayPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();

  const retry = useMutation({
    mutationFn: () => retryQuest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quest', id] });
      queryClient.invalidateQueries({ queryKey: ['quests'] });
    },
  });

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
          <p className="quest-progress">{quest.progress ?? 'queued'}</p>
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
        <button
          className="btn btn-primary btn-block"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
        >
          {retry.isPending ? 'Starting…' : '🔄 Try building it again'}
        </button>
        <Link to="/quests" className="btn btn-secondary btn-block" style={{ marginTop: '0.5rem' }}>
          ← Back to quests
        </Link>
      </div>
    );
  }

  return <QuestGame questId={quest.id} world={quest.world} />;
}

export function QuestGame({ questId, world }: { questId: string; world: QuestWorld }) {
  const navigate = useNavigate();
  const [state, setState] = useState<QuestState>(() => createQuestState(world));
  const [toast, setToast] = useState<Toast | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reveal, setReveal] = useState<RevealSettings>(() => {
    try {
      const saved = localStorage.getItem(REVEAL_KEY);
      if (saved) return { ...DEFAULT_REVEAL, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_REVEAL;
  });
  const speak = useSpeak();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportedRef = useRef(false);
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();

  // The game owns the whole screen: no app chrome, no page scroll, no FAB.
  useEffect(() => {
    document.body.classList.add('quest-fullscreen');
    return () => document.body.classList.remove('quest-fullscreen');
  }, []);

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
    toastTimer.current = setTimeout(
      () => setToast(null),
      next.bad ? TOAST_MS.bad : TOAST_MS.good
    );
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
    setMenuOpen(false);
    setState((current) => resetQuestState(current));
  }, []);

  const exit = useCallback(() => navigate('/quests'), [navigate]);

  // Desktop keyboard: arrows/WASD walk, space picks up or puts down, esc exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen((open) => !open);
        return;
      }
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

  const tile = useMemo(() => {
    if (!stageSize.width || !stageSize.height) return 0;
    const fit = Math.min(stageSize.width / world.width, stageSize.height / world.height);
    return Math.max(18, Math.min(76, Math.floor(fit)));
  }, [stageSize, world.width, world.height]);

  return (
    <div className="quest-shell">
      <div className="quest-hud">
        <button className="quest-hud-btn" onClick={exit} aria-label="Exit quest">✕</button>
        <span className="quest-hud-title">{state.world.title.hanzi}</span>
        <span className="quest-hud-moves">{state.moves} 步</span>
        <button
          className="quest-hud-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
        >
          ☰
        </button>
      </div>

      {goal && !state.finished && (
        <div className="quest-instruction">
          <div className="quest-instruction-meta">
            <span>
              {state.activeGoalIndex + 1}/{state.world.goals.length}
              {progress && progress.total > 1
                ? ` · 第 ${Math.min(progress.done + 1, progress.total)} 步/${progress.total}`
                : ''}
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
            {goal.hint && (
              <button
                className={`quest-speak-btn ${showHint ? 'quest-speak-btn-on' : ''}`}
                onClick={() => setShowHint((h) => !h)}
                aria-label="Hint"
              >
                💡
              </button>
            )}
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
        </div>
      )}

      <div className="quest-stage" ref={stageRef}>
        {tile > 0 && <QuestMap state={state} tile={tile} highlighted={highlighted} />}
        {toast && (
          <button
            className={`quest-toast ${toast.bad ? 'quest-toast-bad' : ''}`}
            onClick={() => setToast(null)}
          >
            <span>{toast.hanzi}</span>
            {toast.sub && <span className="quest-toast-sub">{toast.sub}</span>}
          </button>
        )}
      </div>

      {!state.finished && (
        <div className="quest-dock">
          <div className="quest-hands">
            {carried.length > 0 ? (
              carried.map((obj) => (
                <span key={obj.id} className="quest-hands-item">
                  {emojiFor(obj, state.objects[obj.id])} {obj.hanzi}
                  {reveal.buttonPinyin && <span className="quest-hands-pinyin"> {obj.pinyin}</span>}
                </span>
              ))
            ) : (
              <span className="quest-hands-empty">手里是空的</span>
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
                <VerbButton
                  key={`pick-${obj.id}`}
                  carry
                  showPinyin={reveal.buttonPinyin}
                  verbHanzi="拿起"
                  verbPinyin="ná qǐ"
                  objectEmoji={emojiFor(obj, state.objects[obj.id])}
                  objectPinyin={obj.pinyin}
                  onClick={() => act({ type: 'pick_up', object: obj.id })}
                />
              ))}
              {carried.map((obj) => (
                <VerbButton
                  key={`drop-${obj.id}`}
                  carry
                  showPinyin={reveal.buttonPinyin}
                  verbHanzi="放下"
                  verbPinyin="fàng xià"
                  objectEmoji={emojiFor(obj, state.objects[obj.id])}
                  objectPinyin={obj.pinyin}
                  onClick={() => act({ type: 'put_down', object: obj.id })}
                />
              ))}
              {verbs.map(({ object, action }) => (
                <VerbButton
                  key={`${object.id}-${action.id}`}
                  showPinyin={reveal.buttonPinyin}
                  verbHanzi={action.hanzi}
                  verbPinyin={action.pinyin}
                  objectEmoji={emojiFor(object, state.objects[object.id])}
                  objectPinyin={object.pinyin}
                  onClick={() => act({ type: 'interact', object: object.id, action: action.id })}
                />
              ))}
              {pickable.length === 0 && carried.length === 0 && verbs.length === 0 && (
                <div className="quest-verbs-empty">走到东西旁边，动词按钮就会出现。</div>
              )}
            </div>
          </div>
        </div>
      )}

      {state.finished && (
        <>
          <Confetti />
          <div className="quest-finish-overlay">
            <div className="quest-finish">
              <h2>完成了！</h2>
              <div className="quest-finish-sub">
                All {state.world.goals.length} instructions carried out in {state.moves} moves.
              </div>
              <div className="quest-finish-actions">
                <button className="btn btn-secondary" onClick={replay}>再玩一次 Play again</button>
                <button className="btn btn-primary" onClick={exit}>Back to quests</button>
              </div>
            </div>
          </div>
        </>
      )}

      {menuOpen && (
        <QuestMenu
          state={state}
          reveal={reveal}
          onToggle={(key) => setReveal((r) => ({ ...r, [key]: !r[key] }))}
          onClose={() => setMenuOpen(false)}
          onRestart={replay}
          onExit={exit}
        />
      )}
    </div>
  );
}

/**
 * One verb button: the verb in characters next to the object's emoji. The
 * reading sits behind a toggle so the characters are what you read by default.
 */
function VerbButton({
  showPinyin,
  verbHanzi,
  verbPinyin,
  objectEmoji,
  objectPinyin,
  carry,
  onClick,
}: {
  showPinyin: boolean;
  verbHanzi: string;
  verbPinyin: string;
  objectEmoji: string;
  objectPinyin: string;
  carry?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`quest-verb ${carry ? 'quest-verb-carry' : ''}`} onClick={onClick}>
      <span className="quest-verb-main">
        {verbHanzi} {objectEmoji}
      </span>
      {showPinyin && (
        <span className="quest-verb-sub">
          {verbPinyin} {objectPinyin}
        </span>
      )}
    </button>
  );
}

function QuestMenu({
  state,
  reveal,
  onToggle,
  onClose,
  onRestart,
  onExit,
}: {
  state: QuestState;
  reveal: RevealSettings;
  onToggle: (key: keyof RevealSettings) => void;
  onClose: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  return (
    <div className="quest-sheet-overlay" onClick={onClose}>
      <div className="quest-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quest-sheet-header">
          <span>{state.world.title.hanzi}</span>
          <button className="quest-hud-btn" onClick={onClose} aria-label="Close menu">✕</button>
        </div>

        <div className="quest-sheet-body">
          <div className="quest-sheet-section">
            <div className="quest-sheet-label">显示 Show</div>
            <div className="quest-reveal-row">
              <button
                className={`quest-reveal-btn ${reveal.pinyin ? 'quest-reveal-btn-on' : ''}`}
                onClick={() => onToggle('pinyin')}
              >
                拼音 instruction
              </button>
              <button
                className={`quest-reveal-btn ${reveal.english ? 'quest-reveal-btn-on' : ''}`}
                onClick={() => onToggle('english')}
              >
                English
              </button>
              <button
                className={`quest-reveal-btn ${reveal.buttonPinyin ? 'quest-reveal-btn-on' : ''}`}
                onClick={() => onToggle('buttonPinyin')}
              >
                拼音 buttons
              </button>
            </div>
          </div>

          <div className="quest-sheet-section">
            <div className="quest-sheet-label">
              任务 Goals ({state.completedGoals.length}/{state.world.goals.length})
            </div>
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

          <div className="quest-sheet-section">
            <div className="quest-sheet-label">词汇 Glossary</div>
            <p className="quest-sheet-scenario">{state.world.scenario.hanzi}</p>
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
        </div>

        <div className="quest-sheet-actions">
          <button className="btn btn-secondary" onClick={onRestart}>重新开始 Restart</button>
          <button className="btn btn-primary" onClick={onExit}>退出 Exit</button>
        </div>
      </div>
    </div>
  );
}

function QuestMap({
  state,
  tile,
  highlighted,
}: {
  state: QuestState;
  tile: number;
  highlighted: Set<string>;
}) {
  const { world } = state;

  const tiles: Array<{ key: string; x: number; y: number }> = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      tiles.push({ key: `${x}-${y}`, x, y });
    }
  }

  return (
    <div className="quest-map" style={{ ['--quest-tile' as string]: `${tile}px` }}>
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
    </div>
  );
}
