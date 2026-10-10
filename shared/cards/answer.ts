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
 * Said inside a sentence (`contains`): like the read card's "You said … ✅ Answer found in your
 * sentence" (shared/recordings/transcript.ts, which uses `spokenAnswerWithin` too), a transcript
 * that CONTAINS the answer counts — 他长得很好。 for 长得. Either the answer's hanzi (or an
 * alternative's) appear as one contiguous stretch of the transcript (answer keys: numbers →
 * hanzi, 两 → 二, no punctuation or spaces; common traditional characters → simplified), or a
 * contiguous window of the transcript's syllables sounds like the answer (a homophone inside the
 * sentence). A one-character answer counts too (好 in 我很好), exactly as on the read card.
 * Syllables compare with tones, except that a NEUTRAL syllable of the answer (得 de in 长得 —
 * pinyin-pro reads 他长得很好 as … dé …) matches that syllable said in any tone; the same rule
 * applies to the whole-answer `sound` check.
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
import { toSimplified } from '../picture-hunt/match';

export type AnswerVerdict =
  | 'exact'
  | 'punctuation_only'
  | 'equivalent'
  | 'alternative'
  /** Spoken only: other characters, the same pinyin with tones (a homophone). */
  | 'sound'
  /** Spoken only: the answer said inside a longer sentence (its hanzi, or a homophone window) — right. */
  | 'contains'
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
 * Each character of a hanzi string's answer key with its syllable (the app's automatic pinyin
 * + the 一 / 不 tone changes, normalised); null for a non-Han character.
 */
export function spokenSyllables(hanzi: string): (string | null)[] {
  const key = hanziAnswerKey(hanzi);
  if (!key) return [];
  const chars = [...key];
  const tokens = applyYiBuToneChanges(key, pinyin(key, { toneType: 'symbol', type: 'string' })).split(' ');
  if (tokens.length !== chars.length) return chars.map(() => null);
  return chars.map((c, i) => (HAN.test(c) ? normalizeSpokenPinyin(tokens[i]) || null : null));
}

const allSyllables = (xs: readonly (string | null)[]): xs is string[] => xs.length > 0 && xs.every(x => x !== null);

const hasToneMark = (py: string) => tonelessPinyin(py) !== py;

/**
 * Heard syllables against the answer's, one by one: equal, or the answer's is neutral (no tone
 * mark) and only the tone differs. Only an answer with at least one toned syllable gets that
 * allowance — an all-neutral one (吗 ma) must be heard as is, else 妈 would count for 吗.
 */
function syllablesMatch(heard: readonly string[], target: readonly string[]): boolean {
  if (heard.length !== target.length) return false;
  const neutralOk = target.some(hasToneMark);
  return heard.every((h, i) => h === target[i] || (neutralOk && !hasToneMark(target[i]) && tonelessPinyin(h) === target[i]));
}

/**
 * Heard syllables against a pinyin run with no syllable boundaries (the note's written pinyin):
 * each syllable must come next in the run as said, or toneless where the run is (a neutral
 * syllable). Only a run with at least one tone mark gets that allowance, so pinyin written
 * without tones never accepts every tone.
 */
function runMatches(heard: readonly string[], run: string): boolean {
  const toned = hasToneMark(run);
  let pos = 0;
  for (const h of heard) {
    if (run.startsWith(h, pos)) { pos += h.length; continue; }
    const bare = tonelessPinyin(h);
    if (toned && run.startsWith(bare, pos)) { pos += bare.length; continue; }
    return false;
  }
  return pos === run.length;
}

interface SpokenTargets { syllables: string[][]; runs: string[] }

function spokenTargets(correct: string, alternatives: readonly string[], notePinyin: string): SpokenTargets {
  const syllables: string[][] = [];
  for (const t of [correct, ...alternatives]) {
    const s = spokenSyllables(t);
    if (allSyllables(s)) syllables.push(s);
  }
  const run = normalizeSpokenPinyin(notePinyin);
  return { syllables, runs: run ? [run] : [] };
}

/** Do these heard syllables sound like the answer (an alternative, the note's pinyin)? */
function soundsLike(heard: readonly string[], targets: SpokenTargets): boolean {
  return targets.syllables.some(t => syllablesMatch(heard, t))
    || targets.runs.some(r => runMatches(heard, r));
}

/**
 * Is the answer said somewhere inside the transcript? `hanzi`: its characters (or an
 * alternative's) appear as one contiguous stretch of the transcript's answer key (common
 * traditional characters → simplified on both sides); `sound`: a contiguous window of the
 * transcript's syllables sounds like it (tones count; a neutral syllable of the answer matches
 * any tone). null = not found. A window may be the whole transcript, so callers check the
 * whole-answer verdicts first. The typing cards' spoken check (`contains`) and the read card's
 * "Answer found in your sentence" (shared/recordings/transcript.ts) both use it.
 */
export function spokenAnswerWithin(
  transcript: string,
  correct: string,
  alternatives: readonly string[] = [],
  notePinyin = '',
): 'hanzi' | 'sound' | null {
  if (!HAN.test(transcript)) return null;
  const heardKey = toSimplified(hanziAnswerKey(transcript));
  for (const t of [correct, ...alternatives]) {
    const k = toSimplified(hanziAnswerKey(t));
    if (k && HAN.test(k) && heardKey.includes(k)) return 'hanzi';
  }
  const heard = spokenSyllables(transcript);
  const targets = spokenTargets(correct, alternatives, notePinyin);
  if (targets.syllables.length === 0 && targets.runs.length === 0) return null;
  for (let i = 0; i < heard.length; i++) {
    for (let j = i + 1; j <= heard.length; j++) {
      const w = heard.slice(i, j);
      if (!allSyllables(w)) break;
      if (soundsLike(w, targets)) return 'sound';
    }
  }
  return null;
}

/**
 * A transcript of the learner saying the answer. Exact / equivalent / alternative hanzi first
 * (the typed check), then by sound: `sound` when its toned pinyin is the answer's (or an
 * alternative's, or the note's written pinyin; a neutral syllable of the answer matches any
 * tone), `contains` when the answer is said inside a longer sentence (`spokenAnswerWithin`),
 * `close` when only the toneless syllables of the whole match.
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
  const keys = [correct, ...alternatives].map(spokenPinyinKey);
  keys.push(normalizeSpokenPinyin(notePinyin));
  const live = keys.filter(t => t.length > 0);
  if (live.includes(heard)) return 'sound';
  const syllables = spokenSyllables(transcript);
  if (allSyllables(syllables) && soundsLike(syllables, spokenTargets(correct, alternatives, notePinyin))) return 'sound';
  if (spokenAnswerWithin(transcript, correct, alternatives, notePinyin)) return 'contains';
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
