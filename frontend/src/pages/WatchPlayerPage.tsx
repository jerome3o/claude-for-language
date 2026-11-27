import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { itemForText } from '@shared/explorer';
import {
  activeLineIndex,
  focusStillHolds,
  lineEndCrossed,
  lineSeekMs,
  nextWatchReveal,
  nextWatchSpeed,
  resumeAtMs,
  stepLine,
  watchClock,
  watchIsWorking,
  watchSpeedLabel,
  watchStatusLine,
  youtubeWatchUrl,
  type WatchLine,
  type WatchReveal,
  type WatchVideoDetail,
} from '@shared/watch';
import { useNetwork } from '../contexts/NetworkContext';
import { addWatchVideo, retryWatchVideo } from '../api/watch';
import {
  cachedWatchVideo,
  fetchWatchVideo,
  localPosition,
  readWatchPref,
  readWatchSpeed,
  rememberPosition,
  storeWatchVideo,
  writeWatchPref,
  writeWatchSpeed,
  type WatchPref,
} from '../services/watch';
import { track } from '../services/analytics';
import { createWatchPlayer, type WatchPlayer, type WatchPlayerInfo } from '../components/watch/player';
import { ChatWordsText, type TappedWord } from '../components/chat/ChatWords';
import { useKnownHanzi } from '../components/reader/ReaderWords';
import { useExplorer } from '../components/explorer/ExplorerContext';
import '../components/chat/chat-learning.css';
import './WatchPage.css';

const TICK_MS = 100;
/** After a seek, YouTube may still report the old time for a moment: no pause check meanwhile. */
const SEEK_GUARD_MS = 500;

