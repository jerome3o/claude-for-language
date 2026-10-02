import { useEffect, useRef, useState } from 'react';
import { useChatMedia } from '../../services/chatMedia';
import { formatDuration } from '../../services/chatThread';
import { ChatWordsText, type TappedWord } from './ChatWords';
import type { ChatWord } from '../../types';

/** Only one voice message plays at a time across the page. */
let current: HTMLAudioElement | null = null;

/**
 * A voice message: ▶ / ⏸, a progress bar you can tap to seek, the duration;
 * under it the transcript once the server has it ("Transcribing…" meanwhile)
 * as word chips, with pinyin / the translation when the message's 拼音 / EN
 * toggles (in the message's meta row, like a text message) are on.
 */
export function VoiceBubble({
  messageId,
  mediaUrl,
  durationMs,
  localBlob,
  transcriptStatus,
  transcript,
  translation,
  words = null,
  showPinyin = false,
  showTranslation = false,
  known,
  onTapWord,
  suppressTap,
}: {
  messageId: string;
  mediaUrl: string | null | undefined;
  durationMs: number;
  localBlob?: Blob | null;
  transcriptStatus?: 'pending' | 'done' | 'failed';
  transcript?: string | null;
  translation?: string | null;
  /** Word chips over the transcript (null until they arrive). */
  words?: ChatWord[] | null;
  showPinyin?: boolean;
  showTranslation?: boolean;
  known: Set<string>;
  onTapWord: (tapped: TappedWord) => void;
  suppressTap?: () => boolean;
}) {
  const { url, error, retry } = useChatMedia(messageId, mediaUrl, localBlob);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [wantPlay, setWantPlay] = useState(false);
  const total = Math.max(durationMs / 1000, 0.1);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        if (current === a) current = null;
      }
    };
  }, []);

  const audio = (): HTMLAudioElement | null => {
    if (!url) return null;
    if (!audioRef.current || audioRef.current.dataset.src !== url) {
      audioRef.current?.pause();
      const a = new Audio(url);
      a.dataset.src = url;
      a.preload = 'auto';
      a.ontimeupdate = () => setPosition(a.currentTime);
      a.onplay = () => setPlaying(true);
      a.onpause = () => setPlaying(false);
      a.onended = () => {
        setPlaying(false);
        setPosition(0);
      };
      audioRef.current = a;
    }
    return audioRef.current;
  };

  const play = () => {
    const a = audio();
    if (!a) {
      if (error) retry();
      setWantPlay(true);
      return;
    }
    if (current && current !== a) current.pause();
    current = a;
    a.play().catch(() => setPlaying(false));
  };

  // Tapped ▶ before the bytes arrived: start as soon as they do.
  useEffect(() => {
    if (wantPlay && url) {
      setWantPlay(false);
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlay, url]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playing) audioRef.current?.pause();
    else play();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const a = audio();
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total;
    a.currentTime = t;
    setPosition(t);
  };

  const progress = Math.min(1, position / total);
  const text = (transcript || '').trim();

  return (
    <div className="chat-voice" data-testid="chat-voice">
      <div className="chat-voice-player">
        <button
          type="button"
          className="chat-voice-play"
          onClick={toggle}
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        >
          {wantPlay && !url ? <span className="chat-spinner" aria-hidden="true" /> : playing ? '⏸' : '▶'}
        </button>
        <div
          className="chat-voice-track"
          onClick={seek}
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(position)}
        >
          <div className="chat-voice-fill" style={{ width: `${progress * 100}%` }} />
          <div className="chat-voice-knob" style={{ left: `${progress * 100}%` }} />
        </div>
        <span className="chat-voice-time">{formatDuration((playing || position > 0 ? position : total) * 1000)}</span>
      </div>
      {error && !url && <div className="chat-voice-note">Couldn't load the recording · tap ▶ to retry</div>}
      {transcriptStatus === 'pending' && (
        <div className="chat-voice-note chat-voice-transcribing">
          <span className="chat-spinner" aria-hidden="true" /> Transcribing…
        </div>
      )}
      {transcriptStatus === 'done' && text && (
        <div className="chat-voice-transcript">
          <div className="chat-voice-text">
            <ChatWordsText
              text={transcript || ''}
              words={words}
              showPinyin={showPinyin}
              known={known}
              onTapWord={onTapWord}
              suppressTap={suppressTap}
            />
          </div>
          {showTranslation && translation && <div className="chat-translation">{translation}</div>}
        </div>
      )}
    </div>
  );
}
