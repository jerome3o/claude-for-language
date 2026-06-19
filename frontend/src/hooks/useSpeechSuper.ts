import { useState, useCallback } from 'react';
import { assessSpeechSuper, SpeechSuperResult } from '../api/client';
import { convertToWav } from '../utils/audioConvert';

// Spike: SpeechSuper Mandarin pronunciation + tone assessment.
// Mirrors usePronunciationAssessment (Azure). Converts the recorded WebM blob to
// 16kHz mono WAV before sending, since SpeechSuper expects PCM WAV.

export interface SpeechSuperState {
  isAssessing: boolean;
  result: SpeechSuperResult | null;
  error: string | null;
}

export function useSpeechSuper() {
  const [state, setState] = useState<SpeechSuperState>({
    isAssessing: false,
    result: null,
    error: null,
  });

  const assess = useCallback(async (audioBlob: Blob, refText: string) => {
    if (!navigator.onLine) {
      setState({ isAssessing: false, result: null, error: 'Offline' });
      return;
    }

    setState({ isAssessing: true, result: null, error: null });

    try {
      const wavBlob = await convertToWav(audioBlob);
      const result = await assessSpeechSuper(wavBlob, refText);

      // SpeechSuper can return a 200 with a logical error payload.
      if (result?.error) {
        setState({ isAssessing: false, result: null, error: String(result.error) });
        return;
      }

      setState({ isAssessing: false, result, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Assessment failed';
      setState({ isAssessing: false, result: null, error: msg });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ isAssessing: false, result: null, error: null });
  }, []);

  return { ...state, assess, reset };
}
