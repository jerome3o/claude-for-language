/**
 * 🥽 A VR world — /vr/worlds/:id (docs/VR_WORLDS.md). Lazy (three.js + Rapier live only in the VR
 * chunks). Enter VR in a WebXR browser; elsewhere a flat preview (walk with WASD / click the floor,
 * click a thing for its word, hold to pick it up, flick to throw).
 *
 * The page owns the app side: the task run (shared/vr-worlds engine) fed by the scene's ticks, the
 * object states (a fridge door, a light), the inspect panel's word (his cards: new / in decks / known,
 * "+ Add as card" into "From VR", "⚡ Study it today"), the explorer, progress, sound and analytics.
 * The scene (scene/WorldScene.tsx) draws and reports.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  currentTask, hintDue, hintTargets, sequenceProgress, skipTask, startRun, stepRun, validateWorld,
  type WorldEvent, type WorldRun, type WorldSnapshot,
} from '@shared/vr-worlds';
import { normalizeHanzi } from '@shared/import/parse';
import { track } from '../../services/analytics';
import { loadSegmenter, segmentNow } from '../../services/chineseSegmenter';
import { getTTSWithCache } from '../../services/ttsCache';
import { useNetwork } from '../../contexts/NetworkContext';
import { playText, disposeAudio } from '../audio';
import { detectXrSupport, type XrSupport } from '../xrSupport';
import { ExplorerPanel } from '../panels/ExplorerPanel';
import type { PanelController } from '../panels/types';
import type { UiNode } from '../ui/layout';
import { worldEntry } from './registry';
import type { WorldDefinition } from './types';
import { SoundEngine, ALL_SFX } from './sound';
import { inspectPanelNodes, taskPanelNodes } from './panels';
import { getProgress, recordTask, type WorldProgress } from './progress';
import { addWorldWordCard, bumpWorldWord, knownWords, lookupWorldWord, type WordInfo } from './words';
import { WorldScene, type WorldSceneApi } from './scene/WorldScene';
import type { WalkInput } from './scene/WorldFlatControls';
import '../vr.css';
import './worlds.css';

const PREFS_KEY = 'vr-worlds-prefs-v1';
const JUST_DONE_MS = 1800;

interface Prefs { pinyin: boolean; english: boolean }

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return { pinyin: p.pinyin !== false, english: !!p.english };
    }
  } catch {
    /* private window */
  }
  return { pinyin: true, english: false };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function initialStates(def: WorldDefinition): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const o of def.objects) {
    if (!o.states?.length) continue;
    out[o.id] = Object.fromEntries(o.states.map((s) => [s.key, s.initial]));
  }
  return out;
}

