import { useState, useRef, useCallback } from 'react';

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

  const play = useCallback((audioUrl: string | null, text: string, apiBase: string) => {
    console.log('[useNoteAudio] play called:', { audioUrl, text, apiBase });

    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();

    // If we have a stored audio URL, use it
    if (audioUrl) {
      const fullUrl = `${apiBase}/api/audio/${audioUrl}`;
      console.log('[useNoteAudio] Playing from stored audio:', fullUrl);
      const audio = new Audio(fullUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        console.log('[useNoteAudio] Audio started playing');
        setIsPlaying(true);
      };
      audio.onended = () => {
        console.log('[useNoteAudio] Audio ended');
        setIsPlaying(false);
      };
      audio.onerror = (e) => {
        // Fallback to browser TTS on error
        console.error('[useNoteAudio] Audio error, falling back to browser TTS:', e);
        setIsPlaying(false);
        speakWithBrowserTTS(text, setIsPlaying);
      };

      audio.play().catch((err) => {
        // Fallback to browser TTS
        console.error('[useNoteAudio] Play failed, falling back to browser TTS:', err);
        speakWithBrowserTTS(text, setIsPlaying);
      });
    } else {
      // No stored audio, use browser TTS
      console.log('[useNoteAudio] No stored audio, using browser TTS');
      speakWithBrowserTTS(text, setIsPlaying);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  }, []);

  return { isPlaying, play, stop };
}

function speakWithBrowserTTS(text: string, setIsPlaying: (playing: boolean) => void) {
  if (!('speechSynthesis' in window)) return;

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

  utterance.onstart = () => setIsPlaying(true);
  utterance.onend = () => setIsPlaying(false);
  utterance.onerror = () => setIsPlaying(false);

  window.speechSynthesis.speak(utterance);
}
