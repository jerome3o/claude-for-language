/**
 * The study card's answer check for the typing cards (meaning → hanzi, audio → hanzi): the
 * decision behind the back's AnswerDiff, and its SPOKEN mode for an answer said aloud with the
 * 🎤 button instead of typed (docs/STUDY_SESSION.md "Say the answer").
 *
 * Typed: exact → punctuation-only → equivalent (numbers ↔ hanzi, 两 / 二; `hanziAnswerKey`) →
 * a listed alternative → wrong.
 *
 * Spoken: speech can't tell 由 / 油 / 游 apart, so after the typed check a transcript whose
 * hanzi differ but whose pinyin WITH TONES is the expected answer's counts as right by sound
 * (`sound`: "Sounded right ✓ — written 由"). The pinyin of both sides is the app's own automatic
 * pinyin (pinyin-pro + the 一 / 不 tone changes, `applyYiBuToneChanges`) over the answer key; the
 * note's own written pinyin is accepted as a target too (a polyphone pinyin-pro reads otherwise).
 * The same syllables with different tones (or none) is `close` — still wrong, like a typo.
 *
 * Never used to bias recognition: the expected answer is NOT sent to the recogniser
 * (shared/transcription/soniox.ts `buildSonioxConfig` has no context).
 *
 * Lab port: core `AnswerKey.check` / `AnswerKey.checkSpoken`, parity-tested
 * (android-lab/parity/fixtures/spoken-answer.ts → SpokenAnswerParityTest).
 */
import { pinyin } from 'pinyin-pro';
import { hanziAnswerKey, stripAnswerPunctuation } from '../text/numberHanzi';
import { applyYiBuToneChanges } from '../pinyin/toneChange';

export type AnswerVerdict =
  | 'exact'
  | 'punctuation_only'
  | 'equivalent'
  | 'alternative'
  /** Spoken only: other characters, the same pinyin with tones (a homophone). */
  | 'sound'
  /** Spoken only: the same syllables with other tones (or the recogniser gave none) — wrong. */
  | 'close'
  | 'wrong';

/** A verdict that counts as right (green on the back, the "correct" sound in the Lab app). */
export function isAcceptedVerdict(v: AnswerVerdict): boolean {
  return v !== 'wrong' && v !== 'close';
}

const normalize = (s: string) => s.trim().toLowerCase();

/** The typed answer against the card's hanzi (and its accepted alternatives). */
export function checkTypedAnswer(userAnswer: string, correct: string, alternatives: readonly string[] = []): AnswerVerdict {
  const user = userAnswer.trim();
  if (normalize(user) === normalize(correct)) return 'exact';
  if (stripAnswerPunctuation(user) === stripAnswerPunctuation(correct)) return 'punctuation_only';
  const userKey = hanziAnswerKey(user);
  if (userKey === hanziAnswerKey(correct)) return 'equivalent';
  const normalizedUser = normalize(user);
  if (alternatives.some(alt => normalize(alt) === normalizedUser || hanziAnswerKey(alt) === userKey)) return 'alternative';
  return 'wrong';
}

const TONED = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ';
const BASE = 'aaaaeeeeiiiioooouuuuüüüü';
/** Everything that isn't a pinyin letter goes: spaces, apostrophes, punctuation, digits. */
const NOT_PINYIN = /[^a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g;
const HAN = /\p{Script=Han}/u;

/** Tone-marked pinyin as one comparable run: NFC, lower case, letters and tone-marked vowels only. */
export function normalizeSpokenPinyin(py: string): string {
  return py.normalize('NFC').toLowerCase().replace(NOT_PINYIN, '');
}

/** The same run with the tones taken off (ǚ → ü). */
export function tonelessPinyin(key: string): string {
  let out = '';
  for (const ch of key) {
    const i = TONED.indexOf(ch);
    out += i >= 0 ? BASE[i] : ch;
  }
  return out;
}

/** What a hanzi string sounds like: the answer key (numbers → hanzi, 两 → 二, no punctuation), then the app's automatic pinyin. */
export function spokenPinyinKey(hanzi: string): string {
  const key = hanziAnswerKey(hanzi);
  if (!key) return '';
  return normalizeSpokenPinyin(applyYiBuToneChanges(key, pinyin(key, { toneType: 'symbol', type: 'string' })));
}

/**
 * A transcript of the learner saying the answer. Exact / equivalent / alternative hanzi first
 * (the typed check), then by sound: `sound` when its toned pinyin is the answer's (or an
 * alternative's, or the note's written pinyin), `close` when only the toneless syllables match.
 */
export function checkSpokenAnswer(
  transcript: string,
  correct: string,
  alternatives: readonly string[] = [],
  notePinyin = '',
): AnswerVerdict {
  const typed = checkTypedAnswer(transcript, correct, alternatives);
  if (typed !== 'wrong') return typed;
  if (!HAN.test(transcript)) return 'wrong';
  const heard = spokenPinyinKey(transcript);
  if (!heard) return 'wrong';
  const targets = [correct, ...alternatives].map(spokenPinyinKey);
  targets.push(normalizeSpokenPinyin(notePinyin));
  const live = targets.filter(t => t.length > 0);
  if (live.includes(heard)) return 'sound';
  const bare = tonelessPinyin(heard);
  if (live.some(t => tonelessPinyin(t) === bare)) return 'close';
  return 'wrong';
}

/** The line under a spoken answer on the back (null = nothing to add). */
export function spokenVerdictNote(verdict: AnswerVerdict, correct: string): string | null {
  if (verdict === 'sound') return `Sounded right ✓ — written ${correct.trim()}`;
  if (verdict === 'close') return 'Close — the tones are off';
  return null;
}
