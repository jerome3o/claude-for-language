/**
 * 🎬 The clip player (docs/CLIPS.md "Player"): one full-screen clip on the clip clock
 * (shared/clips/playback.ts), its scene's voice lines through practice TTS (cached on the
 * device) with karaoke captions (Karaoke.tsx), progress segments, the right rail (❤️ like ·
 * 🔖 save · ✨ learn more · 拼 · EN · 🎵 music · 🔇 · ⌄ next) and the gestures — tap = pause /
 * play, double-tap = ❤️ burst + like + Learn more, long press = Learn more. Interactive scenes
 * (quiz, listen, order, reveal, speak — ClipInteractive.tsx) stop the clock and wait for the
 * learner. Only the ACTIVE clip plays; tapping Chinese opens the explorer and pauses.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CLIP_DOUBLE_TAP_MS,
  CLIP_DOUBLE_TAP_PX,
  CLIP_LINE_GAP_MS,
  CLIP_LONG_PRESS_MS,
  clipAnswerOption,
  clipAnswerOrder,
  clipContinue,
  clipFlip,
  clipProgressSegments,
  clipSceneFill,
  clipSkip,
  clipSpeakResult,
  clipStart,
  clipTick,
  sceneRevealUtterances,
  sceneUtterances,
  type ClipInteractResult,
  type ClipPlayState,
  type ClipRecord,
  type ClipUtterance,
} from '@shared/clips';
import { clipLineAudio, clipPicture, type ClipCaptionPrefs } from '../../services/clips';
import { SceneView, Zh, type SceneCtx } from './ClipScenes';
import { KaraokeLine, type SpeechClock } from './Karaoke';
import { clipFeedback } from './clipFeedback';
import type { InteractActions } from './ClipInteractive';

const TICK_MS = 100;
/** A line whose audio takes longer than this to arrive is skipped (the scene goes on). */
const LINE_FETCH_TIMEOUT_MS = 6000;

export type LearnMoreVia = 'double_tap' | 'long_press' | 'button' | 'end_card';
export type ClipPrefToggle = 'pinyin' | 'english' | 'mute' | 'music';

