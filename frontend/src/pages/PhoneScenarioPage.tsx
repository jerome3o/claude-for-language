/**
 * One phone-practice task (docs/PHONE_PRACTICE.md), immersive: the simulated phone (full screen
 * on a phone, a phone frame on a desktop) with the task card, hints and the finish summary. The
 * play's event log is saved on the device as it happens (leave and come back = carry on), and
 * the engine checks the goals after every event; when they all hold the task is complete.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { bundledScenario, durationBucket, isComplete, nextHintIndex, scenarioResult, type PhoneEvent, type ScenarioResult, type ScenarioSpec } from '@shared/phone';
import { useNetwork } from '../contexts/NetworkContext';
import { useExplorer } from '../components/explorer/ExplorerContext';
import { Confetti } from '../components/Confetti';
import { track } from '../services/analytics';
import { clearCurrentPlay, loadCurrentPlay, RESUME_WITHIN_MS, saveCurrentPlay, savePlay, scenarioStatuses } from '../services/phonePractice';
import { PhoneProvider, usePhone } from '../phone/runtime';
import { PhoneShell } from '../phone/PhoneShell';
import { HintBubble, PhoneSummary, TaskCard } from '../phone/TaskPanel';
import '../phone/phone.css';

interface PlayState {
  key: number;
  startedAt: number;
  events: PhoneEvent[];
  hintsShown: number;
  resumed: boolean;
}

export function PhoneScenarioPage() {
  const { id = '' } = useParams();
  const spec = useMemo(() => bundledScenario(id), [id]);
  const navigate = useNavigate();
  const [play, setPlay] = useState<PlayState | null>(null);

  useEffect(() => {
    if (!spec) return;
    let live = true;
    void (async () => {
      const saved = await loadCurrentPlay(spec.id);
      const now = Date.now();
      if (!live) return;
      if (saved && saved.events.length > 0 && now - saved.touched_at < RESUME_WITHIN_MS) {
        // The clock and the timer carry on from where they were left.
        const shift = now - saved.touched_at;
        setPlay({ key: 1, startedAt: saved.started_at + shift, events: saved.events, hintsShown: saved.hints_shown, resumed: true });
      } else {
        const statuses = await scenarioStatuses();
        setPlay({ key: 1, startedAt: now, events: [], hintsShown: 0, resumed: false });
        track('phone.scenario_start', { scenario: spec.id, difficulty: spec.difficulty, app: spec.apps[0], replay: !!statuses[spec.id]?.done });
      }
    })();
    return () => {
      live = false;
    };
  }, [spec]);

  if (!spec) {
    return (
      <div className="container" style={{ padding: '2rem 1rem' }}>
        <p>This task doesn't exist.</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/phone')}>
          All tasks
        </button>
      </div>
    );
  }
  if (!play) return <div className="ph-page ph-page-loading" />;

  const restart = () => {
    void clearCurrentPlay(spec.id);
    setPlay((p) => ({ key: (p?.key ?? 0) + 1, startedAt: Date.now(), events: [], hintsShown: 0, resumed: false }));
    track('phone.scenario_start', { scenario: spec.id, difficulty: spec.difficulty, app: spec.apps[0], replay: true });
  };

  return (
    <Play key={play.key} spec={spec} play={play} onRestart={restart} onExit={() => navigate('/phone')} />
  );
}

function Play({ spec, play, onRestart, onExit }: { spec: ScenarioSpec; play: PlayState; onRestart: () => void; onExit: () => void }) {
  const { isOnline } = useNetwork();
  const latest = useRef({ events: play.events, hints: play.hintsShown });
  const saveTimer = useRef<number | null>(null);
  const [finished, setFinished] = useState<{ result: ScenarioResult; gaveUp: boolean } | null>(null);
  const finishedRef = useRef(false);
  const [hintsShown, setHintsShown] = useState(play.hintsShown);

  const persist = useCallback(() => {
    if (finishedRef.current) return;
    void saveCurrentPlay({ scenario_id: spec.id, started_at: play.startedAt, touched_at: Date.now(), events: latest.current.events, hints_shown: latest.current.hints });
  }, [spec.id, play.startedAt]);

  const onEvents = useCallback(
    (events: PhoneEvent[]) => {
      latest.current.events = events;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persist, 400);
    },
    [persist],
  );

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const finish = useCallback(
    (events: PhoneEvent[], gaveUp: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const ended = Date.now();
      const result = scenarioResult(spec, events, play.startedAt, ended);
      void savePlay({ id: `${spec.id}-${ended}`, scenario_id: spec.id, started_at: play.startedAt, ended_at: ended, result, gave_up: gaveUp });
      void clearCurrentPlay(spec.id);
      track('phone.scenario_finish', {
        scenario: spec.id,
        success: result.success,
        gave_up: gaveUp,
        hints: result.hints_used,
        mistakes: result.mistakes.length,
        slips: result.slips,
        bonus: result.bonus_done.length,
        duration_bucket: durationBucket(result.duration_ms),
      });
      setFinished({ result, gaveUp });
    },
    [spec, play.startedAt],
  );

  return (
    <div className="ph-page" data-testid="phone-scenario" data-scenario={spec.id}>
      <PhoneProvider spec={spec} startedAt={play.startedAt} initialEvents={play.events} online={isOnline} onEvents={onEvents}>
        <PhoneArea
          spec={spec}
          resumed={play.resumed}
          hintsShown={hintsShown}
          setHintsShown={(n) => {
            latest.current.hints = n;
            setHintsShown(n);
            persist();
          }}
          finished={finished}
          onFinish={finish}
          onRestart={onRestart}
          onExit={() => {
            persist();
            onExit();
          }}
          onKeepGoing={() => {
            finishedRef.current = false;
            setFinished(null);
            persist();
          }}
        />
      </PhoneProvider>
    </div>
  );
}

function PhoneArea(props: {
  spec: ScenarioSpec;
  resumed: boolean;
  hintsShown: number;
  setHintsShown: (n: number) => void;
  finished: { result: ScenarioResult; gaveUp: boolean } | null;
  onFinish: (events: PhoneEvent[], gaveUp: boolean) => void;
  onRestart: () => void;
  onExit: () => void;
  onKeepGoing: () => void;
}) {
  const p = usePhone();
  const explorer = useExplorer();
  const { spec } = props;
  const [taskOpen, setTaskOpen] = useState(!props.resumed);
  const [hint, setHint] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const wide = useWide();
  const done = isComplete(spec, p.events);
  const announced = useRef(false);
  usePhoneBackButton(p.back);

  useEffect(() => {
    if (!done || announced.current || props.finished) return;
    announced.current = true;
    p.notify({ app: spec.apps[0], title: '✅ 任务完成', body: spec.goal.zh });
    setCelebrate(true);
    const t = window.setTimeout(() => props.onFinish(p.events, false), 1800);
    return () => window.clearTimeout(t);
    // Once, when the goals first all hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const showHint = () => {
    const idx = nextHintIndex(spec, p.events, props.hintsShown);
    if (idx === null) {
      setHint(spec.hints.length - 1);
      return;
    }
    setHint(idx);
    p.emit({ type: 'hint', index: idx });
    props.setHintsShown(idx + 1);
  };

  const card = (
    <TaskCard
      spec={spec}
      events={p.events}
      inline={wide}
      onClose={wide ? undefined : () => setTaskOpen(false)}
      onGiveUp={() => props.onFinish(p.events, !done)}
      onRestart={props.onRestart}
      onExit={props.onExit}
    />
  );

  return (
    <>
      <PhoneShell
        onWord={(item) => explorer.open(item, { source: 'phone' })}
        onTask={() => (wide ? undefined : setTaskOpen((v) => !v))}
        onHint={showHint}
        side={wide ? <div className="ph-side">{card}</div> : undefined}
        overlay={
          <>
            {!wide && taskOpen && (
              <div className="ph-task-scrim" onClick={() => setTaskOpen(false)}>
                <div onClick={(e) => e.stopPropagation()}>{card}</div>
              </div>
            )}
            {hint !== null && <HintBubble spec={spec} index={hint} onClose={() => setHint(null)} onNext={showHint} canNext={hint < spec.hints.length - 1} />}
          </>
        }
      />
      {celebrate && <Confetti />}
      {props.finished && (
        <PhoneSummary
          spec={spec}
          result={props.finished.result}
          gaveUp={props.finished.gaveUp}
          onAgain={props.onRestart}
          onList={props.onExit}
          onKeepGoing={props.onKeepGoing}
        />
      )}
    </>
  );
}

/**
 * The Android back gesture / browser ← works as the phone's ◁: one history entry with the same
 * URL is kept on top; popping it runs the phone's back and puts the entry back. At the phone's
 * home screen with nothing to close, the next back leaves the page. (The explorer's own entries
 * sit above ours; popping back onto our entry is not a phone back.)
 */
function usePhoneBackButton(back: () => boolean) {
  const ref = useRef(back);
  ref.current = back;
  useEffect(() => {
    const mark = () => window.history.pushState({ ...((window.history.state as object | null) ?? {}), phoneGuard: true }, '');
    mark();
    const onPop = () => {
      const state = window.history.state as { phoneGuard?: boolean; backLevel?: number } | null;
      if (state?.phoneGuard && !state.backLevel) return;
      if (state?.backLevel) return;
      if (ref.current()) mark();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}

function useWide(): boolean {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}
