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

// Maps for normalizing number representations in Whisper transcriptions to Chinese hanzi
const ENGLISH_NUM_TO_HANZI: Record<string, string> = {
  zero: '零', one: '一', two: '二', three: '三', four: '四', five: '五',
  six: '六', seven: '七', eight: '八', nine: '九', ten: '十',
  eleven: '十一', twelve: '十二', thirteen: '十三', fourteen: '十四', fifteen: '十五',
  sixteen: '十六', seventeen: '十七', eighteen: '十八', nineteen: '十九',
  twenty: '二十', thirty: '三十', forty: '四十', fifty: '五十',
  sixty: '六十', seventy: '七十', eighty: '八十', ninety: '九十',
  hundred: '百', thousand: '千',
};

const ROMAN_TO_HANZI: Record<string, string> = {
  I: '一', II: '二', III: '三', IV: '四', V: '五',
  VI: '六', VII: '七', VIII: '八', IX: '九', X: '十',
  XI: '十一', XII: '十二', XIII: '十三', XIV: '十四', XV: '十五',
  XVI: '十六', XVII: '十七', XVIII: '十八', XIX: '十九',
  XX: '二十', XXX: '三十', XL: '四十', L: '五十',
  LX: '六十', LXX: '七十', LXXX: '八十', XC: '九十', C: '百',
};

function intToHanzi(n: number): string {
  if (n === 0) return '零';
  const ones = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return ones[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + ones[n - 10];
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return ones[ten] + '十' + (one > 0 ? ones[one] : '');
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    if (rem === 0) return ones[h] + '百';
    if (rem < 10) return ones[h] + '百零' + ones[rem];
    return ones[h] + '百' + intToHanzi(rem);
  }
  if (n < 10000) {
    const t = Math.floor(n / 1000);
    const rem = n % 1000;
    if (rem === 0) return ones[t] + '千';
    if (rem < 100) return ones[t] + '千零' + intToHanzi(rem);
    return ones[t] + '千' + intToHanzi(rem);
  }
  if (n < 100000000) {
    const w = Math.floor(n / 10000);
    const rem = n % 10000;
    if (rem === 0) return intToHanzi(w) + '万';
    if (rem < 1000) return intToHanzi(w) + '万零' + intToHanzi(rem);
    return intToHanzi(w) + '万' + intToHanzi(rem);
  }
  return String(n);
}

/** Read a decimal number the Chinese way: integer part + 点 + digits one by one. */
function decimalToHanzi(intPart: string, fracPart: string): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const frac = [...fracPart].map((d) => digits[parseInt(d, 10)]).join('');
  return intToHanzi(parseInt(intPart, 10)) + '点' + frac;
}

/**
 * Normalize number representations (Arabic digits, Roman numerals, English words) to Chinese hanzi.
 * Whisper sometimes transcribes spoken Chinese numbers as digits or Roman numerals.
 */
function normalizeNumbersToHanzi(text: string): string {
  // Strip thousands separators so "1,000" is treated as one number
  let result = text.replace(/(\d),(?=\d{3})/g, '$1');

  // Replace English number words (whole-word, case-insensitive)
  result = result.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/gi,
    (word) => ENGLISH_NUM_TO_HANZI[word.toLowerCase()] || word
  );

  // Replace Roman numerals (lookup-based for common values, whole-word match)
  result = result.replace(/\b[IVXLC]+\b/g, (match) => {
    return ROMAN_TO_HANZI[match.toUpperCase()] || match;
  });

  // Percentages: "50%" → 百分之五十
  result = result.replace(/(\d+)(?:\.(\d+))?%/g, (_m, intPart, fracPart) => {
    return '百分之' + (fracPart ? decimalToHanzi(intPart, fracPart) : intToHanzi(parseInt(intPart, 10)));
  });

  // Decimals: "1.5" → 一点五
  result = result.replace(/\b(\d+)\.(\d+)\b/g, (_m, intPart, fracPart) => decimalToHanzi(intPart, fracPart));

  // Replace Arabic digit sequences
  result = result.replace(/\b\d+\b/g, (num) => {
    const n = parseInt(num, 10);
    return isNaN(n) ? num : intToHanzi(n);
  });

  return result;
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
  const isMatch =
    pinyinKey(normalizedTranscribedHanzi) === pinyinKey(normalizedExpectedHanzi) ||
    pinyinKey(normalizedTranscribedHanzi.replace(/两/g, '二')) === pinyinKey(normalizedExpectedHanzi.replace(/两/g, '二'));

  return {
    transcribedHanzi: originalTrimmed,
    transcribedPinyin: transcribedPy,
    expectedHanzi,
    expectedPinyin,
    isMatch,
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
