import { useState, useCallback } from 'react';
import { transcribeAudio, TranscriptionResult, pronunciationAssessment, PronunciationAssessmentResult } from '../api/client';
import { pinyin } from 'pinyin-pro';
import { convertToWav } from '../utils/audioConvert';

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
export function compareTranscription(transcribedText: string, expectedHanzi: string, expectedPinyin: string): TranscriptionComparison {
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

// ============ Azure Pronunciation Assessment Hook ============

export interface PronunciationAssessmentState {
  isAssessing: boolean;
  result: PronunciationAssessmentResult | null;
  error: string | null;
}

export function usePronunciationAssessment() {
  const [state, setState] = useState<PronunciationAssessmentState>({
    isAssessing: false,
    result: null,
    error: null,
  });

  const assess = useCallback(async (audioBlob: Blob, referenceText: string) => {
    if (!navigator.onLine) {
      setState({ isAssessing: false, result: null, error: 'Offline' });
      return;
    }

    setState({ isAssessing: true, result: null, error: null });

    try {
      // Convert WebM to WAV PCM 16kHz for Azure
      const wavBlob = await convertToWav(audioBlob);
      const result = await pronunciationAssessment(wavBlob, referenceText);
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
