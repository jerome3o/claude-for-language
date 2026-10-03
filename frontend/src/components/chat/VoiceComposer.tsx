import { useEffect, useRef, useState } from 'react';
import { baseMime, pickRecorderMime } from '../../services/chatMedia';
import { formatDuration } from '../../services/chatThread';

const MAX_MS = 5 * 60 * 1000;

export type VoiceCommand = { action: 'send' | 'cancel'; seq: number };

/**
 * Recording a voice message (replaces the text box while open), Signal-style
 * (docs/CHAT.md "Round 2"): starts on mount. **Held** — the finger is on the
 * mic: a red dot, the timer and "‹ Slide to cancel" (following the finger,
 * `dragX`); the composer's mic sends `command`s (release = send, slide left =
 * cancel). **Locked** (slid up, or tapped open): 🗑 cancels, ⏹ stops to listen
 * back first, ➤ sends. Stops by itself at 5 minutes.
 */
export function VoiceComposer({
  onSend,
  onCancel,
  onError,
  mode = 'locked',
  command,
  dragX = 0,
}: {
  onSend: (blob: Blob, durationMs: number) => void;
  onCancel: () => void;
  onError: (text: string) => void;
  mode?: 'held' | 'locked';
  command?: VoiceCommand | null;
  /** How far the finger has slid left (px, ≤ 0) while held. */
  dragX?: number;
}) {
  const [phase, setPhase] = useState<'starting' | 'recording' | 'preview'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; ms: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const after = useRef<'send' | 'preview' | 'cancel'>('cancel');
  const audio = useRef<HTMLAudioElement | null>(null);
  const earlyStop = useRef(false);
  const callbacks = useRef({ onSend, onCancel, onError });
  callbacks.current = { onSend, onCancel, onError };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        callbacks.current.onError("This browser can't record audio.");
        callbacks.current.onCancel();
        return;
      }
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (err) {
        const name = (err as { name?: string }).name;
        callbacks.current.onError(
          name === 'NotAllowedError' ? 'Microphone blocked — allow it in the browser settings to send voice messages.' : "Couldn't start the microphone.",
        );
        callbacks.current.onCancel();
        return;
      }
      if (cancelled || earlyStop.current) {
        s.getTracks().forEach((t) => t.stop());
        // Released before the microphone was ready: too short to be a message.
        if (!cancelled) callbacks.current.onCancel();
        return;
      }
      stream.current = s;
      const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
      const rec = mime ? new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: 32000 }) : new MediaRecorder(s);
      recorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        const ms = Date.now() - startedAt.current;
        const type = baseMime(rec.mimeType || mime) || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        if (after.current === 'cancel' || blob.size === 0) return;
        if (after.current === 'send') {
          callbacks.current.onSend(blob, ms);
          return;
        }
        setPreview({ blob, url: URL.createObjectURL(blob), ms });
        setPhase('preview');
      };
      rec.start(250);
      startedAt.current = Date.now();
      setPhase('recording');
    })();
    return () => {
      cancelled = true;
      after.current = 'cancel';
      try {
        if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      } catch {
        /* ignore */
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      audio.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_MS) stop('preview');
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const stop = (next: 'send' | 'preview' | 'cancel') => {
    after.current = next;
    const rec = recorder.current;
    if (!rec) {
      earlyStop.current = true;
      if (next === 'cancel') callbacks.current.onCancel();
      return;
    }
    if (rec.state !== 'inactive') rec.stop();
    if (next === 'cancel') callbacks.current.onCancel();
  };

  // Commands from the held mic button (release = send, slide left = cancel).
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!command || command.seq === lastSeq.current) return;
    lastSeq.current = command.seq;
    stop(command.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const togglePreview = () => {
    if (!preview) return;
    if (!audio.current) {
      audio.current = new Audio(preview.url);
      audio.current.onended = () => setPlaying(false);
      audio.current.onpause = () => setPlaying(false);
      audio.current.onplay = () => setPlaying(true);
    }
    if (playing) audio.current.pause();
    else audio.current.play().catch(() => setPlaying(false));
  };

  if (mode === 'held') {
    const cancelling = dragX <= -60;
    return (
      <div className="chat-voice-composer held" data-testid="voice-composer" data-mode="held">
        <div className="chat-voice-recording" role="status">
          <span className="chat-rec-dot" aria-hidden="true" />
          <span className="chat-rec-time">{phase === 'starting' ? 'Starting…' : formatDuration(elapsed)}</span>
        </div>
        <span className={`chat-voice-slide${cancelling ? ' cancelling' : ''}`} style={{ transform: `translateX(${Math.max(-120, dragX)}px)` }}>
          ‹ Slide to cancel
        </span>
      </div>
    );
  }

  return (
    <div className="chat-voice-composer" data-testid="voice-composer" data-mode="locked">
      <button type="button" className="chat-round-btn chat-voice-cancel" onClick={() => stop('cancel')} aria-label="Discard recording">
        🗑
      </button>
      {phase === 'preview' && preview ? (
        <button type="button" className="chat-voice-preview" onClick={togglePreview} aria-label={playing ? 'Pause' : 'Listen back'}>
          <span aria-hidden="true">{playing ? '⏸' : '▶'}</span> {formatDuration(preview.ms)}
        </button>
      ) : (
        <div className="chat-voice-recording" role="status">
          <span className="chat-rec-dot" aria-hidden="true" />
          <span className="chat-rec-time">{phase === 'starting' ? 'Starting…' : formatDuration(elapsed)}</span>
          {phase === 'recording' && (
            <button type="button" className="chat-voice-stop" onClick={() => stop('preview')} aria-label="Stop and listen back">
              ⏹
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="chat-round-btn chat-voice-send"
        disabled={phase === 'starting'}
        onClick={() => {
          if (phase === 'preview' && preview) onSend(preview.blob, preview.ms);
          else stop('send');
        }}
        aria-label="Send voice message"
      >
        ➤
      </button>
    </div>
  );
}
