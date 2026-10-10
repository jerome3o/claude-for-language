/**
 * "You said: …" — does a transcript of a pronunciation take match the card?
 *
 * ONE comparison for the study card (frontend useTranscription, which re-exports
 * this) and the worker's background recording check (services/recording-checks.ts),
 * so the tutor's "Needs your ear" queue agrees with the ✅ / ❌ the learner saw.
 *
 * Transcription comes back as hanzi, so both sides go to pinyin WITH tones and are
 * compared without spacing / punctuation (a homophone the recogniser picked — 在 / 再 —
 * still matches; a different tone does not). Numbers (digits, Roman numerals, English
 * words) are normalised to hanzi on both sides, and 两 / 二 count as the same.
 *
 * "Answer found in your sentence" (`containsExpected`): the answer's pinyin inside the
 * transcript's, or `spokenAnswerWithin` (shared/cards/answer.ts) — the SAME rule the typing
 * cards use for a spoken answer (`contains`): the hanzi inside, or a syllable window that sounds
 * like it (a neutral syllable of the answer — 得 de — matching any tone). Lab: Transcription.compare.
 */
import { pinyin } from 'pinyin-pro';
import { normalizeNumbersToHanzi } from '../text/numberHanzi';
import { spokenAnswerWithin } from '../cards/answer';

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

/** Normalize pinyin for comparison: lowercase, remove spaces, strip non-letter/tone chars. */
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
    (transcribedKey.includes(expectedKey) || transcribedKeyAlt.includes(expectedKeyAlt) || spokenAnswerWithin(originalTrimmed, expectedHanzi) !== null);

  return {
    transcribedHanzi: originalTrimmed,
    transcribedPinyin: transcribedPy,
    expectedHanzi,
    expectedPinyin,
    isMatch,
    containsExpected,
  };
}

/**
 * The verdict the study card shows as ✅ — an exact match or the word said inside a
 * longer sentence. An empty transcript (nothing heard) is NOT a match.
 */
export function transcriptMatches(transcript: string, expectedHanzi: string): boolean {
  if (!transcript.trim()) return false;
  const c = compareTranscription(transcript, expectedHanzi, '');
  return c.isMatch || c.containsExpected;
}
