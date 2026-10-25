/**
 * 🥽 VR (beta) — /vr (docs/VR.md). A WebXR room served by the web app: Enter VR in a browser with
 * immersive WebXR, otherwise a flat 3D preview driven by the mouse. Lazy-loaded (three.js and the
 * Chinese font live only in this chunk).
 *
 * The page side owns everything with app data: the windows (windowStore.ts), one host per window
 * that runs that panel's hooks (the study session, readers, homework, explorer, lessons) and
 * reports a view of plain UI nodes, the 🎤 (the app's live transcription), feedback and the
 * pictures panels show. The scene (scene/VrScene.tsx) only draws views and reports what was
 * pressed.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hanOnly } from '@shared/explorer/stack';
import { validateVrPanelSpec, vrPanelKey, vrPanelTitle, ringPose, VR_DEFAULT_EYE_HEIGHT, type VrPanelSpec, type VrPose } from '@shared/vr';
import { track } from '../services/analytics';
import { loadSegmenter } from '../services/chineseSegmenter';
import { useNetwork } from '../contexts/NetworkContext';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import { initialWindows, saveStoredWindows, windowsReducer, type HeadPose } from './windowStore';
import { VrScene, type VrSceneApi } from './scene/VrScene';
import type { PanelView } from './scene/WindowFrame';
import type { UiNode } from './ui/layout';
import { useVrImages, imageKeysOf } from './images';
import { trayNodes } from './tray';
import { disposeAudio } from './audio';
import { sendFeedback } from './feedback';
import { detectXrSupport, type XrSupport } from './xrSupport';
import { StudyPanel } from './panels/StudyPanel';
import { ReaderPanel } from './panels/ReaderPanel';
import { HomeworkPanel } from './panels/HomeworkPanel';
import { ExplorerPanel } from './panels/ExplorerPanel';
import { LessonPanel } from './panels/LessonPanel';
import { FeedbackPanel, FEEDBACK_SHOT_KEY } from './panels/FeedbackPanel';
import type { PanelContext, PanelController } from './panels/types';
import './vr.css';

export const VR_GUIDE_URL = 'https://github.com/jerome3o/claude-for-language/blob/main/docs/VR.md';

const DEFAULT_HEAD: HeadPose = { position: { x: 0, y: VR_DEFAULT_EYE_HEIGHT, z: 0 }, yaw: 0 };

type OpenSource = 'tray' | 'tap' | 'homework' | 'study' | 'speech';

/** One window's panel: the hooks for its kind, reporting a view + handlers. */
function PanelHost({ id, spec, ctx, onReport, feedbackExtra }: {
  id: string;
  spec: VrPanelSpec;
  ctx: PanelContext;
  onReport(id: string, c: PanelController): void;
  feedbackExtra: Parameters<typeof FeedbackPanel>[0]['extra'];
}) {
  const report = useCallback((c: PanelController) => onReport(id, c), [id, onReport]);
  switch (spec.kind) {
    case 'study': return <StudyPanel spec={spec} ctx={ctx} report={report} />;
    case 'reader': return <ReaderPanel spec={spec} ctx={ctx} report={report} />;
    case 'homework': return <HomeworkPanel spec={spec} ctx={ctx} report={report} />;
    case 'explorer': return <ExplorerPanel spec={spec} ctx={ctx} report={report} />;
    case 'lesson_spec': return <LessonPanel spec={spec} ctx={ctx} report={report} />;
    case 'feedback': return <FeedbackPanel spec={spec} ctx={ctx} report={report} extra={feedbackExtra} />;
  }
}

