/**
 * Reader page audio with a scrubbable waveform — built for listening drills.
 *
 * The clip is split into phrase-sized BLOCKS at its pauses
 * (services/readerAudioBlocks.ts → shared/reader/audioBlocks.ts), drawn as
 * subtle ticks on the waveform with the current block highlighted. The
 * restart point (the anchor circle) moves with the audio, block by block
 * (shared/reader/blockPlayback.ts):
 * - play starts from the anchor; as each block finishes, the anchor advances
 *   to the start of the block now playing;
 * - stop, play again = the block he was in — unless he stopped within the first
 *   second of a new block, then the PREVIOUS one (he missed it);
 * - tap a block to jump there, ⏮ / ⏭ step between blocks, drag anywhere for a
 *   free anchor (it wins until playback moves past its block).
 * With no pauses found (or an undecodable clip) there is one block and it
 * behaves like the old scrubber: play from the anchor, stop returns to it.
 *
 * Fully offline once the TTS blob is cached (it usually is — reader media is
 * prefetched); blocks are computed once per clip and cached in IndexedDB.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalReaderPage } from '../db/database';
import { getReaderPageTTS, readerTtsKey } from '../services/readerSync';
import { analyzeReaderClip, WAVE_BUCKETS, type ClipAnalysis } from '../services/readerAudioBlocks';
import { blockIndexAt, type AudioBlock } from '@shared/reader/audioBlocks';
import {
  activeBlockIndex,
  blockPlayback,
  INITIAL_BLOCK_PLAY_STATE,
  type BlockPlayEvent,
  type BlockPlayState,
} from '@shared/reader/blockPlayback';
import { track } from '../services/analytics';
import './ReaderAudioScrubber.css';

/** Pointer travel (px) that turns a tap on the waveform into a drag. */
const DRAG_SLOP = 6;

