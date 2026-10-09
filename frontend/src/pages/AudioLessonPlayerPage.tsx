import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AUDIO_LESSON_SPEEDS,
  MUSIC_MAX_VOLUME,
  MUSIC_MIN_VOLUME,
  SLEEP_TIMER_CHOICES,
  audioLessonFormatInfo,
  chapterIndexAt,
  formatClock,
  musicOutputVolume,
  musicShouldPlay,
  musicVolumeLabel,
  previousChapterTarget,
  sleepFadeVolume,
  sleepTimerLabel,
  transcriptIndexAt,
  transcriptRows,
  type AudioLessonDetail,
} from '@shared/audio-lesson';
import { useNetwork } from '../contexts/NetworkContext';
import {
  cachedLessonDetail, downloadLessonFile, fetchLessonDetail, formatMb, lessonMusicBlob, readMusicOn, readMusicVolume,
  readTranscriptShow, savePosition, savedFile, savedPosition, writeMusicOn, writeMusicVolume, writeTranscriptShow,
} from '../services/audioLessons';
import { track } from '../services/analytics';
import { TranscriptLine } from '../components/audioLessons/TranscriptLine';
import { ChapterTitle } from '../components/audioLessons/ChapterTitle';
import { useKnownHanzi } from '../components/reader/ReaderWords';
import { CompanionCard, type CompanionView } from '../components/audioLessons/CompanionCard';
import { audioLessonListened, lessonLockStatus } from '@shared/lesson';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { requestCompanionLesson } from '../api/audioLessons';
import { listenedHere, markAudioLessonListened, unlockLesson } from '../services/lessonUnlock';
import { syncCustomLessons } from '../services/custom-lesson-study';
import './AudioLessonsPage.css';
import '../components/lesson/ReadyToUnlock.css';

const SPEED_KEY = 'audio-lesson-speed-v1';

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return AUDIO_LESSON_SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

type Timer = { minutes: number; endsAt: number | null };

