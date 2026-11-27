/**
 * 📺 Watch — the E2E / screenshot stand-in for YouTube's player (dev builds only, docs/WATCH.md):
 * the same WatchPlayer interface over a clock, drawing a self-made colour clip on a canvas. Never a
 * real video frame.
 */
import type { WatchPlayer, WatchPlayerEvents } from './player';

export function createStandInPlayer(container: HTMLElement, durationMs: number, startMs: number, events: WatchPlayerEvents): WatchPlayer {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.dataset.testid = 'watch-stand-in';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let base = Math.min(Math.max(0, startMs), durationMs);
  let since = 0;
  let playing = false;
  let rate = 1;
  let raf = 0;
  let destroyed = false;

  const now = () => (playing ? Math.min(durationMs, base + (performance.now() - since) * rate) : base);
  const setPlaying = (p: boolean) => {
    if (p === playing) return;
    base = now();
    since = performance.now();
    playing = p;
    events.onPlayingChange(p);
  };
  const clock = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const draw = () => {
    if (destroyed) return;
    const t = now();
    if (playing && t >= durationMs) setPlaying(false);
    if (ctx) {
      const hue = (t / 100) % 360;
      const g = ctx.createLinearGradient(0, 0, 640, 360);
      g.addColorStop(0, `hsl(${hue}, 45%, 28%)`);
      g.addColorStop(1, `hsl(${(hue + 60) % 360}, 50%, 16%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 5; i++) {
        const x = ((t / 20 + i * 140) % 760) - 60;
        ctx.beginPath();
        ctx.arc(x, 90 + i * 45, 34 + i * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Stand-in video', 320, 170);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`${clock(t)} / ${clock(durationMs)}${playing ? '' : '  ❚❚'}`, 320, 206);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  window.setTimeout(() => !destroyed && events.onReady({ durationMs, title: 'Stand-in video' }), 50);
  canvas.addEventListener('click', () => setPlaying(!playing));

  return {
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    seekTo: (ms) => {
      base = Math.min(Math.max(0, ms), durationMs);
      since = performance.now();
    },
    setRate: (r) => {
      base = now();
      since = performance.now();
      rate = r;
    },
    currentMs: () => Math.round(now()),
    durationMs: () => durationMs,
    isPlaying: () => playing,
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
