import { useState, useCallback, useRef } from 'react';
import { transcribeAudio, TranscriptionResult } from '../api/client';
import { pinyin } from 'pinyin-pro';
import { normalizeNumbersToHanzi } from '../utils/numberHanzi';
import { transcribeTakeOutcome } from '../services/takeTranscription';
import { resetLiveSessionCache } from '../services/liveTranscription';
import { liveFailureInvalidatesKey } from '@shared/transcription/soniox';

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

  // A newer take (or reset) makes an older, still-running transcription stale.
  const generation = useRef(0);
  // The last take, so "Couldn't transcribe — tap to retry" can send the SAME recording again.
  const lastTake = useRef<{ audioBlob: Blob; expectedHanzi: string; expectedPinyin: string } | null>(null);

  /**
   * Called as soon as a take exists (not on "Check answer"), so the result is usually
   * waiting by the time the card flips. `live` is the streaming transcriber's final text
   * (Soniox, ready a few hundred ms after Stop); when it's missing, empty or fails, the take
   * is uploaded to POST /api/transcribe (Whisper, then Soniox async / Gemini on the server).
   * Offline: "will transcribe when online" (the recording still goes up with the review).
   * Both failing sets `error` — the card shows "Couldn't transcribe — tap to retry".
   */
  const transcribe = useCallback(async (audioBlob: Blob, expectedHanzi: string, expectedPinyin: string, live?: Promise<string> | null) => {
    const gen = ++generation.current;
    lastTake.current = { audioBlob, expectedHanzi, expectedPinyin };
    const set = (next: TranscriptionState) => { if (gen === generation.current) setState(next); };
    const startedAt = performance.now();

    if (!live && !navigator.onLine) {
      set({ isTranscribing: false, result: null, comparison: null, error: null, isOffline: true });
      return;
    }
    set({ isTranscribing: true, result: null, comparison: null, error: null, isOffline: false });

    const outcome = await transcribeTakeOutcome({
      live,
      upload: (liveError) => transcribeAudio(audioBlob, { liveError }),
      isOnline: () => navigator.onLine,
    });
    if (outcome.liveError) {
      console.warn('[transcribe] live transcription gave nothing, uploading instead:', outcome.liveError);
      // A refused key would fail every take until it expires: mint a fresh one next time.
      if (liveFailureInvalidatesKey(outcome.liveError)) resetLiveSessionCache();
    }
    const ms = Math.round(performance.now() - startedAt);
    switch (outcome.kind) {
      case 'done':
        console.info(`[transcribe] ${outcome.via === 'live' ? 'live (Soniox)' : 'upload'} ready ${ms} ms after stop`);
        set({ isTranscribing: false, result: outcome.result, comparison: compareTranscription(outcome.text, expectedHanzi, expectedPinyin), error: null, isOffline: false });
        return;
      case 'offline':
        set({ isTranscribing: false, result: null, comparison: null, error: null, isOffline: true });
        return;
      case 'failed':
        console.warn(`[transcribe] failed after ${ms} ms: ${outcome.reason}`);
        set({ isTranscribing: false, result: null, comparison: null, error: "Couldn't transcribe", isOffline: false });
    }
  }, []);

  /** "Tap to retry": the saved take again, straight to the upload path. */
  const retry = useCallback(() => {
    const take = lastTake.current;
    if (take) void transcribe(take.audioBlob, take.expectedHanzi, take.expectedPinyin, null);
  }, [transcribe]);

  const reset = useCallback(() => {
    generation.current++;
    lastTake.current = null;
    setState({
      isTranscribing: false,
      result: null,
      comparison: null,
      error: null,
      isOffline: false,
    });
  }, []);

  return { ...state, transcribe, retry, reset };
}
