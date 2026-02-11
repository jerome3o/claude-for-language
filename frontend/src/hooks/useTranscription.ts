import { useState, useCallback } from 'react';
import { transcribeAudio, TranscriptionResult } from '../api/client';
import { pinyin } from 'pinyin-pro';

export interface TranscriptionState {
  isTranscribing: boolean;
  result: TranscriptionResult | null;
  comparison: TranscriptionComparison | null;
  error: string | null;
  isOffline: boolean;
}

export interface TranscriptionComparison {
  transcribedHanzi: string;
  transcribedPinyin: string;
  expectedHanzi: string;
  expectedPinyin: string;
  isMatch: boolean;
}

/**
 * Normalize pinyin for comparison: lowercase, remove spaces, strip non-letter/tone chars
 */
function normalizePinyin(py: string): string {
  return py
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, '');
}

/**
 * Compare transcribed text against expected note content.
 * Transcription comes back as hanzi — convert both to pinyin for tone-aware comparison.
 */
function compareTranscription(transcribedText: string, expectedHanzi: string, expectedPinyin: string): TranscriptionComparison {
  const trimmed = transcribedText.trim();
  const transcribedPy = pinyin(trimmed, { toneType: 'symbol', type: 'string' });
  const expectedPy = pinyin(expectedHanzi, { toneType: 'symbol', type: 'string' });

  const normalizedTranscribed = normalizePinyin(transcribedPy);
  const normalizedExpected = normalizePinyin(expectedPy);

  return {
    transcribedHanzi: trimmed,
    transcribedPinyin: transcribedPy,
    expectedHanzi,
    expectedPinyin,
    isMatch: normalizedTranscribed === normalizedExpected,
  };
}

export function useTranscription() {
  const [state, setState] = useState<TranscriptionState>({
    isTranscribing: false,
    result: null,
    comparison: null,
    error: null,
    isOffline: false,
  });

  const transcribe = useCallback(async (audioBlob: Blob, expectedHanzi: string, expectedPinyin: string) => {
    if (!navigator.onLine) {
      setState({
        isTranscribing: false,
        result: null,
        comparison: null,
        error: null,
        isOffline: true,
      });
      return;
    }

    setState({
      isTranscribing: true,
      result: null,
      comparison: null,
      error: null,
      isOffline: false,
    });

    try {
      const result = await transcribeAudio(audioBlob);
      const comparison = compareTranscription(result.text, expectedHanzi, expectedPinyin);

      setState({
        isTranscribing: false,
        result,
        comparison,
        error: null,
        isOffline: false,
      });
    } catch (err) {
      setState({
        isTranscribing: false,
        result: null,
        comparison: null,
        error: 'Transcription failed',
        isOffline: false,
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isTranscribing: false,
      result: null,
      comparison: null,
      error: null,
      isOffline: false,
    });
  }, []);

  return { ...state, transcribe, reset };
}
