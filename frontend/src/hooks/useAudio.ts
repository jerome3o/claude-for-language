import { useState, useRef, useCallback } from 'react';
import { getAudioWithCache } from '../services/audioCache';
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(
    (overrideUrl?: string) => {
      const audioUrl = overrideUrl || url;
      if (!audioUrl) return;

      setError(null);

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => setIsPlaying(true);
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => {
        setIsPlaying(false);
        setError('Failed to play audio');
      };

      audio.play().catch((err) => {
        setIsPlaying(false);
        setError('Failed to play audio');
        console.error('Playback error:', err);
      });
    },
    [url]
  );

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  return {
    isPlaying,
    error,
    play,
    pause,
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

    // Try to find a Chinese voice
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find(
      (v) => v.lang.startsWith('zh') || v.lang.includes('Chinese')
    );
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
    window.speechSynthesis.cancel();
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
 * Hook for playing note audio - uses stored audio URL if available, falls back to browser TTS
 */
export function useNoteAudio() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playIdRef = useRef(0); // Track which play() call is current

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      // Remove all event handlers to prevent stale callbacks
      audioRef.current.onplay = null;
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();
  }, []);

  const play = useCallback((audioUrl: string | null, text: string, apiBase: string, cacheBuster?: string) => {
    // Increment play ID to invalidate any pending callbacks from previous plays
    const currentPlayId = ++playIdRef.current;

    // Stop any current playback
    cleanupAudio();

    if (!audioUrl) {
      // No stored audio, use browser TTS
      speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
      return;
    }

    const playFromUrl = (url: string) => {
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onplay = () => {
        if (playIdRef.current === currentPlayId) {
          setIsPlaying(true);
        }
      };
      audio.onended = () => {
        if (playIdRef.current === currentPlayId) {
          setIsPlaying(false);
        }
      };
      audio.onerror = () => {
        if (playIdRef.current === currentPlayId) {
          setIsPlaying(false);
          speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
        }
      };

      audio.play().catch(() => {
        if (playIdRef.current === currentPlayId) {
          speakWithBrowserTTS(text, setIsPlaying, currentPlayId, playIdRef);
        }
      });
    };

    // Try IndexedDB cache first (works offline), then fall back to network
    // Skip cache if cacheBuster is set (audio was just regenerated)
    if (cacheBuster) {
      const fullUrl = `${apiBase}/api/audio/${audioUrl}?v=${encodeURIComponent(cacheBuster)}`;
      // Fetch fresh, then update cache in background
      getAudioWithCache(audioUrl).catch(() => {});
      playFromUrl(fullUrl);
    } else {
      getAudioWithCache(audioUrl).then(blob => {
        if (playIdRef.current !== currentPlayId) return; // Superseded
        if (blob) {
          playFromUrl(URL.createObjectURL(blob));
        } else {
          // Not cached and offline, or fetch failed — try network URL directly
          const fullUrl = `${apiBase}/api/audio/${audioUrl}`;
          playFromUrl(fullUrl);
        }
      }).catch(() => {
        if (playIdRef.current !== currentPlayId) return;
        const fullUrl = `${apiBase}/api/audio/${audioUrl}`;
        playFromUrl(fullUrl);
      });
    }
  }, [cleanupAudio]);

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

  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find(
    (v) => v.lang.startsWith('zh') || v.lang.includes('Chinese')
  );
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
