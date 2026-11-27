import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  WATCH_SHOWS,
  parseYouTubeVideoId,
  watchClock,
  watchIsWorking,
  watchStatusLine,
  watchedFraction,
  youtubeSearchUrl,
  youtubeThumbnailUrl,
  type WatchVideoSummary,
} from '@shared/watch';
import { useNetwork } from '../contexts/NetworkContext';
import { removeWatchVideo, retryWatchVideo } from '../api/watch';
import { cachedWatchList, flushPositions, forgetWatchVideo, refreshWatchList, withLocalPositions } from '../services/watch';
import './WatchPage.css';

function VideoRow({ v, onRetry, onRemove }: { v: WatchVideoSummary; onRetry: () => void; onRemove: () => void }) {
  const fraction = watchedFraction(v.position_ms, v.duration_ms);
  const working = watchIsWorking(v.status);
  return (
    <li className="watch-row" data-testid="watch-row">
      <Link to={`/watch/${v.id}`} className="watch-row-main" aria-label={`Watch ${v.title}`}>
        <span className="watch-thumb">
          <img src={youtubeThumbnailUrl(v.id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
          {v.duration_ms ? <span className="watch-thumb-len">{watchClock(v.duration_ms)}</span> : null}
          {fraction > 0 && (
            <span className="watch-thumb-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(fraction * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="watch-row-text">
          <span className="watch-row-title" lang="zh-CN">{v.title}</span>
          {v.channel && <span className="watch-row-channel">{v.channel}</span>}
          <span className={`watch-row-status watch-status-${v.status}`}>
            {working && <span className="watch-spinner" aria-hidden="true" />}
            {watchStatusLine(v)}
          </span>
        </span>
      </Link>
      <span className="watch-row-actions">
        {v.status === 'failed' && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" className="watch-row-remove" aria-label={`Remove ${v.title} from my videos`} onClick={onRemove}>
          ✕
        </button>
      </span>
    </li>
  );
}

/** `/watch` — 📺 Watch (追剧): add a YouTube video, find the shows, my videos. */
export function WatchPage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [videos, setVideos] = useState<WatchVideoSummary[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await cachedWatchList();
      if (cached && alive) {
        const withPos = await withLocalPositions(cached);
        setVideos(withPos.videos);
        setAvailable(withPos.available);
      }
      if (!navigator.onLine) {
        if (alive && !cached) setVideos([]);
        return;
      }
      await flushPositions();
      try {
        const fresh = await refreshWatchList();
        if (!alive) return;
        setVideos(fresh.videos);
        setAvailable(fresh.available);
      } catch (err) {
        if (!alive) return;
        if (!cached) setVideos([]);
        setLoadError(err instanceof Error ? err.message : 'Could not load your videos');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Keep the statuses moving while a transcript is being made.
  const working = (videos ?? []).some((v) => watchIsWorking(v.status));
  useEffect(() => {
    if (!working || !isOnline) return;
    const t = window.setInterval(() => {
      void refreshWatchList()
        .then((l) => setVideos(l.videos))
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(t);
  }, [working, isOnline]);

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeVideoId(link);
    if (!id) {
      setProblem("That doesn't look like a YouTube video link — copy it from YouTube's Share button (youtu.be/… or youtube.com/watch?v=…).");
      return;
    }
    setProblem(null);
    navigate(`/watch/${id}?source=paste`);
  };

  const retry = async (id: string) => {
    try {
      const { video } = await retryWatchVideo(id);
      setVideos((vs) => (vs ?? []).map((v) => (v.id === id ? { ...v, ...video } : v)));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not retry');
    }
  };

  const remove = async (id: string) => {
    setVideos((vs) => (vs ?? []).filter((v) => v.id !== id));
    await forgetWatchVideo(id);
    if (navigator.onLine) await removeWatchVideo(id).catch(() => undefined);
  };

  return (
    <div className="watch-page">
      <h1 className="watch-title">📺 Watch <span lang="zh-CN">追剧</span></h1>
      <p className="watch-blurb">
        Chinese TV on YouTube, line by line: replay a line, slow it down, pause after each one, and tap any word to look it up or add it to
        your study.
      </p>

      <form className="watch-add" onSubmit={open}>
        <label htmlFor="watch-link" className="watch-add-label">
          Paste a YouTube link
        </label>
        <div className="watch-add-row">
          <input
            id="watch-link"
            className="form-input"
            inputMode="url"
            autoComplete="off"
            placeholder="https://youtu.be/…"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setProblem(null);
            }}
            data-testid="watch-link"
          />
          <button type="submit" className="btn btn-primary" disabled={!link.trim() || !isOnline}>
            Watch
          </button>
        </div>
        {problem && (
          <p className="watch-problem" role="alert">
            {problem}
          </p>
        )}
        {!isOnline && <p className="watch-note">Adding a video needs a connection. Your videos' transcripts are on this device.</p>}
        {isOnline && !available && <p className="watch-note">Transcripts aren't set up on the server yet — videos play without one.</p>}
        <p className="watch-note">Tip: in the YouTube app, Share → this app adds the video straight away (installed app on Android).</p>
      </form>

      {loadError && <p className="watch-problem">{loadError}</p>}

      <h2 className="watch-h2">My videos</h2>
      {videos === null ? (
        <p className="watch-note">Loading…</p>
      ) : videos.length === 0 ? (
        <p className="watch-empty">No videos yet — paste a link above, or find an episode below.</p>
      ) : (
        <ul className="watch-list">
          {videos.map((v) => (
            <VideoRow key={v.id} v={v} onRetry={() => void retry(v.id)} onRemove={() => void remove(v.id)} />
          ))}
        </ul>
      )}

      <h2 className="watch-h2">Find on YouTube</h2>
      <ul className="watch-shows">
        {WATCH_SHOWS.map((s) => (
          <li key={s.title}>
            <a
              className="watch-show"
              href={youtubeSearchUrl(s.query)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="watch-show-title">
                <span lang="zh-CN">{s.title}</span> <span className="watch-show-en">{s.english} · {s.year}</span>
              </span>
              <span className="watch-show-note">{s.note}</span>
              <span className="watch-show-go" aria-hidden="true">
                ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="watch-note">Open an episode on YouTube, tap Share → Copy link, and paste it above.</p>
    </div>
  );
}
