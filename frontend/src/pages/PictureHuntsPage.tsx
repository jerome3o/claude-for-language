import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNetwork } from '../contexts/NetworkContext';
import { createPictureHunt, retryPictureHunt, uploadPictureHunt } from '../api/pictureHunts';
import type { LocalPictureHunt } from '../db/database';
import {
  deleteHuntEverywhere, getHuntImage, getLocalHunts, preparePhoto, refreshPictureHunts, storeHuntList,
} from '../services/pictureHunts';
import { track, trackError } from '../services/analytics';
import './PictureHuntPage.css';

/** Starter scenes — one tap instead of thinking one up. */
const SCENE_IDEAS: Array<{ zh: string; en: string }> = [
  { zh: '热闹的厨房', en: 'a busy home kitchen' },
  { zh: '街边市场', en: 'a street food market in China' },
  { zh: '教室', en: 'a classroom' },
  { zh: '公园野餐', en: 'a picnic in the park' },
  { zh: '超市', en: 'a supermarket aisle' },
  { zh: '卧室', en: 'a messy bedroom' },
  { zh: '火车站', en: 'a train station platform' },
];

type Mode = 'generate' | 'upload';

function Thumb({ hunt }: { hunt: LocalPictureHunt }) {
  const [url, setUrl] = useState<string | null>(null);
  const ready = hunt.status === 'ready' || hunt.source === 'upload';
  useEffect(() => {
    if (!ready) return;
    let revoke: string | null = null;
    let cancelled = false;
    void getHuntImage(hunt.id).then((blob) => {
      if (!blob || cancelled) return;
      revoke = URL.createObjectURL(blob);
      setUrl(revoke);
    });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [hunt.id, ready, hunt.updated_at]);
  return (
    <div className="ph-thumb" aria-hidden>
      {url ? <img src={url} alt="" /> : <span>{hunt.status === 'generating' ? '🎨' : hunt.status === 'error' ? '⚠️' : '🖼️'}</span>}
    </div>
  );
}

export function statusLine(hunt: LocalPictureHunt): string {
  if (hunt.status === 'generating') return `Building… ${hunt.progress ?? 'queued'}`;
  if (hunt.status === 'error') return hunt.error || 'Couldn\'t build this one';
  const best = hunt.best_found != null ? ` · best ${hunt.best_found} / ${hunt.object_count}` : ' · not played yet';
  return `${hunt.object_count} objects${best}`;
}

export function PictureHuntsPage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [hunts, setHunts] = useState<LocalPictureHunt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>('generate');
  const [prompt, setPrompt] = useState('');
  const [useWords, setUseWords] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reloadLocal = useCallback(async () => {
    setHunts(await getLocalHunts());
    setLoaded(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      setHunts(await refreshPictureHunts());
    } catch (err) {
      console.warn('[PictureHunts] refresh failed', err);
    }
  }, []);

  useEffect(() => {
    void reloadLocal().then(refresh);
  }, [reloadLocal, refresh]);

  // Hunts are built in the background; keep the list moving while any are.
  const building = hunts.some((h) => h.status === 'generating');
  useEffect(() => {
    if (!building || !isOnline) return;
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [building, isOnline, refresh]);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const { hunt } = mode === 'generate'
        ? await createPictureHunt({ prompt: prompt.trim(), use_learning_words: useWords })
        : await uploadPictureHunt(await preparePhoto(photo!), caption);
      track('picture_hunt.create', { source: mode === 'generate' ? 'generated' : 'upload' });
      await storeHuntList([hunt, ...hunts.filter((h) => h.id !== hunt.id)]);
      setPrompt('');
      setPhoto(null);
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      await reloadLocal();
    } catch (err) {
      trackError('picture_hunt_create', err);
      setError(err instanceof Error ? err.message : 'Couldn\'t start it — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    try {
      await retryPictureHunt(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    }
  }

  async function remove(hunt: LocalPictureHunt) {
    if (!confirm(`Delete "${hunt.title}"?`)) return;
    try {
      await deleteHuntEverywhere(hunt.id);
      await reloadLocal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const canStart = isOnline && !busy && (mode === 'generate' ? prompt.trim().length > 0 : !!photo);

  return (
    <div className="container ph-page">
      <h1 className="ph-title">🔎 Picture hunt <span className="ph-title-zh">看图找词</span></h1>
      <p className="ph-blurb">
        Pick a picture — make one or use your own photo. Claude finds the things in it; you type what you
        see in Chinese, and each right answer lights up on the picture.
      </p>

      <div className="ph-new-card">
        <div className="ph-mode" role="tablist" aria-label="Where the picture comes from">
          <button role="tab" aria-selected={mode === 'generate'} className={mode === 'generate' ? 'active' : ''} onClick={() => setMode('generate')}>✨ Make a picture</button>
          <button role="tab" aria-selected={mode === 'upload'} className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>📷 Use a photo</button>
        </div>

        {mode === 'generate' ? (
          <>
            <label className="form-label" htmlFor="ph-prompt">What should be in the picture?</label>
            <input
              id="ph-prompt"
              className="form-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. a busy kitchen"
              maxLength={300}
            />
            <div className="ph-chips">
              {SCENE_IDEAS.map((idea) => (
                <button key={idea.zh} type="button" className="ph-chip" onClick={() => setPrompt(idea.en)}>{idea.zh}</button>
              ))}
            </div>
            <label className="ph-toggle">
              <input type="checkbox" checked={useWords} onChange={(e) => setUseWords(e.target.checked)} />
              Lean toward words I'm learning
            </label>
          </>
        ) : (
          <>
            <label className="ph-file">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
              <span>{photo ? `📷 ${photo.name}` : 'Choose a photo or take one'}</span>
            </label>
            <label className="form-label" htmlFor="ph-caption">Caption (optional)</label>
            <input id="ph-caption" className="form-input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. My desk" maxLength={120} />
            <p className="ph-fine">Resized on your phone and sent without location data.</p>
          </>
        )}

        <button className="btn ph-start" onClick={() => void start()} disabled={!canStart}>
          {busy ? 'Sending…' : mode === 'generate' ? '✨ Make the picture' : '🔎 Find the objects'}
        </button>
        {!isOnline && <div className="ph-note">You're offline — making a new hunt needs a connection. Hunts you've built still play.</div>}
        {error && <div className="ph-error" role="alert">{error}</div>}
      </div>

      {!loaded ? (
        <div className="ph-empty">Loading…</div>
      ) : hunts.length === 0 ? (
        <div className="ph-empty">No hunts yet — make your first picture above.</div>
      ) : (
        <ul className="ph-list">
          {hunts.map((hunt) => (
            <li key={hunt.id} className={`ph-row ph-row-${hunt.status}`}>
              <button
                className="ph-row-main"
                onClick={() => hunt.status === 'ready' && navigate(`/picture-hunt/${hunt.id}`)}
                disabled={hunt.status !== 'ready'}
                aria-label={hunt.status === 'ready' ? `Play ${hunt.title}` : hunt.title}
              >
                <Thumb hunt={hunt} />
                <span className="ph-row-text">
                  <span className="ph-row-title">{hunt.title}</span>
                  <span className="ph-row-sub">{statusLine(hunt)}</span>
                </span>
              </button>
              {hunt.status === 'error' && (
                <button className="btn btn-primary btn-sm" onClick={() => void retry(hunt.id)} disabled={!isOnline}>🔄 Retry</button>
              )}
              {hunt.status === 'ready' && (
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/picture-hunt/${hunt.id}`)}>{hunt.play_count ? 'Again' : 'Play'}</button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => void remove(hunt)} disabled={!isOnline} aria-label="Delete hunt">🗑️</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
