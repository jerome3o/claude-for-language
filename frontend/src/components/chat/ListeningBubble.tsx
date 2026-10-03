/**
 * A hidden message in listening mode (docs/CHAT.md "Listening mode"): 🎧, the
 * bars, the length and "Tap to listen · hold to reveal" in place of the text.
 * The bubble around it (and its tap / long-press) belongs to ChatPage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { estimateSpeechSeconds, formatListeningDuration, listeningBars } from '@shared/chats/listening';
import { getMessageClip, loadSlowPlayback, saveSlowPlayback, type ClipMessage } from '../../services/chatListening';

export const SLOW_RATE = 0.75;

export interface ListeningBubbleProps {
  messageId: string;
  text: string;
  playing: boolean;
  loading: boolean;
  /** 0..1 while playing. */
  progress: number;
  durationSec: number | null;
  slow: boolean;
  onToggleSlow: () => void;
}

export function ListeningBubble({ messageId, text, playing, loading, progress, durationSec, slow, onToggleSlow }: ListeningBubbleProps) {
  const bars = listeningBars(messageId);
  const played = Math.round(progress * bars.length);
  const length = durationSec ? formatListeningDuration(durationSec) : `~${formatListeningDuration(estimateSpeechSeconds(text))}`;
  return (
    <div className={`chat-listening${playing ? ' playing' : ''}${loading ? ' loading' : ''}`} data-testid="chat-listening-bubble">
      <div className="chat-listening-row">
        <span className="chat-listening-icon" aria-hidden="true">
          {loading ? <span className="chat-spinner" /> : playing ? '■' : '🎧'}
        </span>
        <span className="chat-listening-bars" aria-hidden="true">
          {bars.map((h, i) => (
            <span key={i} className={`chat-listening-bar${i < played ? ' done' : ''}`} style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${(i % 6) * 70}ms` }} />
          ))}
        </span>
        <span className="chat-listening-length">{length}</span>
        <button
          type="button"
          className={`chat-listening-speed${slow ? ' on' : ''}`}
          aria-pressed={slow}
          aria-label={slow ? 'Normal speed' : 'Slow playback'}
          data-testid="chat-listening-speed"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSlow();
          }}
        >
          0.75×
        </button>
      </div>
      <span className="chat-listening-hint">{playing ? 'Playing… tap to replay' : 'Tap to listen · hold to reveal'}</span>
    </div>
  );
}

export interface ListeningPlayer {
  playingId: string | null;
  loadingId: string | null;
  progress: number;
  durations: Record<string, number>;
  slow: boolean;
  error: string | null;
  play: (msg: ClipMessage) => void;
  stop: () => void;
  toggleSlow: () => void;
}

/** One player for the hidden bubbles of a chat: tap = play from the start (again), cache-first, slow 0.75× remembered. */
export function useListeningPlayer(onError?: (message: string) => void): ListeningPlayer {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [slow, setSlow] = useState(loadSlowPlayback);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const token = useRef(0);
  const slowRef = useRef(slow);
  slowRef.current = slow;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const release = useCallback(() => {
    if (audio.current) {
      audio.current.onended = null;
      audio.current.ontimeupdate = null;
      audio.current.pause();
      audio.current = null;
    }
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    token.current++;
    release();
    setPlayingId(null);
    setLoadingId(null);
    setProgress(0);
  }, [release]);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    (msg: ClipMessage) => {
      const mine = ++token.current;
      release();
      setPlayingId(null);
      setProgress(0);
      setError(null);
      setLoadingId(msg.id);
      void (async () => {
        let blob: Blob | null = null;
        try {
          blob = await getMessageClip(msg);
        } catch (err) {
          if (mine !== token.current) return;
          setLoadingId(null);
          const message = err instanceof Error && err.message ? err.message : "Couldn't play that message.";
          setError(message);
          onErrorRef.current?.("Couldn't play that message.");
          return;
        }
        if (mine !== token.current) return;
        setLoadingId(null);
        if (!blob) {
          setError('Audio not downloaded yet');
          onErrorRef.current?.('Audio not downloaded yet — connect to the internet to listen.');
          return;
        }
        const src = URL.createObjectURL(blob);
        url.current = src;
        const a = new Audio(src);
        audio.current = a;
        a.playbackRate = slowRef.current ? SLOW_RATE : 1;
        a.onloadedmetadata = () => {
          if (Number.isFinite(a.duration) && a.duration > 0) setDurations((d) => ({ ...d, [msg.id]: a.duration }));
        };
        a.ontimeupdate = () => {
          if (a.duration > 0) setProgress(Math.min(1, a.currentTime / a.duration));
        };
        a.onended = () => {
          if (mine !== token.current) return;
          setPlayingId(null);
          setProgress(0);
        };
        setPlayingId(msg.id);
        a.play().catch(() => {
          if (mine !== token.current) return;
          setPlayingId(null);
        });
      })();
    },
    [release],
  );

  const toggleSlow = useCallback(() => {
    setSlow((v) => {
      const next = !v;
      saveSlowPlayback(next);
      if (audio.current) audio.current.playbackRate = next ? SLOW_RATE : 1;
      return next;
    });
  }, []);

  return { playingId, loadingId, progress, durations, slow, error, play, stop, toggleSlow };
}