export function VrPage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const apiRef = useRef<VrSceneApi | null>(null);
  const [support, setSupport] = useState<XrSupport>({ status: 'checking' });
  const [presenting, setPresenting] = useState(false);
  const [state, dispatch] = useReducer(windowsReducer, DEFAULT_HEAD, (head) => {
    const s = initialWindows(head);
    return s.windows.length > 0 ? s : windowsReducer(s, { type: 'open', spec: { kind: 'study' }, head });
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [views, setViews] = useState<Record<string, PanelView>>({});
  const controllers = useRef(new Map<string, PanelController>());
  const [segVersion, setSegVersion] = useState(0);
  const [caption, setCaption] = useState<{ text: string; until: number } | null>(null);
  const sessionReader = useRef<PanelContext['sessionReader']['current']>(null);
  const [shot, setShot] = useState<Blob | null>(null);

  const head = useCallback((): HeadPose => apiRef.current?.head() ?? DEFAULT_HEAD, []);

  useEffect(() => {
    let cancelled = false;
    void detectXrSupport().then((s) => {
      if (cancelled) return;
      setSupport(s);
      track('vr.enter', { mode: 'flat', supported: s.status === 'immersive' });
    });
    void loadSegmenter().then((d) => { if (d && !cancelled) setSegVersion((v) => v + 1); });
    return () => {
      cancelled = true;
      disposeAudio();
    };
  }, []);

  // Positions + open windows, per device.
  useEffect(() => saveStoredWindows(state), [state]);

  const open = useCallback((spec: VrPanelSpec, source: OpenSource) => {
    const checked = validateVrPanelSpec(spec);
    if (!checked.ok) {
      console.warn('[vr] refused a panel spec:', checked.problems);
      return;
    }
    const already = stateRef.current.windows.some((w) => w.key === vrPanelKey(checked.spec));
    dispatch({ type: 'open', spec: checked.spec, head: head() });
    if (!already) track('vr.window_open', { kind: checked.spec.kind, source });
  }, [head]);

  const close = useCallback((id: string) => {
    controllers.current.delete(id);
    setViews((v) => {
      const next = { ...v };
      delete next[id];
      return next;
    });
    dispatch({ type: 'close', id });
  }, []);

  const onReport = useCallback((id: string, c: PanelController) => {
    controllers.current.set(id, c);
    setViews((v) => (v[id] === c.view ? v : { ...v, [id]: c.view }));
  }, []);

  // ── speech (the 🎤 on the tray and in windows): the app's live transcription ──
  const focused = state.windows.find((w) => w.id === state.focusedId) ?? null;
  const speechTarget = useRef<string | null>(null);
  const [draft, setDraft] = useState('');
  const showCaption = (text: string, ms = 3500) => setCaption({ text, until: Date.now() + ms });
  const deliverSpeech = (text: string) => {
    const targetId = speechTarget.current ?? stateRef.current.focusedId;
    speechTarget.current = null;
    const clean = text.trim();
    if (!clean) {
      track('vr.speech', { target: 'none', outcome: 'empty' });
      showCaption('Didn’t catch that — try 🎤 again');
      return;
    }
    const win = stateRef.current.windows.find((w) => w.id === targetId);
    const handled = targetId ? controllers.current.get(targetId)?.onSpeech?.(clean) ?? null : null;
    if (handled) {
      track('vr.speech', { target: handled, outcome: 'ok' });
      showCaption(`🎤 “${clean}” → ${win ? vrPanelTitle(win.spec) : ''}`);
      return;
    }
    const han = hanOnly(clean).slice(0, 8);
    if (han) {
      open({ kind: 'explorer', text: han }, 'speech');
      track('vr.speech', { target: 'explorer_open', outcome: 'ok' });
      showCaption(`🎤 “${clean}” → Explorer`);
    } else {
      track('vr.speech', { target: 'none', outcome: 'unused' });
      showCaption(`🎤 Heard “${clean}” — focus a window that takes speech (Study, Explorer, Feedback)`, 5000);
    }
  };
  const dictation = useVoiceDictation({
    surface: 'vr',
    value: draft,
    onChange: setDraft,
    onSubmit: (answer) => {
      setDraft('');
      deliverSpeech(answer.text);
    },
    autoSubmit: true,
    lang: focused?.spec.kind === 'feedback' ? 'en' : 'zh',
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  useEffect(() => {
    if (dictation.state.phase === 'failed') {
      track('vr.speech', { target: 'none', outcome: 'failed' });
      showCaption('Couldn’t transcribe — press 🎤 to try again', 5000);
    }
  }, [dictation.state.phase]);
  const startSpeech = useCallback((targetId?: string) => {
    const d = dictationRef.current;
    if (d.listening) {
      d.stop();
      return;
    }
    if (d.busy) return;
    speechTarget.current = targetId ?? stateRef.current.focusedId;
    d.say();
  }, []);

  // ── feedback: screenshot first (what you were looking at), then the window ──
  const openFeedback = useCallback(async () => {
    const blob = await apiRef.current?.capture().catch(() => null) ?? null;
    setShot(blob);
    open({ kind: 'feedback' }, 'tray');
  }, [open]);
  const feedbackExtra = useMemo(() => ({
    hasShot: !!shot,
    listening: dictation.listening,
    send: async (message: string) => {
      try {
        const kinds = stateRef.current.windows.map((w) => w.spec.kind);
        const r = await sendFeedback({ message, screenshot: shot, context: { mode: apiRef.current?.presenting() ? 'immersive' : 'flat', windows: kinds, xr: support.status } });
        track('vr.feedback', { screenshot: r.screenshot, via: r.via, mode: apiRef.current?.presenting() ? 'immersive' : 'flat' });
        return true;
      } catch {
        return false;
      }
    },
  }), [shot, dictation.listening, support.status]);

  const ctxFor = useCallback((id: string): PanelContext => ({
    open: (spec, source) => open(spec, source),
    close: () => close(id),
    startSpeech: () => startSpeech(id),
    sessionReader,
    online: isOnline,
    segVersion,
  }), [open, close, startSpeech, isOnline, segVersion]);
  const ctxs = useMemo(() => new Map(state.windows.map((w) => [w.id, ctxFor(w.id)])), [state.windows, ctxFor]);

  // ── what the scene reports ──
  const onWindowAction = useCallback((id: string, action: string, source: string) => {
    const win = stateRef.current.windows.find((w) => w.id === id);
    if (!win) return;
    if (action.startsWith('explore:')) {
      const text = action.slice(8);
      // inside the explorer a tap goes deeper; anywhere else it opens the explorer on it
      if (win.spec.kind === 'explorer') controllers.current.get(id)?.onAction(`push:${text}`, source);
      else open({ kind: 'explorer', text }, 'tap');
      return;
    }
    controllers.current.get(id)?.onAction(action, source);
  }, [open]);

  const onTrayAction = useCallback((action: string) => {
    if (action.startsWith('open:')) {
      const kind = action.slice(5);
      if (kind === 'explorer') {
        const existing = stateRef.current.windows.find((w) => w.spec.kind === 'explorer');
        open(existing ? existing.spec : { kind: 'explorer', text: '中文' }, 'tray');
      } else {
        const r = validateVrPanelSpec({ kind });
        if (r.ok) open(r.spec, 'tray');
      }
    } else if (action === 'speak') startSpeech();
    else if (action === 'feedback') void openFeedback();
    else if (action === 'recall') dispatch({ type: 'recall', head: head() });
    else if (action === 'exit') apiRef.current?.exitVr();
  }, [open, startSpeech, openFeedback, head]);

  const onPresentingChange = useCallback((p: boolean) => {
    setPresenting(p);
    // In the headset: everything around where you actually are and look.
    if (p) dispatch({ type: 'recall', head: head() });
  }, [head]);

  const onMove = useCallback((id: string, pose: VrPose) => dispatch({ type: 'move', id, pose, head: head() }), [head]);
  const onFront = useCallback((id: string) => {
    const h = head();
    dispatch({ type: 'move', id, pose: ringPose(0, h.position, h.yaw), head: h });
    dispatch({ type: 'focus', id });
  }, [head]);
  const onFocus = useCallback((id: string) => dispatch({ type: 'focus', id }), []);

  const enterVr = async () => {
    try {
      await apiRef.current?.enterVr();
      track('vr.enter', { mode: 'immersive', supported: true });
    } catch (err) {
      setSupport({ status: 'none', reason: err instanceof Error ? err.message : 'The headset refused the session.' });
    }
  };

  // Pictures the views show (reader pages, the feedback screenshot).
  const imageKeys = useMemo(() => imageKeysOf(Object.values(views)), [views]);
  const images = useVrImages(imageKeys, shot ? { [FEEDBACK_SHOT_KEY]: shot } : {});

  // Caption above the tray: the live transcript, then what happened to it.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!caption) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.max(0, caption.until - Date.now()) + 50);
    return () => window.clearTimeout(t);
  }, [caption]);
  const captionNodes = useMemo<UiNode[] | null>(() => {
    if (dictation.listening || dictation.state.phase === 'finishing') {
      const heard = `${dictation.finalText}${dictation.partialText}`;
      const target = state.windows.find((w) => w.id === (speechTarget.current ?? state.focusedId));
      return [
        { t: 'text', text: dictation.listening ? `🎤 Listening${target ? ` for ${vrPanelTitle(target.spec)}` : ''}… press ■ Stop when done` : '🎤 Writing it down…', size: 24, color: 'accent' },
        { t: 'text', text: heard || '…', size: 36, color: 'zh' },
      ];
    }
    if (caption && caption.until > Date.now()) return [{ t: 'text', text: caption.text, size: 28 }];
    return null;
  }, [dictation.listening, dictation.state.phase, dictation.finalText, dictation.partialText, caption, state.windows, state.focusedId]);

  const tray = useMemo(() => trayNodes({ presenting, listening: dictation.listening, busy: dictation.busy, online: isOnline }), [presenting, dictation.listening, dictation.busy, isOnline]);

  // Dev builds: hooks for the e2e spec and screenshots.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __vr?: unknown };
    w.__vr = {
      targets: () => apiRef.current?.targets() ?? [],
      windows: () => stateRef.current.windows.map((x) => ({ id: x.id, kind: x.spec.kind, key: x.key, pose: x.pose })),
      focusedId: () => stateRef.current.focusedId,
      captureSize: async () => (await apiRef.current?.capture())?.size ?? null,
      head: () => apiRef.current?.head() ?? null,
    };
    return () => { delete w.__vr; };
  }, []);

  return (
    <div className="vr-page">
      {state.windows.map((w) => (
        <PanelHost key={w.id} id={w.id} spec={w.spec} ctx={ctxs.get(w.id)!} onReport={onReport} feedbackExtra={feedbackExtra} />
      ))}
      <VrScene
        windows={state.windows}
        focusedId={state.focusedId}
        views={views}
        images={images}
        tray={tray}
        caption={captionNodes}
        apiRef={apiRef}
        onWindowAction={onWindowAction}
        onClose={close}
        onFocus={onFocus}
        onMove={onMove}
        onFront={onFront}
        onTrayAction={onTrayAction}
        onPresentingChange={onPresentingChange}
      />
      <div className="vr-topbar">
        <button type="button" className="vr-close" onClick={() => navigate(-1)} aria-label="Leave VR">✕</button>
        <span className="vr-title">🥽 VR <span className="vr-beta">beta</span></span>
        {support.status === 'immersive' && (
          <button type="button" className="vr-enter" onClick={() => void enterVr()}>Enter VR</button>
        )}
      </div>
      {support.status === 'none' && (
        <div className="vr-note" role="note">
          <strong>Flat preview.</strong> {support.reason} Drag to look around, click to press, drag a window’s bar to move it.{' '}
          <a href={VR_GUIDE_URL} target="_blank" rel="noreferrer">How to use it in a headset</a> · <Link to="/settings">Settings</Link>
        </div>
      )}
    </div>
  );
}

export default VrPage;