function nodeTexts(nodes: readonly UiNode[]): string[] {
  const out: string[] = [];
  const visit = (n: UiNode) => {
    if (n.t === 'text') out.push(n.text);
    else if (n.t === 'button') out.push(n.label);
    else if (n.t === 'row') n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

function segmentsOf(text: string): string[] | undefined {
  const words = segmentNow(text);
  return words ? words.map((w) => w.text) : undefined;
}

export function WorldPage() {
  const { id = '' } = useParams();
  const entry = worldEntry(id);
  const [def, setDef] = useState<WorldDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    entry.load().then((m) => {
      if (cancelled) return;
      const checked = validateWorld(m.default);
      if (!checked.ok) console.warn(`[vr-worlds] ${m.default.id} has problems:`, checked.problems);
      setDef(m.default);
    }, (e: unknown) => {
      if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load this world.');
    });
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry) {
    return (
      <div className="vr-worlds-missing">
        <p>No world called “{id}”.</p>
        <Link to="/vr/worlds">← All worlds</Link>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="vr-worlds-missing">
        <p>Couldn’t load {entry.meta.title_en}: {loadError}</p>
        <p>It needs a connection the first time.</p>
        <Link to="/vr/worlds">← All worlds</Link>
      </div>
    );
  }
  if (!def) {
    return (
      <div className="vr-page vr-worlds-loading">
        <div className="vr-worlds-loading-card">
          <div className="vr-worlds-loading-emoji">{entry.meta.emoji}</div>
          <div>{entry.meta.title_zh} · {entry.meta.title_en}</div>
          <div className="vr-worlds-loading-sub">Loading the world…</div>
        </div>
      </div>
    );
  }
  return <WorldRunner def={def} />;
}

function WorldRunner({ def }: { def: WorldDefinition }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [askVr, setAskVr] = useState(params.get('vr') === '1');
  const { isOnline } = useNetwork();
  const apiRef = useRef<WorldSceneApi | null>(null);
  const sound = useMemo(() => new SoundEngine(), []);
  const walk = useRef<WalkInput>({ forward: 0, turn: 0 });
  const [support, setSupport] = useState<XrSupport>({ status: 'checking' });
  const [presenting, setPresenting] = useState(false);
  // Enter VR only once the scene can start the session (the click's user activation is short-lived).
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    if (sceneReady) return undefined;
    const t = window.setInterval(() => { if (apiRef.current) setSceneReady(true); }, 150);
    return () => window.clearInterval(t);
  }, [sceneReady]);
  const [noteHidden, setNoteHidden] = useState(false);
  const [seated, setSeated] = useState(false);
  /** Dev builds: the thumbnail / screenshot script hides the task panel. */
  const [hudHidden, setHudHidden] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [states, setStates] = useState(() => initialStates(def));
  const statesRef = useRef(states);
  statesRef.current = states;

  // ── the task run ──
  const [run, setRun] = useState<WorldRun>(() => startRun(def, performance.now()));
  const runRef = useRef(run);
  runRef.current = run;
  const [freePlay, setFreePlay] = useState(false);
  const [justDone, setJustDone] = useState<{ taskId: string; until: number } | null>(null);
  const [hintOn, setHintOn] = useState(false);
  const pageEvents = useRef<WorldEvent[]>([]);
  const [progress, setProgress] = useState<WorldProgress | null>(null);
  const [, setClock] = useState(0);
  const hinted = useRef(false);

  // ── inspect / explorer ──
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [word, setWord] = useState<(WordInfo & { added?: boolean }) | null>(null);
  const [busy, setBusy] = useState<'adding' | 'bumping' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explorerText, setExplorerText] = useState<string | null>(null);
  const [explorer, setExplorer] = useState<PanelController | null>(null);
  const [known, setKnown] = useState<ReadonlySet<string>>(new Set());
  const [segVersion, setSegVersion] = useState(0);
  const gestured = useRef(false);
  const spokenTask = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectXrSupport().then((s) => { if (!cancelled) setSupport(s); });
    void loadSegmenter().then((d) => { if (d && !cancelled) setSegVersion((v) => v + 1); });
    void getProgress(def.id).then((p) => { if (!cancelled) setProgress(p); });
    track('vr_world.enter', { world: def.id, mode: 'flat' });
    sound.preload(ALL_SFX);
    sound.setAmbience(def.ambience);
    // His words: ✓ on the labels of words he knows.
    void knownWords(def.objects.map((o) => o.word.hanzi)).then((set) => {
      if (cancelled) return;
      setKnown(new Set(def.objects.filter((o) => set.has(normalizeHanzi(o.word.hanzi))).map((o) => o.id)));
    });
    return () => {
      cancelled = true;
      sound.dispose();
      disposeAudio();
    };
  }, [def, sound]);

  // Prefetch every task's and object's speech once online (offline after that).
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const texts = [...new Set([...def.tasks.map((t) => t.zh), ...def.objects.map((o) => o.word.hanzi)])];
    void (async () => {
      for (const t of texts) {
        if (cancelled) return;
        // Speech unavailable (no TTS right now): stop — the panels' ▶ asks again when tapped.
        if (!(await getTTSWithCache(t).catch(() => null))) return;
      }
    })();
    return () => { cancelled = true; };
  }, [def, isOnline]);

  // A clock for the HUD's timer and the hint.
  useEffect(() => {
    const t = window.setInterval(() => setClock((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const task = freePlay ? null : currentTask(def, run);
  const finished = run.finishedAt !== null;

  // Read the instruction aloud once per task (after the first gesture: browsers block autoplay).
  const speakTask = useCallback((force = false) => {
    const t = currentTask(def, runRef.current);
    if (!t || !gestured.current) return;
    if (!force && spokenTask.current === t.id) return;
    spokenTask.current = t.id;
    void playText(t.zh);
  }, [def]);
  useEffect(() => {
    if (!freePlay && !justDone) speakTask();
  }, [run.taskIndex, freePlay, justDone, speakTask]);
  useEffect(() => {
    const onGesture = () => {
      sound.unlock();
      sound.resumeLoops();
      if (!gestured.current) {
        gestured.current = true;
        if (!freePlay) speakTask();
      }
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [sound, speakTask, freePlay]);

  // ── the scene's tick: the engine checks the current task ──
  const onTick = useCallback((snap: WorldSnapshot, events: WorldEvent[]) => {
    const all = [...pageEvents.current, ...events];
    pageEvents.current = [];
    if (freePlay) return;
    const prev = runRef.current;
    const r = stepRun(def, prev, snap, all);
    runRef.current = r.run;
    // Re-render only when something shown changed (a task done, a sequence step reached).
    if (r.completed || JSON.stringify(r.run.seq) !== JSON.stringify(prev.seq)) setRun(r.run);
    if (r.completed) {
      const done = r.completed;
      const ms = Math.round(snap.t - prev.taskStartedAt);
      track('vr_world.task_done', { world: def.id, task_index: prev.taskIndex, ms, hinted: hinted.current, mode: apiRef.current?.presenting() ? 'immersive' : 'flat' });
      hinted.current = false;
      setHintOn(false);
      setJustDone({ taskId: done.id, until: Date.now() + JUST_DONE_MS });
      apiRef.current?.celebrate(hintTargets(def, done));
      sound.play(r.finished ? 'finish' : 'success', null, 0.8);
      const totalMs = r.finished ? Math.round(snap.t - r.run.startedAt) : null;
      if (r.finished) track('vr_world.finish', { world: def.id, ms: totalMs, done: r.run.done.length, total: def.tasks.length });
      void recordTask(def.id, done.id, totalMs).then(setProgress);
    }
  }, [def, freePlay, sound]);

  useEffect(() => {
    if (!justDone) return;
    const t = window.setTimeout(() => setJustDone(null), Math.max(0, justDone.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [justDone]);

  // Hints: asked for, or after a while on one task.
  const now = performance.now();
  const hintActive = !!task && !justDone && (hintOn || hintDue(run, now));
  useEffect(() => {
    if (hintActive && !hinted.current) {
      hinted.current = true;
      sound.play('hint', null, 0.5);
    }
  }, [hintActive, sound]);
  const hint = useMemo(() => (hintActive && task ? hintTargets(def, task) : []), [hintActive, task, def]);

  // ── inspect ──
  const openInspect = useCallback((id: string) => {
    const o = def.objects.find((x) => x.id === id);
    if (!o) return;
    setInspectId(id);
    setError(null);
    setBusy(null);
    setWord(null);
    setExplorerText(null);
    pageEvents.current.push({ type: 'inspect', obj: id });
    sound.play('click', null, 0.35);
    void playText(o.word.hanzi);
    void lookupWorldWord(o.word.hanzi).then((info) => {
      setWord(info);
      track('vr_world.inspect', { world: def.id, status: info.status, grabbable: o.mass > 0 });
    });
  }, [def, sound]);

  const inspected = inspectId ? def.objects.find((o) => o.id === inspectId) ?? null : null;

  const useObject = useCallback((id: string, key: string) => {
    const o = def.objects.find((x) => x.id === id);
    const st = o?.states?.find((s) => s.key === key);
    if (!o || !st) return;
    const cur = statesRef.current[id]?.[key] ?? st.initial;
    const values = Object.keys(st.values);
    const next = values[(values.indexOf(cur) + 1) % values.length];
    const nextStates = { ...statesRef.current, [id]: { ...(statesRef.current[id] ?? {}), [key]: next } };
    statesRef.current = nextStates;
    setStates(nextStates);
    pageEvents.current.push({ type: 'use', obj: id });
    sound.play(key === 'door' ? 'open' : 'use', null, 0.6);
    void playText(st.values[next].verb.hanzi);
    track('vr_world.use', { world: def.id });
  }, [def, sound]);

  const onInspectAction = useCallback((action: string) => {
    const o = inspected;
    if (!o) return;
    if (action === 'close') {
      setInspectId(null);
      setExplorerText(null);
    } else if (action === 'play') void playText(o.word.hanzi);
    else if (action.startsWith('use:')) useObject(o.id, action.slice(4));
    else if (action === 'explore') setExplorerText(o.word.hanzi);
    else if (action.startsWith('explore:')) setExplorerText(action.slice(8));
    else if (action === 'add') {
      setBusy('adding');
      setError(null);
      addWorldWordCard(o.word).then((r) => {
        setWord({ status: 'in_decks', noteId: r.noteId, deckName: r.deckName, bumped: false, added: true });
        track('vr_world.add_card', { world: def.id, ok: true });
      }, (e: unknown) => {
        setError(e instanceof Error ? `Couldn’t add it: ${e.message}` : 'Couldn’t add it — try again.');
        track('vr_world.add_card', { world: def.id, ok: false });
      }).finally(() => setBusy(null));
    } else if (action === 'bump' && word?.noteId) {
      setBusy('bumping');
      bumpWorldWord(word.noteId, o.word.hanzi, !!word.added).then(() => {
        setWord((w) => (w ? { ...w, bumped: true } : w));
        track('vr_world.bump', { world: def.id });
      }, () => setError('Couldn’t add it to today — try again.')).finally(() => setBusy(null));
    }
  }, [inspected, word, def, useObject]);

  const inspectNodes = useMemo<UiNode[] | null>(() => {
    if (!inspected) return null;
    const st = inspected.states?.map((s) => {
      const cur = states[inspected.id]?.[s.key] ?? s.initial;
      const values = Object.keys(s.values);
      const next = values[(values.indexOf(cur) + 1) % values.length];
      return { key: s.key, now: s.values[cur].label, next: s.values[next].verb };
    });
    return inspectPanelNodes({
      word: inspected.word,
      status: word?.status ?? 'checking',
      deckName: word?.deckName,
      added: word?.added,
      bumped: word?.bumped,
      online: isOnline,
      busy,
      error,
      states: st,
      grabbable: inspected.mass > 0,
      presenting,
    });
  }, [inspected, word, isOnline, busy, error, states, presenting]);

  // ── HUD ──
  const onHudAction = useCallback((action: string) => {
    if (action === 'speak') speakTask(true);
    else if (action === 'toggle:pinyin' || action === 'toggle:english') {
      setPrefs((p) => {
        const n = action === 'toggle:pinyin' ? { ...p, pinyin: !p.pinyin } : { ...p, english: !p.english };
        savePrefs(n);
        return n;
      });
    } else if (action === 'hint') setHintOn((h) => !h);
    else if (action === 'skip') {
      const r = skipTask(def, runRef.current, performance.now());
      runRef.current = r;
      setRun(r);
      setHintOn(false);
      hinted.current = false;
      track('vr_world.task_skip', { world: def.id, task_index: runRef.current.taskIndex - 1 });
    } else if (action === 'free') setFreePlay(true);
    else if (action === 'tasks') setFreePlay(false);
    else if (action === 'reset') apiRef.current?.resetObjects();
    else if (action === 'seated') setSeated((s) => !s);
    else if (action === 'restart') {
      apiRef.current?.resetObjects();
      const fresh = initialStates(def);
      statesRef.current = fresh;
      setStates(fresh);
      const r = startRun(def, performance.now());
      runRef.current = r;
      setRun(r);
      spokenTask.current = null;
      setFreePlay(false);
    } else if (action === 'leave') {
      apiRef.current?.exitVr();
      navigate('/vr/worlds');
    } else if (action.startsWith('explore:')) setExplorerText(action.slice(8));
  }, [def, navigate, speakTask]);

  const elapsed = (finished ? (run.finishedAt ?? 0) : performance.now()) - run.startedAt;
  const hudNodes = useMemo(() => taskPanelNodes({
    title_zh: def.title_zh,
    task,
    index: run.taskIndex,
    total: def.tasks.length,
    segments: task ? segmentsOf(task.zh) : undefined,
    showPinyin: prefs.pinyin,
    showEnglish: prefs.english,
    step: sequenceProgress(task, run),
    elapsedMs: elapsed,
    justDone: justDone ? def.tasks.find((t) => t.id === justDone.taskId) ?? null : null,
    finished: finished && !freePlay ? { ms: (run.finishedAt ?? 0) - run.startedAt, bestMs: progress?.best_ms ?? null, doneCount: run.done.length } : null,
    freePlay,
    hinting: hintActive,
    presenting,
    seated,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [def, task, run, prefs, Math.floor(elapsed / 1000), justDone, finished, freePlay, progress, hintActive, presenting, seated, segVersion]);

  // ── explorer (the /vr room's explorer window, beside the inspect panel) ──
  const explorerCtx = useMemo(() => ({
    open: () => undefined,
    close: () => setExplorerText(null),
    startSpeech: () => undefined,
    sessionReader: { current: null },
    online: isOnline,
    segVersion,
  }), [isOnline, segVersion]);
  const explorerNodes = useMemo<UiNode[] | null>(() => {
    if (!explorerText || !explorer) return null;
    return [{ t: 'bar', title: explorer.view.title, buttons: [{ t: 'button', label: '✕', action: 'close-explorer', tone: 'plain' }] }, ...explorer.view.nodes];
  }, [explorerText, explorer]);
  const onExplorerAction = useCallback((action: string, source: string) => {
    if (action === 'close-explorer') setExplorerText(null);
    else if (action.startsWith('explore:')) explorer?.onAction(`push:${action.slice(8)}`, source);
    else explorer?.onAction(action, source);
  }, [explorer]);

  const onPresentingChange = useCallback((p: boolean) => {
    setPresenting(p);
    if (p) track('vr_world.enter', { world: def.id, mode: 'immersive' });
  }, [def]);

  const enterVr = async () => {
    gestured.current = true;
    sound.unlock();
    try {
      await apiRef.current?.enterVr();
    } catch (err) {
      setSupport({ status: 'none', reason: err instanceof Error ? err.message : 'The headset refused the session.' });
    }
  };

  // Dev builds: hooks for the e2e spec and screenshots.
  const shown = useRef<{ inspect: UiNode[] | null; hud: UiNode[] }>({ inspect: null, hud: [] });
  shown.current = { inspect: inspectNodes, hud: hudNodes };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __vrWorld?: unknown };
    w.__vrWorld = {
      targets: () => apiRef.current?.targets() ?? [],
      objects: () => apiRef.current?.objects() ?? [],
      place: (id: string, at: [number, number, number]) => apiRef.current?.place(id, at),
      screenOf: (p: [number, number, number]) => apiRef.current?.screenOf(p) ?? null,
      run: () => ({ taskIndex: runRef.current.taskIndex, done: runRef.current.done }),
      presenting: () => apiRef.current?.presenting() ?? false,
      head: () => apiRef.current?.head() ?? null,
      rig: () => apiRef.current?.rig() ?? null,
      stand: (x: number, z: number, yaw: number, pitch?: number) => apiRef.current?.stand(x, z, yaw, pitch),
      hideHud: (hidden: boolean) => setHudHidden(hidden),
      inspect: (id: string) => openInspect(id),
      inspected: () => inspectId,
      /** Every text drawn on the inspect panel / the task panel (they are canvases). */
      inspectTexts: () => nodeTexts(shown.current.inspect ?? []),
      hudTexts: () => nodeTexts(shown.current.hud),
    };
    return () => { delete w.__vrWorld; };
  }, [openInspect, inspectId]);

  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const hold = (k: keyof WalkInput, v: number) => ({
    onPointerDown: (e: ReactPointerEvent) => { e.preventDefault(); walk.current[k] = v; },
    onPointerUp: () => { walk.current[k] = 0; },
    onPointerLeave: () => { walk.current[k] = 0; },
    onPointerCancel: () => { walk.current[k] = 0; },
  });

  return (
    <div className="vr-page vr-world-page">
      {explorerText && <ExplorerPanel spec={{ kind: 'explorer', text: explorerText }} ctx={explorerCtx} report={setExplorer} />}
      <WorldScene
        def={def}
        states={states}
        known={known}
        hint={hint}
        hud={hudHidden ? [] : hudNodes}
        inspect={inspectId && inspectNodes ? { id: inspectId, nodes: inspectNodes } : null}
        explorer={explorerNodes ? { nodes: explorerNodes } : null}
        seated={seated}
        sound={sound}
        walk={walk}
        apiRef={apiRef}
        onTick={onTick}
        onInspect={openInspect}
        onHudAction={onHudAction}
        onInspectAction={onInspectAction}
        onExplorerAction={onExplorerAction}
        onPresentingChange={onPresentingChange}
      />
      <div className="vr-topbar">
        <button type="button" className="vr-close" onClick={() => navigate('/vr/worlds')} aria-label="Leave this world">✕</button>
        <span className="vr-title">{def.title_zh} {def.title_en} <span className="vr-beta">beta</span></span>
        {support.status === 'immersive' && sceneReady && !presenting && (
          <button type="button" className="vr-enter" onClick={() => void enterVr()}>Enter VR</button>
        )}
      </div>
      {support.status === 'none' && !noteHidden && (
        <div className="vr-note vr-world-note" role="note">
          <button type="button" className="vr-note-close" onClick={() => setNoteHidden(true)} aria-label="Hide this note">✕</button>
          <strong>Flat preview.</strong> {isTouch
            ? 'Drag to look, tap a thing for its name, press and hold to pick it up, tap the floor to walk.'
            : 'Click a thing for its name · hold to pick it up · flick (or Space) to throw · WASD or click the floor to walk · drag to look.'}
        </div>
      )}
      {askVr && support.status === 'immersive' && sceneReady && !presenting && (
        <div className="vr-world-enter-overlay">
          <div>
            <div>{def.title_zh} · {def.title_en}</div>
            <button type="button" className="primary" onClick={() => { setAskVr(false); void enterVr(); }}>Enter VR</button>
            <button type="button" className="ghost" onClick={() => setAskVr(false)}>Stay in the preview</button>
          </div>
        </div>
      )}
      {isTouch && !presenting && (
        <div className="vr-walk-pad" aria-label="Walk">
          <button type="button" aria-label="Turn left" {...hold('turn', 1)}>⟲</button>
          <button type="button" aria-label="Walk forward" {...hold('forward', 1)}>▲</button>
          <button type="button" aria-label="Walk back" {...hold('forward', -1)}>▼</button>
          <button type="button" aria-label="Turn right" {...hold('turn', -1)}>⟳</button>
        </div>
      )}
    </div>
  );
}

export default WorldPage;
