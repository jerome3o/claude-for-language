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
 * "Close — tones off" (`tonesOff`): the same syllables with other tones, as the typing cards' `close`.
 *
 * "Contains the answer" (`containsExpected`): the answer's pinyin inside the
 * transcript's, or `spokenAnswerWithin` (shared/cards/answer.ts) — the SAME rule the typing
 * cards use for a spoken answer (`contains`): the hanzi inside, or a syllable window that sounds
 * like it (a neutral syllable of the answer — 得 de — matching any tone). Lab: Transcription.compare.
 *
 * Punctuation of ANY kind never matters (Jerome, Nov 2026: 英语很"繁琐" — the recogniser's quote marks):
 * both sides lose every punctuation mark, symbol and space before they go to pinyin. And a SENTENCE read
 * with one short unstressed word missing (是 / 的 / 了 …, `droppedFunctionChar` — the recogniser swallows
 * them at a pause, PR #739) is a match (`droppedWord` says which). Anything else the device can't accept on
 * a multi-character card goes to Claude's read-aloud check (shared/study/readTakeCheck.ts).
 */
import { pinyin } from 'pinyin-pro';
import { normalizeNumbersToHanzi } from '../text/numberHanzi';
import { droppedFunctionChar, spokenAnswerWithin, tonelessPinyin } from '../cards/answer';

export interface TranscriptionComparison {
  transcribedHanzi: string;
  transcribedPinyin: string;
  expectedHanzi: string;
  expectedPinyin: string;
  isMatch: boolean;
  /** Not an exact match, but the expected answer appears inside the transcription
   *  (e.g. the user said the word within a sentence to help the transcriber). */
  containsExpected: boolean;
  /** Neither of those, but the same syllables with other tones (老伴 lǎobàn for 老板 lǎobǎn) — the
   *  typing cards' `close`: the box says "≈ Close — tones off", Hard mode "≈ Nearly". Still not right. */
  tonesOff: boolean;
  /** A match with one short function word not caught (a sentence; `droppedFunctionChar`): that word. */
  droppedWord?: string | null;
}

/** Every punctuation mark, symbol and space out (quotes of any kind, commas, full stops…): what is SAID. */
export function bareSpokenText(text: string): string {
  return text.replace(/[\p{P}\p{S}\s]+/gu, '');
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
  const transcribedPy = pinyin(normalizeNumbersToHanzi(originalTrimmed), { toneType: 'symbol', type: 'string' });
  // What was said: numbers → hanzi, then no punctuation / symbols / spaces at all (spaces between Latin
  // words go too — the pinyin keys drop them anyway).
  const normalizedTranscribedHanzi = bareSpokenText(normalizeNumbersToHanzi(originalTrimmed));
  const normalizedExpectedHanzi = bareSpokenText(normalizeNumbersToHanzi(expectedHanzi));

  // Digit-to-hanzi conversion produces 二 where a speaker naturally says 两 (200 → 二百 vs 两百),
  // so fall back to comparing with 两 canonicalized to 二 on both sides.
  const transcribedKey = pinyinKey(normalizedTranscribedHanzi);
  const expectedKey = pinyinKey(normalizedExpectedHanzi);
  const transcribedKeyAlt = pinyinKey(normalizedTranscribedHanzi.replace(/两/g, '二'));
  const expectedKeyAlt = pinyinKey(normalizedExpectedHanzi.replace(/两/g, '二'));

  const exact = transcribedKey === expectedKey || transcribedKeyAlt === expectedKeyAlt;
  // A sentence with one little word swallowed (by hanzi or by sound) is the recogniser's, not his.
  const droppedWord = !exact && expectedKey.length > 0 ? droppedFunctionChar(bareSpokenText(originalTrimmed), expectedHanzi) : null;
  const isMatch = exact || droppedWord !== null;
  const containsExpected =
    !isMatch &&
    expectedKey.length > 0 &&
    (transcribedKey.includes(expectedKey) || transcribedKeyAlt.includes(expectedKeyAlt) || spokenAnswerWithin(originalTrimmed, expectedHanzi) !== null);
  const tonesOff =
    !isMatch &&
    !containsExpected &&
    expectedKey.length > 0 &&
    (tonelessPinyin(transcribedKey) === tonelessPinyin(expectedKey) || tonelessPinyin(transcribedKeyAlt) === tonelessPinyin(expectedKeyAlt));

  return {
    transcribedHanzi: originalTrimmed,
    transcribedPinyin: transcribedPy,
    expectedHanzi,
    expectedPinyin,
    isMatch,
    containsExpected,
    tonesOff,
    droppedWord,
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
