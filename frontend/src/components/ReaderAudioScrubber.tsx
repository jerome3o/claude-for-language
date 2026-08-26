/**
 * Reader page audio with a scrubbable waveform — built for listening drills.
 *
 * The clip's amplitude is drawn as a waveform, with a draggable anchor
 * circle. Play always starts FROM THE ANCHOR: tap or drag anywhere on the
 * waveform to place it (spotting words by their amplitude bumps), press play,
 * press stop, press play again — it restarts from that same spot until the
 * anchor is moved. Dragging while playing seeks live.
 *
 * Fully offline once the TTS blob is cached (it usually is — reader media is
 * prefetched); waveform decoding happens locally with WebAudio.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalReaderPage } from '../db/database';
import { getReaderPageTTS } from '../services/readerSync';

const WAVE_BUCKETS = 96;

/** Per-bucket peak amplitudes (0..1), for drawing the waveform. */
async function computePeaks(blob: Blob): Promise<number[] | null> {
  try {
    const AudioCtx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const data = decoded.getChannelData(0);
      const bucketSize = Math.max(1, Math.floor(data.length / WAVE_BUCKETS));
      const peaks: number[] = [];
      for (let b = 0; b < WAVE_BUCKETS; b++) {
        let peak = 0;
        const start = b * bucketSize;
        const end = Math.min(data.length, start + bucketSize);
        // Sample within the bucket (every 4th value is plenty for a peak)
        for (let i = start; i < end; i += 4) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
        peaks.push(peak);
      }
      const max = Math.max(0.01, ...peaks);
      return peaks.map(p => p / max);
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

export function ReaderAudioScrubber({ page }: { page: Pick<LocalReaderPage, 'id' | 'content_chinese'> }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  // Where play (re)starts from, as a fraction of the clip. Set by tapping or
  // dragging the waveform; deliberately NOT advanced by playback.
  const [anchor, setAnchor] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const anchorRef = useRef(0);
  anchorRef.current = anchor;

  const movePlayhead = useCallback((fraction: number) => {
    if (playheadRef.current) {
      playheadRef.current.style.left = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    }
  }, []);

  const stopRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  const startRaf = useCallback(() => {
    stopRaf();
    const tick = () => {
      const audio = audioRef.current;
      if (audio && audio.duration > 0) {
        movePlayhead(audio.currentTime / audio.duration);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [movePlayhead, stopRaf]);

  // Swap in a (new) clip: rebuild the audio element and the waveform
  const adoptBlob = useCallback((blob: Blob) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    audioRef.current?.pause();

    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.onended = () => {
      // Back to the anchor, ready to replay the same stretch
      setIsPlaying(false);
      stopRaf();
      movePlayhead(anchorRef.current);
    };
    audio.onerror = () => {
      setIsPlaying(false);
      stopRaf();
    };
    audioRef.current = audio;
    setStatus('ready');
    void computePeaks(blob).then(setPeaks);
  }, [movePlayhead, stopRaf]);

  // Load the clip on mount (cache-first; generates when online and uncached)
  useEffect(() => {
    let cancelled = false;
    getReaderPageTTS(page)
      .then(blob => {
        if (cancelled) return;
        if (blob) adoptBlob(blob);
        else setStatus('unavailable');
      })
      .catch(() => !cancelled && setStatus('unavailable'));
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // The component is keyed by page id — mount-only is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw the waveform whenever peaks land; redraw on resize (fold/unfold)
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0) return;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const bars = peaks ?? Array.from({ length: WAVE_BUCKETS }, () => 0.35);
      const gap = 1;
      const barWidth = width / bars.length - gap;
      ctx.fillStyle = peaks ? '#94a3b8' : '#e2e8f0';
      for (let i = 0; i < bars.length; i++) {
        const h = Math.max(2, bars[i] * (height - 6));
        const x = i * (barWidth + gap);
        ctx.fillRect(x, (height - h) / 2, barWidth, h);
      }
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [peaks, status]);

  const seekToFraction = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setAnchor(fraction);
    movePlayhead(fraction);
    const audio = audioRef.current;
    if (audio && isFinite(audio.duration) && !audio.paused) {
      audio.currentTime = fraction * audio.duration;
    }
  }, [movePlayhead]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToFraction(e.clientX);
  }, [status, seekToFraction]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready' || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekToFraction(e.clientX);
  }, [status, seekToFraction]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isFinite(audio.duration)) {
      audio.currentTime = anchorRef.current * audio.duration;
    }
    try {
      await audio.play();
      setIsPlaying(true);
      startRaf();
    } catch {
      setIsPlaying(false);
    }
  }, [startRaf]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
    stopRaf();
    // Play restarts from the anchor, so park the playhead back there
    movePlayhead(anchorRef.current);
  }, [movePlayhead, stopRaf]);

  // Escape hatch for a bad cached clip (glitchy audio, or the Google fallback
  // voice from a MiniMax outage): regenerate, overwrite the cache, replay.
  const regenerate = useCallback(async () => {
    if (isRegenerating || !navigator.onLine) return;
    setIsRegenerating(true);
    stop();
    const blob = await getReaderPageTTS(page, { regenerate: true }).catch(() => null);
    setIsRegenerating(false);
    if (!blob) return;
    setAnchor(0);
    movePlayhead(0);
    adoptBlob(blob);
  }, [isRegenerating, page, stop, adoptBlob, movePlayhead]);

  return (
    <div className="reader-audio-scrubber">
      <button
        className="reader-audio-btn"
        onClick={isPlaying ? stop : play}
        disabled={status !== 'ready'}
        aria-label={isPlaying ? 'Stop audio' : 'Play audio from the selected point'}
      >
        {isPlaying ? '⏹' : '🔊'}
      </button>
      <div
        className={`reader-audio-track ${status !== 'ready' ? 'disabled' : ''}`}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <canvas ref={canvasRef} className="reader-audio-wave" />
        {status === 'ready' && (
          <>
            <div className="reader-audio-playhead" ref={playheadRef} />
            <div className="reader-audio-anchor" style={{ left: `${anchor * 100}%` }} />
          </>
        )}
        {status === 'unavailable' && (
          <div className="reader-audio-track-note">audio unavailable offline</div>
        )}
      </div>
      <button
        className={`reader-audio-regen-btn ${isRegenerating ? 'busy' : ''}`}
        onClick={regenerate}
        disabled={isRegenerating}
        aria-label="Regenerate audio"
        title="Regenerate audio"
      >
        ↻
      </button>
    </div>
  );
}