export interface ClipPlayerProps {
  clip: ClipRecord;
  active: boolean;
  prefs: ClipCaptionPrefs;
  onPrefs: (prefs: ClipCaptionPrefs, toggled: ClipPrefToggle) => void;
  onLike: (via: 'button' | 'double_tap') => void;
  onSave: () => void;
  onLearnMore: (via: LearnMoreVia) => void;
  /** The clip reached its end card. */
  onComplete: (durationMs: number) => void;
  /** An interactive scene settled (quiz / listen / order / reveal / speak). */
  onInteract: (layout: string, result: ClipInteractResult, waitedMs: number) => void;
  onExplore: (layout: string) => void;
  /** The next clip (the rail's ⌄, the end card's Next ↓). */
  onNext?: (via: 'button' | 'end_card') => void;
  /** Hold the clip (a sheet is open over it). */
  held?: boolean;
  /** The clip is playing (for the music under the feed). */
  onPlaying?: (playing: boolean) => void;
  /** A voice line is playing (the music ducks under it). */
  onSpeaking?: (speaking: boolean) => void;
  /** Start the first play at this scene (a /clips/:id?scene= link). */
  startScene?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export function ClipPlayer(props: ClipPlayerProps) {
  const { clip, active, prefs, held } = props;
  const spec = clip.spec!;
  const [play, setPlay] = useState<ClipPlayState>(() => clipStart(spec));
  const [paused, setPaused] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [replay, setReplay] = useState(0);
  const [hearAgain, setHearAgain] = useState(0);
  const [spokenLine, setSpokenLine] = useState(-1);
  const [clock, setClock] = useState<SpeechClock | null>(null);
  const [hearts, setHearts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [picture, setPicture] = useState<string | null>(null);
  const speakingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechToken = useRef(0);
  const startedAt = useRef(0);
  const reported = useRef<number>(-1);
  const completed = useRef(false);
  const startScene = useRef(props.startScene ?? 0);
  const wasActive = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const running = active && !paused && !exploring && !held && !play.done;
  const scene = spec.scenes[play.scene];
  const answered = !!play.interact && play.interact.result !== null;

  // A clip starts from the top each time it becomes the one on screen.
  useEffect(() => {
    if (!active) {
      if (wasActive.current) startScene.current = 0; // a later visit starts from the top
      return;
    }
    wasActive.current = true;
    setPlay(clipStart(spec, replay > 0 ? 0 : startScene.current));
    setPaused(false);
    setSpokenLine(-1);
    completed.current = false;
    reported.current = -1;
    startedAt.current = Date.now();
  }, [active, clip.id, replay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    props.onPlaying?.(running);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock.
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(250, now - last);
      last = now;
      setPlay((s) => clipTick(spec, s, dt, speakingRef.current));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, spec]);

  // The end card.
  useEffect(() => {
    if (active && play.done && !completed.current) {
      completed.current = true;
      props.onComplete(Date.now() - startedAt.current);
    }
  }, [active, play.done]); // eslint-disable-line react-hooks/exhaustive-deps

  // An interactive scene settled (an answer / Skip): reported once, with instant feedback.
  useEffect(() => {
    const r = play.interact?.result;
    if (!r || !scene || reported.current === play.scene) return;
    reported.current = play.scene;
    props.onInteract(scene.layout, r, Math.round(play.interact!.waited_ms));
    clipFeedback(r === 'right' ? 'right' : r === 'wrong' ? 'wrong' : r === 'close' ? 'close' : r === 'done' ? 'flip' : 'tap', prefs.muted);
  }, [play.interact?.result, play.scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Speech: lines in turn; the clock holds while they play ----------
  const setSpeaking = (on: boolean) => {
    if (speakingRef.current === on) return;
    speakingRef.current = on;
    latest.current.onSpeaking?.(on);
  };

  const stopSpeech = useCallback(() => {
    speechToken.current++;
    audioRef.current?.pause();
    setSpeaking(false);
    setClock(null);
    setSpokenLine(-1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const speak = useCallback(async (lines: ClipUtterance[]) => {
    const token = ++speechToken.current;
    audioRef.current?.pause();
    if (!lines.length) {
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    for (const line of lines) {
      if (token !== speechToken.current) return;
      const blob = await withTimeout(clipLineAudio(line.text, line.voice_id), LINE_FETCH_TIMEOUT_MS);
      if (token !== speechToken.current) return;
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      el.src = url;
      setSpokenLine(line.line);
      setClock({
        scene: line.scene,
        line: line.line,
        text: line.text,
        lang: line.lang,
        positionMs: () => el.currentTime * 1000,
        durationMs: () => (Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : null),
      });
      await new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener('ended', done);
          el.removeEventListener('error', done);
          resolve();
        };
        el.addEventListener('ended', done);
        el.addEventListener('error', done);
        el.play().catch(done);
      });
      URL.revokeObjectURL(url);
      if (token !== speechToken.current) return;
      await new Promise((r) => setTimeout(r, CLIP_LINE_GAP_MS));
    }
    if (token === speechToken.current) {
      setSpeaking(false);
      setClock(null);
      setSpokenLine(-1);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The scene's own lines when it starts (and "Play again" on listen / speak).
  useEffect(() => {
    if (!active || !scene || play.done || prefs.muted) {
      stopSpeech();
      return;
    }
    void speak(sceneUtterances(scene, play.scene));
    return () => stopSpeech();
    // A new scene, a replay, (un)muting or the clip leaving the screen restarts it.
  }, [active, play.scene, play.done, prefs.muted, replay, clip.id, hearAgain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once an order / reveal scene is answered: hear the Chinese.
  useEffect(() => {
    if (!active || !answered || !scene || prefs.muted) return;
    const lines = sceneRevealUtterances(scene, play.scene);
    if (lines.length) void speak(lines);
  }, [answered]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause / play the line with the clip.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (running) {
      if (el.paused && el.src && !el.ended && speakingRef.current) el.play().catch(() => {});
    } else el.pause();
  }, [running]);

  useEffect(
    () => () => {
      speechToken.current++;
      audioRef.current?.pause();
      latest.current.onSpeaking?.(false);
    },
    [],
  );

  // The scene's picture (cached on the device).
  const imageKey = scene?.image_prompt ? clip.images[scene.image_prompt.trim()] ?? clip.images[scene.image_prompt] : undefined;
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    setPicture(null);
    if (!imageKey) return;
    void clipPicture(imageKey).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setPicture(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [imageKey]);

  // ---------- Gestures (never a vertical drag: that is the feed's swipe) ----------
  const gesture = useRef<{ x: number; y: number; t: number; long: boolean; timer: number | null } | null>(null);
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  const singleTimer = useRef<number | null>(null);

  const ignoreTarget = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('button, a, input, [role="button"], [data-no-gesture]');

  const onPointerDown = (e: ReactPointerEvent) => {
    if (ignoreTarget(e.target)) return;
    const g = { x: e.clientX, y: e.clientY, t: Date.now(), long: false, timer: null as number | null };
    g.timer = window.setTimeout(() => {
      g.long = true;
      props.onLearnMore('long_press');
    }, CLIP_LONG_PRESS_MS);
    gesture.current = g;
  };
  const cancelGesture = () => {
    if (gesture.current?.timer) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) cancelGesture();
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.timer) window.clearTimeout(g.timer);
    gesture.current = null;
    if (g.long) return;
    const now = Date.now();
    const prev = lastTap.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (prev && now - prev.t <= CLIP_DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= CLIP_DOUBLE_TAP_PX) {
      lastTap.current = null;
      if (singleTimer.current) window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
      const id = now;
      setHearts((h) => [...h, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      window.setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 950);
      props.onLike('double_tap');
      window.setTimeout(() => props.onLearnMore('double_tap'), 550);
      return;
    }
    lastTap.current = { x: e.clientX, y: e.clientY, t: now };
    singleTimer.current = window.setTimeout(() => {
      singleTimer.current = null;
      if (!play.done) setPaused((p) => !p);
    }, CLIP_DOUBLE_TAP_MS);
  };

  const ctx: SceneCtx = {
    pinyin: prefs.pinyin,
    english: prefs.english,
    onExplore: () => {
      setExploring(true);
      props.onExplore(scene?.layout ?? 'end');
    },
    onExplorerClosed: () => setExploring(false),
  };

  const actions: InteractActions = useMemo(
    () => ({
      onOption: (option) => setPlay((s) => clipAnswerOption(spec, s, option)),
      onOrder: (order) => setPlay((s) => clipAnswerOrder(spec, s, order)),
      onFlip: () => setPlay((s) => clipFlip(s)),
      onSpeak: (p) => setPlay((s) => clipSpeakResult(s, p.verdict)),
      onSkip: () => setPlay((s) => clipSkip(s)),
      onContinue: () => setPlay((s) => clipContinue(spec, s)),
      onReplay: () => setHearAgain((n) => n + 1),
    }),
    [spec],
  );

  const segments = clipProgressSegments(spec, play.scene, play.elapsed_ms).map((f, i) => (i === play.scene ? clipSceneFill(spec, play) : f));
  const theme = spec.style.theme;
  const style = spec.style.accent ? ({ '--clip-accent': spec.style.accent } as React.CSSProperties) : undefined;
  const voiceText = scene?.voice?.text?.trim() ? scene.voice.text : null;
  const voiceLang = scene?.voice?.lang === 'en' ? 'en' : 'zh';
  // The caption follows the scene's voice line while it is read (its TTS text: " / " read as "，").
  const voiceClock = clock && clock.line === -1 && clock.scene === play.scene ? clock : null;

  return (
    <div
      className={`clip-root clip-theme-${theme}${picture ? ' has-picture' : ''}${!running && active && !play.done ? ' clip-paused' : ''}${play.interact && !answered ? ' clip-waiting' : ''}`}
      style={style}
      data-testid="clip-player"
      data-clip-id={clip.id}
      data-scene={play.done ? 'end' : String(play.scene)}
      data-theme={theme}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="clip-texture" />
      {picture && (
        <div className="clip-picture" key={picture}>
          <img src={picture} alt="" />
        </div>
      )}
      <div className="clip-progress" aria-label={`Scene ${Math.min(play.scene + 1, spec.scenes.length)} of ${spec.scenes.length}`}>
        {segments.map((f, i) => (
          <span key={i}>
            <i style={{ transform: `scaleX(${f})` }} />
          </span>
        ))}
      </div>

      {play.done ? (
        <div className="clip-stage clip-end" key={`end-${replay}`} data-testid="clip-end">
          <div className="clip-emoji" aria-hidden="true">🎬</div>
          {spec.ending?.question_en && <div className="clip-end-q"><EndQuestion text={spec.ending.question_en} ctx={ctx} /></div>}
          <div className="clip-words">
            {spec.words.map((w) => (
              <span className="clip-word" key={w.hanzi}>
                <Zh text={w.hanzi} ctx={ctx} className="clip-zh" />
                {prefs.pinyin && <small className="clip-pinyin"> {w.pinyin}</small>}
              </span>
            ))}
          </div>
          <div className="clip-end-cta">{spec.ending?.cta || 'Double-tap to learn more'}</div>
          <div className="clip-end-actions">
            <button type="button" className="clip-btn primary" onClick={() => props.onLearnMore('end_card')} data-testid="clip-end-learn">✨ Learn more</button>
            <button type="button" className="clip-btn" onClick={() => setReplay((n) => n + 1)}>↻ Watch again</button>
            {props.onNext && <button type="button" className="clip-btn" onClick={() => props.onNext?.('end_card')}>Next ↓</button>}
          </div>
        </div>
      ) : scene ? (
        <div className={`clip-stage clip-layout-${scene.layout}`} key={`${play.scene}-${replay}`} data-testid="clip-stage" data-layout={scene.layout}>
          <SceneView spec={spec} clipId={clip.id} scene={scene} index={play.scene} play={play} ctx={ctx} spokenLine={spokenLine} clock={clock} muted={prefs.muted} actions={actions} />
        </div>
      ) : null}

      <div className="clip-bottom">
        {voiceText && !play.done && (
          <div className={`clip-caption is-karaoke${voiceClock ? ' is-live' : ''}`} data-testid="clip-caption" key={`${play.scene}-${voiceText}`}>
            <KaraokeLine
              text={voiceClock ? voiceClock.text : voiceText}
              lang={voiceLang}
              clock={voiceClock}
              pinyin={prefs.pinyin}
              onExplore={ctx.onExplore}
              onExplorerClosed={ctx.onExplorerClosed}
            />
          </div>
        )}
        <div className="clip-meta">
          <strong>🎬 {spec.title}</strong>
          <span>{spec.words.map((w) => w.hanzi).join(' · ')}{spec.tags?.length ? ` · #${spec.tags.slice(0, 3).join(' #')}` : ''}</span>
        </div>
      </div>

      <div className="clip-rail" data-no-gesture>
        <button type="button" className={clip.state.liked ? 'liked' : ''} aria-pressed={clip.state.liked} onClick={() => props.onLike('button')} data-testid="clip-like">
          <span className="ico" aria-hidden="true">{clip.state.liked ? '❤️' : '🤍'}</span>
          <span className="lbl">{clip.state.liked ? 'Liked' : 'Like'}</span>
        </button>
        <button type="button" aria-pressed={clip.state.saved} onClick={props.onSave} data-testid="clip-save">
          <span className="ico" aria-hidden="true">🔖</span>
          <span className="lbl">{clip.state.saved ? 'Saved' : 'Save'}</span>
        </button>
        <button type="button" onClick={() => props.onLearnMore('button')} data-testid="clip-learn-more">
          <span className="ico" aria-hidden="true">✨</span>
          <span className="lbl">More</span>
        </button>
        <button type="button" aria-pressed={prefs.pinyin} onClick={() => props.onPrefs({ ...prefs, pinyin: !prefs.pinyin }, 'pinyin')} data-testid="clip-toggle-pinyin">
          <span className="ico zh-toggle" aria-hidden="true">拼</span>
          <span className="lbl">Pinyin {prefs.pinyin ? 'on' : 'off'}</span>
        </button>
        <button type="button" aria-pressed={prefs.english} onClick={() => props.onPrefs({ ...prefs, english: !prefs.english }, 'english')} data-testid="clip-toggle-english">
          <span className="ico" aria-hidden="true">EN</span>
          <span className="lbl">English {prefs.english ? 'on' : 'off'}</span>
        </button>
        <button type="button" aria-pressed={prefs.music} onClick={() => props.onPrefs({ ...prefs, music: !prefs.music }, 'music')} data-testid="clip-toggle-music">
          <span className="ico" aria-hidden="true">{prefs.music ? '🎵' : '♪'}</span>
          <span className="lbl">Music {prefs.music ? 'on' : 'off'}</span>
        </button>
        <button type="button" aria-pressed={prefs.muted} onClick={() => props.onPrefs({ ...prefs, muted: !prefs.muted }, 'mute')} data-testid="clip-toggle-mute">
          <span className="ico" aria-hidden="true">{prefs.muted ? '🔇' : '🔊'}</span>
          <span className="lbl">{prefs.muted ? 'Muted' : 'Sound'}</span>
        </button>
        {props.onNext && (
          <button type="button" className="clip-rail-next" onClick={() => props.onNext?.('button')} aria-label="Next clip" data-testid="clip-next">
            <span className="ico" aria-hidden="true">⌄</span>
            <span className="lbl">Next</span>
          </button>
        )}
      </div>

      {active && paused && !play.done && <div className="clip-paused-icon" aria-label="Paused">▶</div>}
      {hearts.map((h) => (
        <span key={h.id} className="clip-heart" style={{ left: h.x, top: h.y }} aria-hidden="true" data-testid="clip-heart">❤️</span>
      ))}
    </div>
  );
}

function EndQuestion({ text, ctx }: { text: string; ctx: SceneCtx }) {
  const parts = text.split(/(\p{Script=Han}[\p{Script=Han}，、。？！_]*)/u).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (/\p{Script=Han}/u.test(p) ? <Zh key={i} text={p} ctx={ctx} /> : <span key={i}>{p}</span>))}
    </>
  );
}
