import { useState, useRef, useCallback, useEffect } from 'react';
import { getAudioWithCache, getCachedAudio, pickChineseVoice } from '../services/audioCache';
import { getManualOfflineMode } from '../services/offlineMode';
import { createAudioPlayer } from '../utils/audioPlayback';
import { DEFAULT_TTS_SPEED } from '../types';

/**
 * Hook for recording audio using MediaRecorder
 * Supports device selection and real-time audio level monitoring.
 */
export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopLevelMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const startRecording = useCallback(async (deviceId?: string) => {
    try {
      setError(null);
      setAudioBlob(null);

      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Set up audio level monitoring
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        setAudioLevel(avg / 255); // 0-1 range
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
        stopLevelMonitor();
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError') {
        setError('Microphone permission denied. Check browser settings.');
      } else if (e.name === 'NotFoundError') {
        setError('No microphone found. Please connect one.');
      } else if (e.name === 'OverconstrainedError') {
        setError('Selected microphone not available.');
      } else {
        setError('Could not access microphone.');
      }
      console.error('Recording error:', err);
    }
  }, [stopLevelMonitor]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
  }, []);

  return {
    isRecording,
    audioBlob,
    error,
    audioLevel,
    startRecording,
    stopRecording,
    clearRecording,
  };
}

/**
 * Hook for playing audio
 */
export function useAudioPlayer(url?: string) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  const play = useCallback(
    (overrideUrl?: string) => {
      const audioUrl = overrideUrl || url;
      if (!audioUrl) return;

      setError(null);
      playerRef.current.play(audioUrl, {
        label: 'recording',
        onPlay: () => setIsPlaying(true),
        onEnded: () => setIsPlaying(false),
        onError: () => {
          setIsPlaying(false);
          setError('Failed to play audio');
        },
      });
    },
    [url]
  );

  const stop = useCallback(() => {
    playerRef.current.stop();
    setIsPlaying(false);
  }, []);

  return {
    isPlaying,
    error,
    play,
    stop,
  };
}

/**
 * Hook for text-to-speech using Web Speech API (fallback)
 */
export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speak = useCallback((text: string, lang: string = 'zh-CN') => {
    if (!('speechSynthesis' in window)) {
      setError('Text-to-speech not supported in this browser');
      return;
    }

    setError(null);
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = DEFAULT_TTS_SPEED;

    // Try to find a Chinese voice (prefer on-device voices)
    const chineseVoice = pickChineseVoice();
    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      setError('Speech synthesis failed');
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    // Not available in Android WebView (the native app)
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return {
    isSpeaking,
    error,
    speak,
    stop,
  };
}

/**
 * What to hand the player for a stored clip: the cached blob whenever we can
 * get one, and the network URL only as a last resort.
 *
 * Always cache-first. Regenerating a note's audio mints a brand-new R2 key
 * (getUniqueAudioKey), so a fresh clip is simply a cache miss and gets fetched
 * on its own — there is no stale-bytes case to bust, and therefore no reason to
 * ever hand the media element a URL when the bytes are already on the device.
 * That matters: streaming a clip stalls mid-playback on a mobile connection
 * (audible as choppy, crunchy audio), while playing a fetched blob does not.
 *
 * getAudioWithCache already fetches-and-stores on a miss, so the URL fallback
 * only happens when the device is offline with nothing cached, or the fetch
 * itself failed.
 */
export async function resolveNoteAudioSource(
  audioUrl: string,
  apiBase: string
): Promise<Blob | string> {
  const blob = await getAudioWithCache(audioUrl).catch(() => null);
  return blob ?? `${apiBase}/api/audio/${audioUrl}`;
}

/**
 * Hook for playing note audio - uses stored audio URL if available, falls back to browser TTS
 */
export function useNoteAudio(label: string = 'note') {
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef(createAudioPlayer());
  const playIdRef = useRef(0); // Track which play() call is current

  const cleanupAudio = useCallback(() => {
    playerRef.current.stop();
    // Not available in Android WebView (the native app)
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  const play = useCallback((audioUrl: string | null, text: string, apiBase: string) => {
    // Increment play ID to invalidate any pending callbacks from previous plays
    const currentPlayId = ++playIdRef.current;

    // Stop any current playback
    cleanupAudio();

    if (!audioUrl) {
      // No stored audio, use browser TTS
      speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
      return;
    }

    const playSource = (source: Blob | string) => {
      playerRef.current.play(source, {
        label,
        onPlay: () => {
          if (playIdRef.current === currentPlayId) setIsPlaying(true);
        },
        onEnded: () => {
          if (playIdRef.current === currentPlayId) setIsPlaying(false);
        },
        onError: () => {
          if (playIdRef.current === currentPlayId) {
            setIsPlaying(false);
            speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
          }
        },
      });
    };

    // Manual offline mode: never touch the network. On spotty connections
    // (e.g. on the train) network audio requests stall, queue up, and then
    // all play at once. Play from the IndexedDB cache if available,
    // otherwise fall back to on-device speech synthesis immediately.
    if (getManualOfflineMode()) {
      getCachedAudio(audioUrl).then((blob) => {
        if (playIdRef.current !== currentPlayId) return; // Superseded
        if (blob) {
          playSource(blob);
        } else {
          speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
        }
      }).catch(() => {
        if (playIdRef.current !== currentPlayId) return;
        speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
      });
      return;
    }

    resolveNoteAudioSource(audioUrl, apiBase).then(source => {
      if (playIdRef.current !== currentPlayId) return; // Superseded
      playSource(source);
    });
  }, [cleanupAudio, label]);

  const stop = useCallback(() => {
    playIdRef.current++; // Invalidate any pending callbacks
    cleanupAudio();
    setIsPlaying(false);
  }, [cleanupAudio]);

  return { isPlaying, play, stop };
}

function speakWithBrowserTTS(
  text: string,
  setIsPlaying: (playing: boolean) => void,
  playId: number,
  playIdRef: { current: number }
) {
  if (!('speechSynthesis' in window)) return;

  // Don't speak if this play request has been superseded
  if (playIdRef.current !== playId) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = DEFAULT_TTS_SPEED;

  const chineseVoice = pickChineseVoice();
  if (chineseVoice) {
    utterance.voice = chineseVoice;
  }

  utterance.onstart = () => {
    if (playIdRef.current === playId) setIsPlaying(true);
  };
  utterance.onend = () => {
    if (playIdRef.current === playId) setIsPlaying(false);
  };
  utterance.onerror = () => {
    if (playIdRef.current === playId) setIsPlaying(false);
  };

  window.speechSynthesis.speak(utterance);
}