/** `/watch/:id` — the player (immersive): YouTube on top, the line card, controls and transcript below. */
export function WatchPlayerPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const explorer = useExplorer();
  const { isOnline } = useNetwork();
  const known = useKnownHanzi();
  const source = params.get('source') === 'share' ? 'share' : params.get('source') === 'show' ? 'show' : 'paste';

  const [video, setVideo] = useState<WatchVideoDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [info, setInfo] = useState<WatchPlayerInfo | null>(null);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [speed, setSpeed] = useState(readWatchSpeed);
  const [prefs, setPrefs] = useState<Record<WatchPref, boolean>>(() => ({
    pinyin: readWatchPref('pinyin'),
    english: readWatchPref('english'),
    pause: readWatchPref('pause'),
    listen: readWatchPref('listen'),
  }));
  const [reveal, setReveal] = useState<WatchReveal>('listen');
  const [startMs, setStartMs] = useState<number | null>(null);

  const playerRef = useRef<WatchPlayer | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastMsRef = useRef(0);
  const focusRef = useRef<number | null>(null);
  const guardUntilRef = useRef(0);
  // Paused at a line's end by "Pause after each line": the line stays on screen until something plays.
  const heldRef = useRef(false);
  const [held, setHeld] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const addingRef = useRef(false);
  const openedRef = useRef(false);
  const lineRef = useRef<HTMLLIElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const lastSentRef = useRef(0);
  const lastSavedRef = useRef(0);

  const lines: WatchLine[] = useMemo(() => video?.lines ?? [], [video]);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // ---- The video's record: the device's copy first, then the server's.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await cachedWatchVideo(id);
      if (cached && alive) setVideo(cached);
      const local = await localPosition(id);
      if (alive) setStartMs(resumeAtMs(local ?? cached?.position_ms ?? 0, cached?.duration_ms ?? null));
      if (!navigator.onLine) {
        if (alive) setLoaded(true);
        return;
      }
      try {
        const fresh = await fetchWatchVideo(id);
        if (!alive) return;
        setVideo(fresh);
        if (local === null && !cached) setStartMs(resumeAtMs(fresh.position_ms, fresh.duration_ms));
      } catch (err) {
        if (!alive) return;
        if ((err as { status?: number }).status === 404) setMissing(true);
        else if (!cached) setError(err instanceof Error ? err.message : 'Could not load the video');
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // ---- First time anyone watches it here: add it once the player knows its length.
  useEffect(() => {
    if (!missing || !info || addingRef.current || !isOnline) return;
    addingRef.current = true;
    if (!info.durationMs) {
      setError("YouTube didn't say how long this video is, so no transcript can be made for it");
      return;
    }
    addWatchVideo({ video_id: id, duration_ms: info.durationMs, title: info.title ?? undefined, source })
      .then(({ video: v }) => {
        setMissing(false);
        setVideo(v);
        void storeWatchVideo(v);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not add the video'));
  }, [missing, info, id, isOnline, source]);

  // ---- Poll while the transcript is being made.
  const working = watchIsWorking(video?.status);
  useEffect(() => {
    if (!working || !isOnline) return;
    const t = window.setInterval(() => {
      void fetchWatchVideo(id)
        .then(setVideo)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [working, isOnline, id]);

  useEffect(() => {
    if (!video || openedRef.current) return;
    openedRef.current = true;
    track('watch.open', { status: video.status, offline: !navigator.onLine, lines: video.lines.length });
  }, [video]);

  // ---- The player (only online; YouTube's embed is the only way the video plays).
  const canPlay = isOnline && startMs !== null && !!id;
  useEffect(() => {
    if (!canPlay || !boxRef.current) return;
    setPlayerError(null);
    const player = createWatchPlayer(boxRef.current, id, startMs ?? 0, {
      onReady: (i) => {
        setInfo(i);
        player.setRate(readWatchSpeed());
      },
      onPlayingChange: setPlaying,
      onError: setPlayerError,
    });
    playerRef.current = player;
    lastMsRef.current = startMs ?? 0;
    return () => {
      const at = player.currentMs();
      if (at > 0) void rememberPosition(id, at, true, true);
      player.destroy();
      playerRef.current = null;
    };
    // startMs is read once, when the player is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPlay, id]);

  // ---- The clock: the line on screen, "Pause after each line", the resume point.
  useEffect(() => {
    const t = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const now = p.currentMs();
      const prev = lastMsRef.current;
      lastMsRef.current = now;
      const isPlaying = p.isPlaying();
      const ls = linesRef.current;
      if (isPlaying && prefsRef.current.pause && Date.now() > guardUntilRef.current) {
        const crossed = lineEndCrossed(ls, prev, now, focusRef.current);
        if (crossed !== null) {
          p.pause();
          focusRef.current = crossed;
          setFocus(crossed);
          // YouTube reports "paused" a moment later: hold the line meanwhile.
          guardUntilRef.current = Date.now() + SEEK_GUARD_MS;
          heldRef.current = true;
          setHeld(true);
        }
      }
      if (focusRef.current !== null && Date.now() > guardUntilRef.current && !focusStillHolds(ls, now, focusRef.current, p.isPlaying() && !heldRef.current)) {
        focusRef.current = null;
        setFocus(null);
      }
      setMs(now);
      if (now > 0 && Date.now() - lastSavedRef.current > 5000) {
        lastSavedRef.current = Date.now();
        const send = Date.now() - lastSentRef.current > 15_000;
        if (send) lastSentRef.current = Date.now();
        void rememberPosition(id, now, send);
      }
    }, TICK_MS);
    return () => window.clearInterval(t);
  }, [id]);

  // Leaving the page (or the app going to the background): save where I am.
  useEffect(() => {
    const save = () => {
      const p = playerRef.current;
      if (p && p.currentMs() > 0) void rememberPosition(id, p.currentMs(), true, true);
    };
    const onHide = () => document.visibilityState === 'hidden' && save();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [id]);

  const active = activeLineIndex(lines, ms, focus, playing && !held);
  const line = active >= 0 ? lines[active] : null;

  // A new line on screen starts covered in listen-first mode.
  useEffect(() => {
    setReveal('listen');
  }, [active]);

  // Keep the current transcript row in view — scrolling the list only, never the page (the video stays put).
  useEffect(() => {
    const list = listRef.current;
    const el = lineRef.current;
    if (!list || !el) return;
    const top = el.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: 'smooth' });
    }
  }, [active]);

  const goLine = useCallback(
    (i: number, action: 'prev' | 'replay' | 'next' | 'tap') => {
      const p = playerRef.current;
      const ls = linesRef.current;
      if (i < 0 || i >= ls.length) return;
      track('watch.line', { action });
      focusRef.current = i;
      setFocus(i);
      const at = lineSeekMs(ls, i);
      guardUntilRef.current = Date.now() + SEEK_GUARD_MS;
      heldRef.current = false;
      setHeld(false);
      lastMsRef.current = at;
      setMs(at);
      if (p) {
        p.seekTo(at);
        p.play();
      }
    },
    [],
  );

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else {
      heldRef.current = false;
      setHeld(false);
      p.play();
    }
  };

  const setPref = (k: WatchPref, on: boolean) => {
    writeWatchPref(k, on);
    setPrefs((old) => ({ ...old, [k]: on }));
    if (k === 'pause') track('watch.pause_mode', { on });
    if (k === 'listen') track('watch.listen_first', { on });
  };

  const changeSpeed = () => {
    const next = nextWatchSpeed(speed);
    setSpeed(next);
    writeWatchSpeed(next);
    playerRef.current?.setRate(next);
    track('watch.speed', { speed: next });
  };

  const tapWord = ({ word, sentence }: TappedWord) => {
    const item = itemForText(word.text, { pinyin: word.pinyin || undefined, gloss: word.gloss || undefined, sentence });
    if (!item) return;
    playerRef.current?.pause();
    explorer.open(item, { source: 'watch' });
  };

  const tapCard = () => {
    if (!prefs.listen || !line) return;
    const next = nextWatchReveal(reveal, !!line.pinyin, !!line.english);
    setReveal(next);
    track('watch.reveal', { step: next });
  };

  const retry = async () => {
    try {
      const { video: v } = await retryWatchVideo(id);
      setVideo(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry');
    }
  };

  const covered = prefs.listen && reveal === 'listen';
  const showHanzi = !prefs.listen || reveal !== 'listen';
  const showPinyin = prefs.listen ? reveal === 'pinyin' || reveal === 'english' : prefs.pinyin;
  const showEnglish = prefs.listen ? reveal === 'english' : prefs.english;
  const title = video?.title || info?.title || 'YouTube video';
  const status = video ? watchStatusLine(video) : null;

  return (
    <div className="watch-player-page" data-testid="watch-player">
      <header className="watch-bar">
        <button type="button" className="watch-bar-back" onClick={() => navigate('/watch')} aria-label="Back to my videos">
          ←
        </button>
        <span className="watch-bar-title" lang="zh-CN">
          {title}
        </span>
        <a className="watch-bar-yt" href={youtubeWatchUrl(id)} target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube">
          ↗
        </a>
      </header>

      <div className="watch-layout">
        <div className="watch-video-col">
          {/* YouTube's terms: the player is at least 200 × 200 and nothing is drawn over it. */}
          <div className="watch-video" ref={boxRef} data-testid="watch-video">
            {!isOnline && (
              <div className="watch-video-msg">
                <span aria-hidden="true">📶</span>
                The video needs a connection — the transcript is below.
              </div>
            )}
          </div>
          {playerError && (
            <p className="watch-player-error" role="alert">
              {playerError}
            </p>
          )}
        </div>

        <div className="watch-side">
          {status && video?.status !== 'ready' && (
            <div className={`watch-banner watch-banner-${video?.status}`} data-testid="watch-status">
              {working && <span className="watch-spinner" aria-hidden="true" />}
              <span>{status}</span>
              {working && lines.length > 0 && <span className="watch-banner-sub">Lines appear as each part is read — start watching.</span>}
              {video?.status === 'failed' && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void retry()}>
                  Retry
                </button>
              )}
            </div>
          )}
          {missing && !info && isOnline && <div className="watch-banner">Loading the video…</div>}
          {error && (
            <p className="watch-problem" role="alert">
              {error}
            </p>
          )}

          <div
            className={`watch-card${covered ? ' watch-card-covered' : ''}${prefs.listen ? ' watch-card-tappable' : ''}`}
            data-testid="watch-card"
            onClick={tapCard}
            role={prefs.listen ? 'button' : undefined}
            aria-label={prefs.listen ? 'Tap to reveal the line' : undefined}
          >
            {line ? (
              <>
                <div className="watch-card-meta">
                  <span>{watchClock(line.start_ms)}</span>
                  {line.speaker && <span className="watch-card-speaker">{line.speaker}</span>}
                </div>
                {showHanzi ? (
                  <div className="watch-card-zh" lang="zh-CN">
                    <ChatWordsText text={line.zh} words={null} showPinyin={false} known={known} onTapWord={tapWord} />
                  </div>
                ) : (
                  <div className="watch-card-listen">🎧 Listen… tap to see the Chinese</div>
                )}
                {showPinyin && line.pinyin && <div className="watch-card-py">{line.pinyin}</div>}
                {showEnglish && line.english && <div className="watch-card-en">{line.english}</div>}
              </>
            ) : (
              <div className="watch-card-empty">
                {lines.length ? (isOnline ? 'Press ▶ — the first line is at ' + watchClock(lines[0].start_ms) : 'Tap a line, or ⏭, to read it here.') : working ? 'The first lines are on their way…' : loaded ? 'No transcript yet.' : ''}
              </div>
            )}
          </div>

          <div className="watch-controls" role="group" aria-label="Line controls">
            <button type="button" className="watch-ctl" onClick={() => goLine(stepLine(lines.length, active, -1), 'prev')} disabled={!lines.length} aria-label="Previous line">
              ⏮
            </button>
            <button type="button" className="watch-ctl watch-ctl-big" onClick={() => goLine(active < 0 ? 0 : active, 'replay')} disabled={!lines.length} aria-label="Replay this line">
              🔁
            </button>
            <button type="button" className="watch-ctl" onClick={togglePlay} disabled={!info} aria-label={playing ? 'Pause' : 'Play'} data-testid="watch-play">
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="watch-ctl" onClick={() => goLine(stepLine(lines.length, active, 1), 'next')} disabled={!lines.length} aria-label="Next line">
              ⏭
            </button>
            <button type="button" className="watch-speed" onClick={changeSpeed} aria-label={`Speed ${watchSpeedLabel(speed)} — change`} data-testid="watch-speed">
              {watchSpeedLabel(speed)}
            </button>
          </div>

          <div className="watch-toggles">
            <button type="button" className={`watch-chip${prefs.pause ? ' on' : ''}`} aria-pressed={prefs.pause} onClick={() => setPref('pause', !prefs.pause)} data-testid="watch-pause-mode">
              ⏸ Pause after each line
            </button>
            <button type="button" className={`watch-chip${prefs.listen ? ' on' : ''}`} aria-pressed={prefs.listen} onClick={() => setPref('listen', !prefs.listen)} data-testid="watch-listen">
              🎧 Listen first
            </button>
            {!prefs.listen && (
              <>
                <button type="button" className={`watch-chip${prefs.pinyin ? ' on' : ''}`} aria-pressed={prefs.pinyin} onClick={() => setPref('pinyin', !prefs.pinyin)}>
                  拼
                </button>
                <button type="button" className={`watch-chip${prefs.english ? ' on' : ''}`} aria-pressed={prefs.english} onClick={() => setPref('english', !prefs.english)}>
                  EN
                </button>
              </>
            )}
          </div>

          <ol className="watch-lines" data-testid="watch-lines" ref={listRef}>
            {lines.map((l, i) => {
              const hidden = prefs.listen && i >= active;
              return (
                <li
                  key={l.i}
                  ref={i === active ? lineRef : undefined}
                  className={`watch-line${i === active ? ' current' : ''}${hidden ? ' hidden' : ''}`}
                  onClick={() => goLine(i, 'tap')}
                >
                  <span className="watch-line-time">{watchClock(l.start_ms)}</span>
                  <span className="watch-line-body">
                    {hidden ? (
                      <span className="watch-line-zh watch-line-dots" aria-label="Hidden until you listen">· · ·</span>
                    ) : (
                      <>
                        <span className="watch-line-zh" lang="zh-CN">
                          {l.zh}
                        </span>
                        {!prefs.listen && prefs.pinyin && l.pinyin && <span className="watch-line-py">{l.pinyin}</span>}
                        {!prefs.listen && prefs.english && l.english && <span className="watch-line-en">{l.english}</span>}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
            {(video?.gaps ?? []).map((g) => (
              <li key={`gap-${g.start_ms}`} className="watch-line watch-gap">
                No transcript for {watchClock(g.start_ms)}–{watchClock(g.end_ms)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
