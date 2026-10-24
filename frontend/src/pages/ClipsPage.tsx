/**
 * 🎬 Clips (experimental, docs/CLIPS.md): the vertical feed at /clips (and /clips/:id, which
 * starts at that clip). Full-screen snap scroll — swipe up for the next clip — with only the
 * clip on screen playing, the lesson music loop quietly under it, the next clip prefetched, and
 * the Learn more sheet. Works offline for clips already on the device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clipInteractValue, clipMusicFor, clipMusicShouldPlay, clipMusicStep, clipMusicTarget, CLIP_MUSIC_VOLUME, type ClipRecord } from '@shared/clips';
import { ClipPlayer, type ClipPrefToggle, type LearnMoreVia } from '../components/clips/ClipPlayer';
import { LearnMoreSheet } from '../components/clips/LearnMoreSheet';
import { deleteClip, generateClips, retryClip } from '../api/clips';
import {
  cacheClip,
  cachedClipFeed,
  flushClipEvents,
  loadClipPrefs,
  prefetchClip,
  recordClipEvent,
  refreshClipFeed,
  saveClipPrefs,
  type ClipCaptionPrefs,
} from '../services/clips';
import { track } from '../services/analytics';
import { useNetwork } from '../contexts/NetworkContext';
import '../components/clips/clips.css';

export function ClipsPage() {
  const { id: startId } = useParams();
  const [search] = useSearchParams();
  const startScene = Number(search.get('scene') ?? '') || 0;
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [clips, setClips] = useState<ClipRecord[] | null>(null);
  const [active, setActive] = useState(0);
  const [prefs, setPrefsState] = useState<ClipCaptionPrefs>(() => loadClipPrefs());
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const viewed = useRef(new Set<string>());
  const completed = useRef(new Set<string>());
  const music = useRef<HTMLAudioElement | null>(null);
  const speaking = useRef(false);
  const positioned = useRef(false);
  const opened = useRef(false);

  // Load: the device's feed first, then the server's.
  useEffect(() => {
    let live = true;
    void (async () => {
      const cached = await cachedClipFeed();
      if (live && cached) setClips(cached);
      const fresh = await refreshClipFeed();
      if (!live) return;
      const list = fresh ?? cached ?? [];
      // The order on screen stays put (a clip may be playing); new clips join at the end.
      setClips((prev) => (prev && prev.length ? mergeKeepingOrder(prev, list) : list));
      setLoaded(true);
      if (!opened.current) {
        opened.current = true;
        track('clips.open', { clips: list.length, cached: !!cached, offline: !navigator.onLine });
      }
    })();
    const online = () => void flushClipEvents();
    window.addEventListener('online', online);
    return () => {
      live = false;
      window.removeEventListener('online', online);
      void flushClipEvents();
    };
  }, []);

  // Clips being written: refresh until they're ready.
  const generating = clips?.some((c) => c.status === 'generating') ?? false;
  useEffect(() => {
    if (!generating || !isOnline) return;
    const id = window.setInterval(async () => {
      const fresh = await refreshClipFeed();
      if (fresh) setClips((prev) => mergeKeepingOrder(prev ?? [], fresh));
    }, 5000);
    return () => window.clearInterval(id);
  }, [generating, isOnline]);

  // Start at /clips/:id once.
  useEffect(() => {
    if (positioned.current || !clips?.length || !feedRef.current) return;
    const at = startId ? clips.findIndex((c) => c.id === startId) : -1;
    if (at < 0 && startId && !loaded) return; // not on the device yet: wait for the server's feed
    positioned.current = true;
    if (at > 0) {
      feedRef.current.scrollTo({ top: at * feedRef.current.clientHeight });
      setActive(at);
    }
  }, [clips, startId, loaded]);

  const current = clips?.[active] ?? null;

  // A clip coming on screen: a view; the one before, left early: a skip. Prefetch the next one.
  const lastActive = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!current || current.status !== 'ready' || !current.spec) return;
    const prev = lastActive.current;
    if (prev && prev.id !== current.id && !completed.current.has(prev.id) && Date.now() - prev.at < 4000) {
      void recordClipEvent(prev.id, 'skip');
    }
    lastActive.current = { id: current.id, at: Date.now() };
    if (!viewed.current.has(current.id)) {
      viewed.current.add(current.id);
      void recordClipEvent(current.id, 'view');
      track('clips.view', { clip: current.id, position: active + 1, theme: current.spec.style.theme, muted: prefs.muted });
    }
    const next = clips?.slice(active + 1).find((c) => c.status === 'ready');
    if (next) void prefetchClip(next);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The music bed (docs/CLIPS.md "Music"): the clip's lo-fi loop while it plays with sound and
  // music on, ducked under every voice line.
  const musicTrack = clipMusicFor(current?.spec?.style.theme);
  useEffect(() => {
    if (!music.current) {
      const el = new Audio();
      el.loop = true;
      el.volume = CLIP_MUSIC_VOLUME;
      music.current = el;
    }
    const el = music.current;
    if (!el.src.endsWith(musicTrack.path)) {
      el.src = musicTrack.path;
      el.currentTime = 0;
    }
    if (clipMusicShouldPlay({ playing, muted: prefs.muted, music: prefs.music })) el.play().catch(() => {});
    else el.pause();
  }, [playing, prefs.muted, prefs.music, musicTrack.path]);
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const el = music.current;
      if (el) el.volume = clipMusicStep(el.volume, clipMusicTarget({ speaking: speaking.current }), now - last);
      last = now;
    }, 50);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => music.current?.pause(), []);

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    if (idx !== active) setActive(idx);
  };

  const goTo = (idx: number, via?: 'button' | 'key' | 'end_card') => {
    const el = feedRef.current;
    if (!el || !clips) return;
    const at = Math.max(0, Math.min(clips.length - 1, idx));
    if (at === active) return;
    if (via) track('clips.next', { clip: clips[active]?.id, via, dir: at > active ? 'next' : 'prev' });
    el.scrollTo({ top: at * el.clientHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetFor || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') {
        e.preventDefault();
        goTo(active + 1, 'key');
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') {
        e.preventDefault();
        goTo(active - 1, 'key');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const update = useCallback((clip: ClipRecord) => {
    setClips((prev) => (prev ? prev.map((c) => (c.id === clip.id ? clip : c)) : prev));
  }, []);

  const setPrefs = (p: ClipCaptionPrefs, toggled: ClipPrefToggle) => {
    setPrefsState(p);
    saveClipPrefs(p);
    track('clips.caption_toggle', { toggle: toggled, on: toggled === 'mute' ? p.muted : toggled === 'pinyin' ? p.pinyin : toggled === 'music' ? p.music : p.english });
  };

  const like = (clip: ClipRecord, via: 'button' | 'double_tap') => {
    const on = via === 'double_tap' ? true : !clip.state.liked;
    if (on === clip.state.liked) return;
    void recordClipEvent(clip.id, on ? 'like' : 'unlike');
    if (via === 'double_tap') void recordClipEvent(clip.id, 'double_tap');
    track('clips.like', { clip: clip.id, on, via });
    update({ ...clip, state: { ...clip.state, liked: on } });
  };

  const save = (clip: ClipRecord) => {
    const on = !clip.state.saved;
    void recordClipEvent(clip.id, on ? 'save' : 'unsave');
    track('clips.save', { clip: clip.id, on });
    update({ ...clip, state: { ...clip.state, saved: on } });
  };

  const learnMore = (clip: ClipRecord, via: LearnMoreVia) => {
    void recordClipEvent(clip.id, 'learn_more');
    track('clips.learn_more', { clip: clip.id, action: 'open', via });
    setSheetFor(clip.id);
  };

  const sheetClip = useMemo(() => clips?.find((c) => c.id === sheetFor) ?? null, [clips, sheetFor]);

  if (clips === null) {
    return (
      <div className="clips-page" data-testid="clips-page">
        <div className="clips-state"><div className="clips-spinner" aria-label="Loading clips" /></div>
      </div>
    );
  }

  return (
    <div className="clips-page" data-testid="clips-page">
      <div className="clips-topbar">
        <button type="button" className="clips-iconbtn" aria-label="Back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/more'))}>←</button>
        <span className="clips-badge">🎬 Clips · beta</span>
        <span className="spacer" />
        <button type="button" className="clips-iconbtn" aria-label="Make new clips" onClick={() => setMakeOpen(true)} data-testid="clips-make-open">＋</button>
      </div>

      {clips.length === 0 ? (
        <div className="clips-state" data-testid="clips-empty">
          <div style={{ fontSize: '3rem' }} aria-hidden="true">🎬</div>
          <h2>No clips yet</h2>
          <p>Short vertical clips about the words you’re learning — swipe, double-tap anything to dig deeper.</p>
          <MakeClips onMade={(made) => setClips((prev) => [...made, ...(prev ?? [])])} />
        </div>
      ) : (
        <div className="clips-feed" ref={feedRef} onScroll={onScroll} data-testid="clips-feed">
          {clips.map((clip, i) => (
            <section className="clips-item" key={clip.id} data-testid="clips-item" data-index={i} aria-label={clip.title ?? 'Clip'}>
              {Math.abs(i - active) > 1 ? null : clip.status === 'ready' && clip.spec ? (
                <ClipPlayer
                  clip={clip}
                  active={i === active}
                  prefs={prefs}
                  held={sheetFor === clip.id || makeOpen}
                  onPrefs={setPrefs}
                  onLike={(via) => like(clip, via)}
                  onSave={() => save(clip)}
                  onLearnMore={(via) => learnMore(clip, via)}
                  onComplete={(ms) => {
                    completed.current.add(clip.id);
                    void recordClipEvent(clip.id, 'complete');
                    track('clips.complete', { clip: clip.id, duration_ms: ms, scenes: clip.spec!.scenes.length });
                  }}
                  onInteract={(layout, result, waitedMs) => {
                    void recordClipEvent(clip.id, 'interact', clipInteractValue(result));
                    track('clips.interact', { clip: clip.id, layout, result, waited_ms: waitedMs });
                    if (layout === 'quiz' && result !== 'done') {
                      void recordClipEvent(clip.id, 'quiz', result === 'right' ? 1 : 0);
                      track('clips.quiz_answer', { clip: clip.id, right: result === 'right', timeout: result === 'skipped' });
                    }
                  }}
                  onExplore={(layout) => track('clips.explore', { clip: clip.id, layout })}
                  onNext={i < clips.length - 1 ? (via) => goTo(i + 1, via) : undefined}
                  onPlaying={(p) => i === active && setPlaying(p)}
                  onSpeaking={(on) => {
                    if (i === active) speaking.current = on;
                  }}
                  startScene={clip.id === startId ? startScene : 0}
                />
              ) : (
                <ClipPlaceholder
                  clip={clip}
                  onRetry={async () => {
                    try {
                      update((await retryClip(clip.id)).clip);
                    } catch {
                      /* stays failed */
                    }
                  }}
                  onDelete={async () => {
                    await deleteClip(clip.id).catch(() => undefined);
                    setClips((prev) => (prev ?? []).filter((c) => c.id !== clip.id));
                  }}
                />
              )}
            </section>
          ))}
        </div>
      )}

      {sheetClip?.spec && (
        <LearnMoreSheet
          clip={sheetClip}
          onClose={() => setSheetFor(null)}
          onClipUpdate={update}
          onMoreClips={(made) => {
            setClips((prev) => {
              const list = prev ?? [];
              const at = list.findIndex((c) => c.id === sheetClip.id);
              return [...list.slice(0, at + 1), ...made, ...list.slice(at + 1)];
            });
            for (const c of made) void cacheClip(c);
          }}
        />
      )}

      {makeOpen && (
        <div className="clip-sheet-scrim" onClick={() => setMakeOpen(false)}>
          <div className="clip-sheet" role="dialog" aria-modal="true" aria-label="Make new clips" onClick={(e) => e.stopPropagation()}>
            <h2>Make new clips</h2>
            <p className="clip-sheet-sub">Claude writes them around what you’re studying. About a minute.</p>
            <MakeClips
              onMade={(made) => {
                setMakeOpen(false);
                setClips((prev) => {
                  const list = prev ?? [];
                  return [...list.slice(0, active + 1), ...made, ...list.slice(active + 1)];
                });
              }}
            />
            <button type="button" className="btn btn-secondary clip-sheet-close" onClick={() => setMakeOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Keep the feed's order (it is playing) and take the server's fresh rows; new ones at the end. */
function mergeKeepingOrder(prev: ClipRecord[], fresh: ClipRecord[]): ClipRecord[] {
  const byId = new Map(fresh.map((c) => [c.id, c]));
  const kept = prev.filter((c) => byId.has(c.id)).map((c) => byId.get(c.id)!);
  const seen = new Set(kept.map((c) => c.id));
  return [...kept, ...fresh.filter((c) => !seen.has(c.id))];
}

function MakeClips({ onMade }: { onMade: (clips: ClipRecord[]) => void }) {
  const { isOnline } = useNetwork();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const { clips } = await generateClips({ ...(topic.trim() ? { topic: topic.trim() } : {}), count: 2 });
      onMade(clips);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t start them — try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="clips-make">
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic (optional) — e.g. 刚 vs 刚才, ordering coffee"
        aria-label="Topic"
        maxLength={120}
        data-testid="clips-topic"
      />
      <button type="button" className="clip-btn primary" onClick={() => void make()} disabled={busy || !isOnline} data-testid="clips-make">
        {busy ? 'Starting…' : isOnline ? '✨ Make 2 clips' : 'Needs a connection'}
      </button>
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
    </div>
  );
}

function ClipPlaceholder({ clip, onRetry, onDelete }: { clip: ClipRecord; onRetry: () => Promise<void>; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (clip.status === 'generating') {
    return (
      <div className="clips-state" data-testid="clip-generating">
        <div className="clips-spinner" aria-hidden="true" />
        <h2>{clip.topic ? `A clip about ${clip.topic}` : 'A new clip'}</h2>
        <p>{clip.progress ?? 'Being written…'} It appears here by itself.</p>
      </div>
    );
  }
  return (
    <div className="clips-state" data-testid="clip-failed">
      <div style={{ fontSize: '2.4rem' }} aria-hidden="true">⚠️</div>
      <h2>Couldn’t make this clip</h2>
      <p>{clip.error ?? 'Something went wrong.'}</p>
      <div className="clip-end-actions">
        <button type="button" className="clip-btn primary" disabled={busy} onClick={run(onRetry)}>↻ Try again</button>
        <button type="button" className="clip-btn" disabled={busy} onClick={run(onDelete)}>Delete</button>
      </div>
    </div>
  );
}
