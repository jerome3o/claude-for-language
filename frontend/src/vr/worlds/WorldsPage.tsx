/**
 * 🥽 Worlds — /vr/worlds (docs/VR_WORLDS.md): the picker. One card per registered world (its meta:
 * thumbnail, 中文 + English title, blurb), this device's progress (tasks done x / y, best time), and
 * Enter VR (a WebXR headset browser) / Preview (the flat 3D view anywhere else). The world itself
 * loads only when you open it.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDuration } from '@shared/vr-worlds';
import { WORLDS } from './registry';
import { allProgress, type WorldProgress } from './progress';
import { detectXrSupport } from '../xrSupport';
import { track } from '../../services/analytics';
import './worlds.css';

export function WorldsPage() {
  const [progress, setProgress] = useState<Map<string, WorldProgress>>(new Map());
  const [immersive, setImmersive] = useState(false);
  useEffect(() => {
    let live = true;
    void allProgress().then((p) => {
      if (live) setProgress(p);
    });
    void detectXrSupport().then((s) => {
      if (live) setImmersive(s.status === 'immersive');
    });
    track('vr_world.picker', { worlds: WORLDS.length });
    return () => { live = false; };
  }, []);

  return (
    <div className="container vr-worlds" data-testid="vr-worlds-page">
      <p className="vr-worlds-back"><Link to="/vr">← 🥽 VR room</Link></p>
      <h1>🥽 Worlds <span lang="zh-CN">语言世界</span></h1>
      <p className="vr-worlds-intro">
        Step into a place and do what it asks — in Chinese: 把杯子放在桌子上。 Pick things up, throw them, open doors.
        Point at anything to hear its name, and add it as a card.
      </p>
      <div className="vr-worlds-grid">
        {WORLDS.map(({ meta }) => {
          const p = progress.get(meta.id);
          const done = p?.done.length ?? 0;
          return (
            <article key={meta.id} className="vr-world-card" data-testid="vr-world-card" data-world={meta.id}>
              <Link to={`/vr/worlds/${meta.id}`} className="vr-world-thumb" aria-label={`${meta.title_en} — preview`}>
                <span className="vr-world-emoji" aria-hidden>{meta.emoji}</span>
                <img src={meta.thumbnail} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              </Link>
              <div className="vr-world-body">
                <h2>
                  <span lang="zh-CN">{meta.title_zh}</span> <span className="vr-world-en">{meta.title_en}</span>
                </h2>
                <p className="vr-world-blurb">{meta.blurb}</p>
                <div className="vr-world-progress">
                  <div className="vr-world-bar" aria-hidden><span style={{ width: `${Math.round((done / Math.max(1, meta.taskCount)) * 100)}%` }} /></div>
                  <small>
                    {done} / {meta.taskCount} tasks{p?.best_ms != null ? ` · best ${formatDuration(p.best_ms)}` : ''} · {meta.objectCount} things to explore
                  </small>
                </div>
                <div className="vr-world-actions">
                  {immersive && <Link className="vr-world-btn primary" to={`/vr/worlds/${meta.id}?vr=1`}>Enter VR</Link>}
                  <Link className={`vr-world-btn${immersive ? '' : ' primary'}`} to={`/vr/worlds/${meta.id}`}>{immersive ? 'Preview' : '▶ Preview'}</Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className="vr-worlds-note">
        {immersive
          ? 'In the headset: point and pull the trigger to look at a thing, squeeze to pick it up, push the stick forward to teleport.'
          : 'This browser can’t open VR, so worlds open as a 3D preview: click a thing for its name, hold to pick it up, WASD to walk.'}
        {' '}Progress is kept on this device.
      </p>
    </div>
  );
}

export default WorldsPage;
