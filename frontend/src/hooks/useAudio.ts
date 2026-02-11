import { useState, useRef, useCallback } from 'react';
import { getAudioWithCache } from '../services/audioCache';

/**
 * Hook for recording audio using MediaRecorder
 */
export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('Could not access microphone');
      console.error('Recording error:', err);
    }
  }, []);

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
    utterance.rate = 0.8; // Slightly slower for learning

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
  utterance.rate = 0.8;

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