export function ReaderAudioScrubber({ page }: { page: Pick<LocalReaderPage, 'id' | 'content_chinese'> }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [analysis, setAnalysis] = useState<ClipAnalysis | null>(null);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const [play, setPlay] = useState<BlockPlayState>(INITIAL_BLOCK_PLAY_STATE);
  const [activeIdx, setActiveIdx] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const playRef = useRef(play);
  playRef.current = play;
  const dragRef = useRef<{ x: number; dragging: boolean } | null>(null);

  const durationMs = analysis?.durationMs || mediaDurationMs;
  // Until the clip is analysed (or when it can't be), the whole clip is one block
  const blocks: AudioBlock[] = useMemo(
    () => (analysis && analysis.blocks.length > 0 ? analysis.blocks : [{ startMs: 0, endMs: Math.max(1, durationMs) }]),
    [analysis, durationMs],
  );
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const multi = blocks.length > 1;

  const fractionOf = useCallback((ms: number) => {
    const d = durationRef.current;
    return d > 0 ? Math.min(1, Math.max(0, ms / d)) : 0;
  }, []);

  const movePlayhead = useCallback((ms: number) => {
    if (playheadRef.current) playheadRef.current.style.left = `${fractionOf(ms) * 100}%`;
  }, [fractionOf]);

  const positionMs = useCallback(() => Math.round((audioRef.current?.currentTime ?? 0) * 1000), []);

  /** Feed the state machine one event and carry out what it says. */
  const dispatch = useCallback((event: BlockPlayEvent) => {
    const { state, seekToMs } = blockPlayback(playRef.current, event, blocksRef.current);
    const audio = audioRef.current;
    if (seekToMs !== null && audio) audio.currentTime = seekToMs / 1000;
    const prev = playRef.current;
    playRef.current = state;
    if (state.anchorMs !== prev.anchorMs || state.manual !== prev.manual || state.playing !== prev.playing || state.crossedFromMs !== prev.crossedFromMs) {
      setPlay(state);
    }
    const pos = seekToMs ?? positionMs();
    setActiveIdx(activeBlockIndex(state, blocksRef.current, pos));
    if (!state.playing) movePlayhead(state.anchorMs);
    else if (seekToMs !== null) movePlayhead(seekToMs);
    return seekToMs;
  }, [movePlayhead, positionMs]);

  const stopRaf = useCallback(() => cancelAnimationFrame(rafRef.current), []);

  const startRaf = useCallback(() => {
    stopRaf();
    let lastIdx = -1;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        const pos = Math.round(audio.currentTime * 1000);
        movePlayhead(pos);
        const idx = blockIndexAt(blocksRef.current, pos);
        if (idx !== lastIdx) {
          lastIdx = idx;
          dispatch({ type: 'tick', posMs: pos });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [dispatch, movePlayhead, stopRaf]);

  // Swap in a (new) clip: rebuild the audio element, then analyse it (cache-first)
  const adoptBlob = useCallback((blob: Blob) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    audioRef.current?.pause();

    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration)) setMediaDurationMs(Math.round(audio.duration * 1000));
    };
    audio.onended = () => {
      stopRaf();
      dispatch({ type: 'ended' });
    };
    audio.onerror = () => {
      stopRaf();
      if (playRef.current.playing) dispatch({ type: 'pause', posMs: 0 });
    };
    audioRef.current = audio;
    setStatus('ready');
    void analyzeReaderClip(readerTtsKey(page), blob).then(setAnalysis);
  }, [dispatch, page, stopRaf]);

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

  // Park the playhead on the anchor whenever the clip's length becomes known
  useEffect(() => {
    if (!playRef.current.playing) movePlayhead(playRef.current.anchorMs);
  }, [durationMs, movePlayhead]);

  // Draw the waveform (blocks: highlight + ticks); redraw on resize (fold/unfold)
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

      const peaks = analysis?.peaks ?? null;
      const d = durationMs;
      const active = multi && d > 0 ? blocks[activeIdx] : null;
      if (active) {
        // The current block: a soft band behind its bars
        const x0 = (active.startMs / d) * width;
        const x1 = (active.endMs / d) * width;
        ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
        ctx.beginPath();
        ctx.roundRect?.(x0, 0, Math.max(2, x1 - x0), height, 6);
        if (!ctx.roundRect) ctx.rect(x0, 0, Math.max(2, x1 - x0), height);
        ctx.fill();
      }

      const bars = peaks ?? Array.from({ length: WAVE_BUCKETS }, () => 0.35);
      const gap = 1;
      const barWidth = width / bars.length - gap;
      for (let i = 0; i < bars.length; i++) {
        const h = Math.max(2, bars[i] * (height - 6));
        const x = i * (barWidth + gap);
        const mid = ((i + 0.5) / bars.length) * d;
        const inActive = active && mid >= active.startMs && mid < active.endMs;
        ctx.fillStyle = !peaks ? '#e2e8f0' : inActive ? '#60a5fa' : '#94a3b8';
        ctx.fillRect(x, (height - h) / 2, barWidth, h);
      }

      if (multi && d > 0) {
        // Block boundaries: short ticks at the top and bottom edges
        ctx.fillStyle = '#64748b';
        for (let i = 1; i < blocks.length; i++) {
          const x = Math.round((blocks[i].startMs / d) * width);
          ctx.fillRect(x - 0.75, 0, 1.5, 7);
          ctx.fillRect(x - 0.75, height - 7, 1.5, 7);
        }
      }
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [analysis, blocks, activeIdx, durationMs, multi, status]);

  const msAt = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(fraction * durationRef.current);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, dragging: false };
  }, [status]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (status !== 'ready' || !drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (!drag.dragging && Math.abs(e.clientX - drag.x) < DRAG_SLOP) return;
    drag.dragging = true;
    // Dragging places a free anchor (seeks live while playing)
    dispatch({ type: 'place', ms: msAt(e.clientX) });
  }, [status, dispatch, msAt]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (status !== 'ready' || !drag || drag.dragging) return;
    const ms = msAt(e.clientX);
    // A tap: jump to the tapped block (one block = a free anchor, as before)
    if (blocksRef.current.length > 1) {
      track('reader.audio_block', { action: 'jump' });
      dispatch({ type: 'jump', index: blockIndexAt(blocksRef.current, ms) });
    } else dispatch({ type: 'place', ms });
  }, [status, dispatch, msAt]);

  const start = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const from = playRef.current.anchorMs;
    audio.currentTime = from / 1000;
    try {
      await audio.play();
      dispatch({ type: 'play' });
      startRaf();
    } catch {
      // Autoplay refused / decode error: stay stopped
    }
  }, [dispatch, startRaf]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    const pos = positionMs();
    audio?.pause();
    stopRaf();
    if (playRef.current.playing) dispatch({ type: 'pause', posMs: pos });
  }, [dispatch, stopRaf, positionMs]);

  const step = useCallback((dir: -1 | 1) => {
    if (status !== 'ready') return;
    track('reader.audio_block', { action: dir < 0 ? 'step_back' : 'step_forward' });
    dispatch({ type: 'step', dir, posMs: positionMs() });
  }, [status, dispatch, positionMs]);

  // Escape hatch for a bad cached clip (glitchy audio, or the Google fallback
  // voice from a MiniMax outage): regenerate, overwrite the cache, re-analyse.
  const regenerate = useCallback(async () => {
    if (isRegenerating || !navigator.onLine) return;
    setIsRegenerating(true);
    stop();
    const blob = await getReaderPageTTS(page, { regenerate: true }).catch(() => null);
    setIsRegenerating(false);
    if (!blob) return;
    playRef.current = INITIAL_BLOCK_PLAY_STATE;
    setPlay(INITIAL_BLOCK_PLAY_STATE);
    setActiveIdx(0);
    setAnalysis(null);
    movePlayhead(0);
    adoptBlob(blob);
  }, [isRegenerating, page, stop, adoptBlob, movePlayhead]);

  const ready = status === 'ready';
  const current = Math.min(activeIdx, blocks.length - 1);

  return (
    <div className="reader-audio-scrubber-wrap">
      {/* Play sits on the RIGHT — that's the thumb side (Jerome's preference,
          same as the pre-scrubber layout); the rarely-used regen goes left. */}
      <div className="reader-audio-scrubber">
        <button
          className={`reader-audio-regen-btn ${isRegenerating ? 'busy' : ''}`}
          onClick={regenerate}
          disabled={isRegenerating}
          aria-label="Regenerate audio"
          title="Regenerate audio"
        >
          ↻
        </button>
        <div
          className={`reader-audio-track ${ready ? '' : 'disabled'}`}
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; }}
          data-blocks={blocks.length}
        >
          <canvas ref={canvasRef} className="reader-audio-wave" />
          {ready && (
            <>
              <div className="reader-audio-playhead" ref={playheadRef} />
              <div className="reader-audio-anchor" style={{ left: `${fractionOf(play.anchorMs) * 100}%` }} />
            </>
          )}
          {status === 'unavailable' && (
            <div className="reader-audio-track-note">audio unavailable offline</div>
          )}
        </div>
        <button
          className="reader-audio-btn"
          onClick={play.playing ? stop : start}
          disabled={!ready}
          aria-label={play.playing ? 'Stop audio' : 'Play audio from the selected point'}
        >
          {play.playing ? '⏹' : '🔊'}
        </button>
      </div>
      {ready && multi && (
        <div className="reader-audio-blocks-row">
          <button className="reader-audio-step-btn" onClick={() => step(-1)} aria-label="Previous phrase">
            ⏮
          </button>
          <span className="reader-audio-block-label" aria-live="polite">
            Phrase {current + 1} of {blocks.length}
          </span>
          <button className="reader-audio-step-btn" onClick={() => step(1)} aria-label="Next phrase">
            ⏭
          </button>
        </div>
      )}
    </div>
  );
}
