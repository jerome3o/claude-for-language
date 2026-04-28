import { useCallback, useRef, useState } from 'react';
import { generatePracticeTTS } from '../api/client';
import { useTTS } from './useAudio';

const cache = new Map<string, Promise<string>>();

function fetchTTS(text: string): Promise<string> {
  let p = cache.get(text);
  if (!p) {
    p = generatePracticeTTS(text)
      .then((r) => `data:${r.content_type};base64,${r.audio_base64}`)
      .catch((e) => {
        cache.delete(text);
        throw e;
      });
    cache.set(text, p);
  }
  return p;
}

export function usePracticeTTS() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playIdRef = useRef(0);
  const { speak: browserSpeak, stop: browserStop } = useTTS();

  const stop = useCallback(() => {
    playIdRef.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    browserStop();
    setIsPlaying(false);
  }, [browserStop]);

  const speak = useCallback(
    (text: string) => {
      stop();
      const id = playIdRef.current;
      fetchTTS(text)
        .then((url) => {
          if (playIdRef.current !== id) return;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onplay = () => playIdRef.current === id && setIsPlaying(true);
          audio.onended = () => playIdRef.current === id && setIsPlaying(false);
          audio.onerror = () => {
            if (playIdRef.current !== id) return;
            setIsPlaying(false);
            browserSpeak(text);
          };
          void audio.play().catch(() => playIdRef.current === id && browserSpeak(text));
        })
        .catch(() => playIdRef.current === id && browserSpeak(text));
    },
    [browserSpeak, stop],
  );

  const prefetch = useCallback((texts: string[]) => {
    for (const t of texts) if (t) void fetchTTS(t).catch(() => {});
  }, []);

  return { speak, stop, prefetch, isPlaying };
}
