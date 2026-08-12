import { useState, useCallback } from 'react';
import { transcribeAudio, TranscriptionResult, pronunciationAssessment, PronunciationAssessmentResult } from '../api/client';
import { pinyin } from 'pinyin-pro';
import { convertToWav } from '../utils/audioConvert';
import { normalizeNumbersToHanzi } from '../utils/numberHanzi';

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
  /** Not an exact match, but the expected answer appears inside the transcription
   *  (e.g. the user said the word within a sentence to help the transcriber). */
  containsExpected: boolean;
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

/** Pinyin comparison key for a hanzi string: tone marks kept, spacing/punctuation dropped. */
function pinyinKey(hanzi: string): string {
  return normalizePinyin(pinyin(hanzi, { toneType: 'symbol', type: 'string' }));
}

/**
 * Compare transcribed text against expected note content.
 * Transcription comes back as hanzi — convert both to pinyin for tone-aware comparison.
 * Numbers (digits, Roman numerals, English words) are normalized to hanzi on BOTH sides,
 * so a spoken 五 matches a note written as "5" and a transcription of "200" matches 两百.
 * 两 and 二 are treated as equivalent when they're the only difference.
 */
export function compareTranscription(transcribedText: string, expectedHanzi: string, expectedPinyin: string): TranscriptionComparison {
  const originalTrimmed = transcribedText.trim();
  const normalizedTranscribedHanzi = normalizeNumbersToHanzi(originalTrimmed);
  const normalizedExpectedHanzi = normalizeNumbersToHanzi(expectedHanzi);
  const transcribedPy = pinyin(normalizedTranscribedHanzi, { toneType: 'symbol', type: 'string' });

  // Digit-to-hanzi conversion produces 二 where a speaker naturally says 两 (200 → 二百 vs 两百),
  // so fall back to comparing with 两 canonicalized to 二 on both sides.
  const transcribedKey = pinyinKey(normalizedTranscribedHanzi);
  const expectedKey = pinyinKey(normalizedExpectedHanzi);
  const transcribedKeyAlt = pinyinKey(normalizedTranscribedHanzi.replace(/两/g, '二'));
  const expectedKeyAlt = pinyinKey(normalizedExpectedHanzi.replace(/两/g, '二'));

  const isMatch = transcribedKey === expectedKey || transcribedKeyAlt === expectedKeyAlt;
  const containsExpected =
    !isMatch &&
    expectedKey.length > 0 &&
    (transcribedKey.includes(expectedKey) || transcribedKeyAlt.includes(expectedKeyAlt));

  return {
    transcribedHanzi: originalTrimmed,
    transcribedPinyin: transcribedPy,
    expectedHanzi,
    expectedPinyin,
    isMatch,
    containsExpected,
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