export function AudioLessonPlayerPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [lesson, setLesson] = useState<AudioLessonDetail | null>(() => cachedLessonDetail(id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [download, setDownload] = useState<{ fraction: number; bytes: number } | null>(null);
  const [fromDevice, setFromDevice] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [speed, setSpeed] = useState(readSpeed);
  const [timer, setTimer] = useState<Timer>({ minutes: 0, endsAt: null });
  const [showTimer, setShowTimer] = useState(false);
  const [showTranscript, setShowTranscript] = useState<boolean | null>(null);
  const [showChapters, setShowChapters] = useState(false);
  // The transcript's 拼 / EN toggles (remembered on this device).
  const [showPinyin, setShowPinyin] = useState(() => readTranscriptShow('pinyin'));
  const [showEnglish, setShowEnglish] = useState(() => readTranscriptShow('english'));
  // Words already in a deck: quieter chips in the transcript.
  const known = useKnownHanzi();
  const audioRef = useRef<HTMLAudioElement>(null);
  // The music bed (docs/AUDIO_LESSONS.md "Music"): a second, looping track mixed under the lesson.
  const [musicChoice, setMusicChoice] = useState<boolean | null>(null);
  const [musicVolume, setMusicVolume] = useState(readMusicVolume);
  const [musicSrc, setMusicSrc] = useState<string | null>(null);
  const [musicMissing, setMusicMissing] = useState(false);
  const musicRef = useRef<HTMLAudioElement>(null);
  const startedRef = useRef(false);
  const lineRef = useRef<HTMLLIElement | null>(null);
  // Listened to the end (≥ 85 % or the last chapter): its companion mini lesson unlocks.
  const listenedRef = useRef(false);
  const [listenedNow, setListenedNow] = useState(false);
  const [companionBusy, setCompanionBusy] = useState(false);
  // The companion as this device has it (its unlock shows at once, offline too).
  const localCompanion = useLiveQuery(async () => {
    const rows = (await db.customLessons.toArray()).filter((l) => l.companion_of === id);
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return rows[0] ?? null;
  }, [id]);

  // ---- The lesson's details (cached first, then fresh when online) ----
  useEffect(() => {
    let cancelled = false;
    if (!navigator.onLine && cachedLessonDetail(id)) return;
    fetchLessonDetail(id)
      .then((l) => !cancelled && setLesson(l))
      .catch((err) => !cancelled && !cachedLessonDetail(id) && setLoadError(err instanceof Error ? err.message : 'Could not load the lesson'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The companion being written: check every 5 s; once made, pull it onto this device.
  const companionStatus = lesson?.companion?.status ?? null;
  useEffect(() => {
    if (companionStatus !== 'generating' || !isOnline) return;
    const t = window.setInterval(() => void fetchLessonDetail(id).then(setLesson).catch(() => {}), 5000);
    return () => window.clearInterval(t);
  }, [id, companionStatus, isOnline]);
  const serverCompanionId = lesson?.companion?.lesson_id ?? null;
  useEffect(() => {
    if (!serverCompanionId || localCompanion === undefined || localCompanion || !isOnline) return;
    void syncCustomLessons().catch(() => {});
  }, [serverCompanionId, localCompanion, isOnline]);

  // Not ready yet (opened from a link): keep checking.
  useEffect(() => {
    if (!lesson || lesson.status === 'ready' || lesson.status === 'failed' || !isOnline) return;
    const t = window.setInterval(() => void fetchLessonDetail(id).then(setLesson).catch(() => {}), 5000);
    return () => window.clearInterval(t);
  }, [id, lesson, isOnline]);

  // ---- The file: from the device, else downloaded and kept ----
  const version = lesson?.status === 'ready' ? lesson.audio_version : null;
  useEffect(() => {
    if (!version) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      let blob = await savedFile(id, version);
      if (blob) setFromDevice(true);
      else if (navigator.onLine) {
        setDownload({ fraction: 0, bytes: 0 });
        try {
          blob = await downloadLessonFile(id, version, (fraction, bytes) => !cancelled && setDownload({ fraction, bytes }));
          track('audio_lesson.download', { format: lesson?.format });
          setFromDevice(true);
        } catch (err) {
          if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Download failed');
        } finally {
          if (!cancelled) setDownload(null);
        }
      } else setLoadError("This lesson isn't on this phone yet — open it once with a connection to keep it.");
      if (!blob || cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, version, lesson?.format]);

  const musicOn = musicChoice ?? (lesson ? readMusicOn(lesson.format) : false);

  // The music file: from this device's cache, else fetched once (the PWA precaches it too).
  useEffect(() => {
    if (!musicOn || !src || musicSrc) return;
    let cancelled = false;
    void lessonMusicBlob().then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setMusicMissing(true);
        return;
      }
      setMusicMissing(false);
      setMusicSrc(URL.createObjectURL(blob));
    });
    return () => {
      cancelled = true;
    };
  }, [musicOn, src, musicSrc]);
  useEffect(() => () => {
    if (musicSrc) URL.revokeObjectURL(musicSrc);
  }, [musicSrc]);

  // It plays only while the lesson plays (pause, the end and the sleep timer stop it) and only when on.
  useEffect(() => {
    const m = musicRef.current;
    if (!m || !musicSrc) return;
    if (musicShouldPlay({ on: musicOn, lessonPlaying: playing })) {
      if (m.paused) void m.play().catch(() => {});
    } else if (!m.paused) m.pause();
  }, [musicOn, playing, musicSrc]);

  const chapters = lesson?.chapters ?? [];
  const transcript = lesson?.transcript ?? [];
  const durationMs = lesson?.duration_ms ?? 0;
  const chapterIdx = chapterIndexAt(chapters, now);
  const lineIdx = transcriptIndexAt(transcript, now);
  const transcriptOn = showTranscript ?? lesson?.format !== 'sleep';
  const rows = useMemo(() => transcriptRows(transcript), [transcript]);

  const seekTo = useCallback((ms: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(ms, durationMs)) / 1000;
    setNow(a.currentTime * 1000);
  }, [durationMs]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  const nextChapter = useCallback(() => {
    const next = chapters[chapterIndexAt(chapters, (audioRef.current?.currentTime ?? 0) * 1000) + 1];
    if (next) seekTo(next.start_ms);
  }, [chapters, seekTo]);
  const prevChapter = useCallback(() => seekTo(previousChapterTarget(chapters, (audioRef.current?.currentTime ?? 0) * 1000)), [chapters, seekTo]);
  const skip = useCallback((deltaMs: number) => seekTo((audioRef.current?.currentTime ?? 0) * 1000 + deltaMs), [seekTo]);

  // ---- Audio element wiring ----
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !src) return;
    a.playbackRate = speed;
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  }, [src, speed]);

  const onLoaded = () => {
    const a = audioRef.current;
    if (!a) return;
    const pos = savedPosition(id);
    if (pos > 0 && pos < durationMs - 5000) a.currentTime = pos / 1000;
    a.playbackRate = speed;
  };

  const onPlay = () => {
    setPlaying(true);
    if (!startedRef.current) {
      startedRef.current = true;
      track('audio_lesson.play', { format: lesson?.format, offline: !navigator.onLine, resumed: (audioRef.current?.currentTime ?? 0) > 1 });
    }
  };

  const onPause = () => {
    setPlaying(false);
    savePosition(id, (audioRef.current?.currentTime ?? 0) * 1000);
  };

  const markListened = useCallback(() => {
    if (listenedRef.current) return;
    listenedRef.current = true;
    setListenedNow(true);
    void markAudioLessonListened(id).catch(() => {});
  }, [id]);

  const onEnded = () => {
    setPlaying(false);
    markListened();
    savePosition(id, 0);
    track('audio_lesson.complete', { format: lesson?.format, duration_ms: durationMs });
  };

  // Time + remembered position + the sleep timer, twice a second.
  useEffect(() => {
    if (!src) return;
    let saveTick = 0;
    const t = window.setInterval(() => {
      const a = audioRef.current;
      if (!a) return;
      const ms = a.currentTime * 1000;
      setNow(ms);
      if (!a.paused && ++saveTick % 10 === 0) savePosition(id, ms);
      if (!a.paused && !listenedRef.current && audioLessonListened(ms, durationMs, chapters.map((c) => c.start_ms))) markListened();
      const m = musicRef.current;
      if (m) m.volume = musicOutputVolume(musicVolume, timer.endsAt ? sleepFadeVolume(timer.endsAt - Date.now()) : 1);
      if (timer.minutes === -1 && !a.paused) {
        const next = chapters[chapterIndexAt(chapters, ms) + 1];
        if (next && ms >= next.start_ms - 250) {
          a.pause();
          setTimer({ minutes: 0, endsAt: null });
        }
      } else if (timer.endsAt) {
        const left = timer.endsAt - Date.now();
        a.volume = sleepFadeVolume(left);
        if (left <= 0) {
          a.pause();
          a.volume = 1;
          setTimer({ minutes: 0, endsAt: null });
        }
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [src, id, timer, chapters, musicVolume, durationMs, markListened]);

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = musicOutputVolume(musicVolume);
  }, [musicVolume, musicSrc]);

  useEffect(() => () => {
    if (audioRef.current) savePosition(id, audioRef.current.currentTime * 1000);
  }, [id]);

  // Lock screen / headphones (Media Session).
  useEffect(() => {
    if (!lesson || !src || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: lesson.title, artist: lesson.format === 'dialogue' ? 'Audio lesson' : audioLessonFormatInfo(lesson.format).kind, album: chapters[chapterIdx]?.title ?? '' });
      const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
        ['play', () => void audioRef.current?.play()],
        ['pause', () => audioRef.current?.pause()],
        ['seekbackward', () => skip(-10_000)],
        ['seekforward', () => skip(10_000)],
        ['previoustrack', prevChapter],
        ['nexttrack', nextChapter],
        ['seekto', (d) => d.seekTime != null && seekTo(d.seekTime * 1000)],
      ];
      for (const [action, h] of handlers) ms.setActionHandler(action, h);
    } catch {
      /* an action this browser doesn't know */
    }
  }, [lesson, src, chapters, chapterIdx, skip, prevChapter, nextChapter, seekTo]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !durationMs) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      navigator.mediaSession.setPositionState?.({ duration: durationMs / 1000, playbackRate: speed, position: Math.min(now, durationMs) / 1000 });
    } catch {
      /* ignore */
    }
  }, [playing, now, speed, durationMs]);

  // Keep the current line in view while the transcript is open.
  useEffect(() => {
    if (transcriptOn && playing) lineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [lineIdx, transcriptOn, playing]);

  function setSleepTimer(minutes: number) {
    setShowTimer(false);
    setTimer({ minutes, endsAt: minutes > 0 ? Date.now() + minutes * 60_000 : null });
    if (audioRef.current) audioRef.current.volume = 1;
    track('audio_lesson.sleep_timer', { minutes, format: lesson?.format });
  }

  function toggleMusic() {
    if (!lesson) return;
    const on = !musicOn;
    setMusicChoice(on);
    writeMusicOn(lesson.format, on);
    track('audio_lesson.music', { on, format: lesson.format, volume_pct: Math.round(musicVolume * 100) });
  }

  function commitMusicVolume() {
    writeMusicVolume(musicVolume);
    track('audio_lesson.music', { on: musicOn, format: lesson?.format, volume_pct: Math.round(musicVolume * 100) });
  }

  function changeSpeed() {
    const next = AUDIO_LESSON_SPEEDS[(AUDIO_LESSON_SPEEDS.indexOf(speed) + 1) % AUDIO_LESSON_SPEEDS.length];
    setSpeed(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  // The companion: this device's row first (an unlock here shows at once), else the server's.
  const companion: CompanionView | null = (() => {
    const server = lesson?.companion ?? null;
    if (server && (server.status === 'generating' || server.status === 'failed')) {
      return { status: server.status, lessonId: server.lesson_id, title: server.title, unlock: localCompanion?.unlock ?? null, error: server.error };
    }
    if (localCompanion) {
      const st = lessonLockStatus(localCompanion.unlock ?? null, localCompanion.unlocked_at ?? null);
      return { status: st === 'locked' ? 'locked' : 'unlocked', lessonId: localCompanion.id, title: localCompanion.title, unlock: localCompanion.unlock ?? null };
    }
    if (server) return { status: server.status, lessonId: server.lesson_id, title: server.title, unlock: null };
    return null;
  })();
  const listened = listenedNow || !!lesson?.listened_at || !!listenedHere(id);

  async function makeCompanion() {
    if (!lesson) return;
    setCompanionBusy(true);
    try {
      track('lesson.companion_request', { format: lesson.format });
      const res = await requestCompanionLesson(id);
      setLesson({ ...lesson, companion: res.companion });
    } catch {
      setLesson({ ...lesson, companion: { status: 'failed', lesson_id: null, title: null, error: "Couldn't ask — try again" } });
    } finally {
      setCompanionBusy(false);
    }
  }

  async function unlockCompanion() {
    if (!companion?.lessonId) return;
    setCompanionBusy(true);
    try {
      await unlockLesson(companion.lessonId, 'player', companion.unlock?.kind);
      if (lesson?.companion) setLesson({ ...lesson, companion: { ...lesson.companion, status: 'unlocked' } });
    } finally {
      setCompanionBusy(false);
    }
  }

  const timerLeft = timer.endsAt ? Math.max(0, timer.endsAt - Date.now()) : 0;
  const words = useMemo(() => lesson?.words ?? [], [lesson]);

  if (loadError && !lesson) {
    return (
      <div className="al-player al-player-msg">
        <button className="al-back" onClick={() => navigate('/audio-lessons')} aria-label="Back">←</button>
        <p>{loadError}</p>
      </div>
    );
  }
  if (!lesson) return <div className="al-player al-player-msg"><p>Loading…</p></div>;

  return (
    <div className={`al-player al-player-${lesson.format}`}>
      <header className="al-player-head">
        <button className="al-back" onClick={() => navigate('/audio-lessons')} aria-label="Back to audio lessons">←</button>
        <div className="al-player-titles">
          <div className="al-player-kind">{audioLessonFormatInfo(lesson.format).icon} {audioLessonFormatInfo(lesson.format).kind}</div>
          <h1 className="al-player-title">{lesson.title}</h1>
        </div>
      </header>

      {lesson.status !== 'ready' ? (
        <div className="al-player-msg">
          <p>{lesson.status === 'failed' ? lesson.error : lesson.progress || 'Being made…'}</p>
        </div>
      ) : (
        <>
          <audio
            ref={audioRef}
            src={src ?? undefined}
            data-testid="lesson-audio"
            preload="auto"
            onLoadedMetadata={onLoaded}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
          />
          {musicSrc && (
            <audio
              ref={musicRef}
              src={musicSrc}
              loop
              preload="auto"
              data-testid="lesson-music"
              onLoadedMetadata={(e) => {
                e.currentTarget.volume = musicOutputVolume(musicVolume);
              }}
            />
          )}

          <div className="al-now">
            <div className="al-now-chapter">
              <ChapterTitle chapter={chapters[chapterIdx]} words={words} showPinyin={showPinyin} />
            </div>
            {download ? (
              <div className="al-download">
                Saving to this phone… {download.fraction ? `${Math.round(download.fraction * 100)}%` : formatMb(download.bytes)}
                <span className="al-progress"><span style={{ width: `${Math.round(download.fraction * 100)}%` }} /></span>
              </div>
            ) : (
              fromDevice && <div className="al-fine">✓ Saved on this phone · plays offline</div>
            )}
            {loadError && <div className="al-error">{loadError}</div>}
            {lesson.notice && <div className="al-fine" data-testid="al-player-notice">{lesson.notice}</div>}
          </div>

          <CompanionCard
            view={companion}
            listened={listened}
            online={isOnline}
            busy={companionBusy}
            onMake={() => void makeCompanion()}
            onUnlock={unlockCompanion}
          />

          <div className="al-scrub">
            <input
              type="range"
              min={0}
              max={durationMs}
              step={1000}
              value={Math.min(now, durationMs)}
              onChange={(e) => seekTo(Number(e.target.value))}
              aria-label="Position"
              disabled={!src}
            />
            <div className="al-scrub-times">
              <span>{formatClock(now)}</span>
              <span>−{formatClock(durationMs - now)}</span>
            </div>
          </div>

          <div className="al-controls">
            <button className="al-ctl" onClick={prevChapter} disabled={!src} aria-label="Previous chapter">⏮</button>
            <button className="al-ctl" onClick={() => skip(-10_000)} disabled={!src} aria-label="Back 10 seconds">↺ 10</button>
            <button className="al-ctl al-play" onClick={toggle} disabled={!src} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
            <button className="al-ctl" onClick={() => skip(10_000)} disabled={!src} aria-label="Forward 10 seconds">10 ↻</button>
            <button className="al-ctl" onClick={nextChapter} disabled={!src} aria-label="Next chapter">⏭</button>
          </div>

          <div className="al-chips al-tools">
            <button className="al-chip" onClick={changeSpeed} aria-label="Playback speed">{speed}×</button>
            <button className={`al-chip ${timer.minutes ? 'on' : ''}`} onClick={() => setShowTimer((v) => !v)} aria-label="Sleep timer">
              🌙 {timer.minutes === 0 ? 'Sleep timer' : timer.minutes === -1 ? 'End of chapter' : formatClock(timerLeft)}
            </button>
            <button className={`al-chip ${showChapters ? 'on' : ''}`} onClick={() => setShowChapters((v) => !v)}>☰ Chapters</button>
            <button className={`al-chip ${transcriptOn ? 'on' : ''}`} onClick={() => setShowTranscript(!transcriptOn)}>📝 Transcript</button>
            {transcriptOn && (
              <>
                <button
                  className={`al-chip ${showPinyin ? 'on' : ''}`}
                  aria-pressed={showPinyin}
                  aria-label="Pinyin in the transcript"
                  onClick={() => {
                    setShowPinyin(!showPinyin);
                    writeTranscriptShow('pinyin', !showPinyin);
                  }}
                >
                  拼
                </button>
                <button
                  className={`al-chip ${showEnglish ? 'on' : ''}`}
                  aria-pressed={showEnglish}
                  aria-label="English in the transcript"
                  onClick={() => {
                    setShowEnglish(!showEnglish);
                    writeTranscriptShow('english', !showEnglish);
                  }}
                >
                  EN
                </button>
              </>
            )}
            <button className={`al-chip ${musicOn ? 'on' : ''}`} onClick={toggleMusic} aria-pressed={musicOn} aria-label="Music">
              🎵 Music{musicOn ? '' : ' off'}
            </button>
          </div>

          {musicOn && (
            <div className="al-music">
              <span className="al-music-label" aria-hidden>🎵</span>
              <input
                type="range"
                min={MUSIC_MIN_VOLUME}
                max={MUSIC_MAX_VOLUME}
                step={0.05}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                onPointerUp={commitMusicVolume}
                onKeyUp={commitMusicVolume}
                onBlur={commitMusicVolume}
                aria-label="Music volume"
              />
              <span className="al-music-value">{musicMissing ? 'Not on this phone yet' : musicVolumeLabel(musicVolume)}</span>
            </div>
          )}

          {showTimer && (
            <div className="al-timer-sheet" role="menu" aria-label="Sleep timer">
              {SLEEP_TIMER_CHOICES.map((m) => (
                <button key={m} role="menuitem" className={`al-chip ${timer.minutes === m ? 'on' : ''}`} onClick={() => setSleepTimer(m)}>
                  {sleepTimerLabel(m)}
                </button>
              ))}
              <div className="al-fine">The last 30 seconds fade out.</div>
            </div>
          )}

          {showChapters && (
            <ol className="al-chapters">
              {chapters.map((c, i) => (
                <li key={i}>
                  <button className={i === chapterIdx ? 'current' : ''} onClick={() => seekTo(c.start_ms)}>
                    <ChapterTitle chapter={c} words={words} showPinyin={showPinyin} />
                    <span className="al-chapter-time">{formatClock(c.start_ms)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {transcriptOn && (
            <ol className="al-transcript" aria-label="Transcript">
              {rows.map((row) => {
                const current = lineIdx >= row.first && lineIdx <= row.last;
                return (
                  <TranscriptLine
                    key={row.first}
                    ref={current ? lineRef : undefined}
                    row={row}
                    current={current}
                    showPinyin={showPinyin}
                    showEnglish={showEnglish}
                    known={known}
                    onSeek={seekTo}
                  />
                );
              })}
            </ol>
          )}

          {words.length > 0 && (
            <details className="al-words">
              <summary>Words in this lesson ({words.length})</summary>
              <ul>
                {words.map((w) => (
                  <li key={w.hanzi}>
                    <span className="al-word-hanzi" lang="zh-CN">{w.hanzi}</span> <span className="al-word-pinyin">{w.pinyin}</span>{' '}
                    <span className="al-word-en">{w.english}</span>
                    {w.status && w.status !== 'new' && <span className="al-word-status"> · {w.status === 'known' ? 'you know it' : 'learning'}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
