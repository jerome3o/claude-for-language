/**
 * Claude's check of a self-assessed lesson answer ("Say it in Chinese", "Listen and translate"
 * answered in Chinese): is the learner's OWN sentence right, acceptable, almost or wrong, the
 * minimal fix, up to three short tips quoting the Chinese at fault, a natural alternative, and
 * which button (Got it / Missed it) to pre-select. The learner still decides.
 *
 * (Not to be confused with `answer-check.ts`, the deterministic character diff.)
 *
 * The worker answers it on `POST /api/lessons/answer-check` (services/answer-check.ts: a forced
 * tool, thinking off, Haiku); both apps start it the moment the answer is final, cache it on the
 * device and show it under "You said". Offline / failed → no card, the old self-assessment.
 * An answer that IS the model answer (the "✓ Exact match" chip) never reaches the model:
 * `exactAnswerCheck` makes its check locally, in both apps and in the worker.
 * Lab port: core `LessonAnswerCheck.kt`, parity-tested (parity/fixtures/lesson-answer-check.ts).
 * docs/STUDY_SESSION.md "Mini lessons" → "Claude checks your answer".
 *
 * Free SPEAKING ("口语 · Speaking — recorded", `oral_expression`, and "Say it out loud", `speak`)
 * gets the same check of the recording's transcript, graciously: disfluencies, restarts, "sorry" /
 * "wait", English asides, repeats and the recogniser's punctuation never count against the learner.
 * Its check adds `cleaned` (what they meant), `parts` (the task's ① ② ③ covered or missing) and a
 * better version per tip (`fix`). docs/STUDY_SESSION.md "Claude checks your speaking".
 */
import { isExactHanziMatch, normalizeHanziAnswer } from './answer-check';
import { digitsToHanzi } from '../text/numberHanzi';

/**
 * Bump when the prompt or the shape changes: cached checks (server + device) are keyed by it.
 * 3 (Nov 2026): the learner's / model answer tagged apart + the sanity rules (`insaneTip`) — a v2 check told
 * Jerome to put the 因为 clause first when his answer already did, comparing two identical strings.
 * 4 (Nov 2026): the coherence rules (`recommendsWrongForm`, `forbidsCorrected`), digits read as numerals (3 = 三) and a
 * prompt that states the actual rule — a v3 check told Jerome "use 钱 or 块 alone, not both" over a fix with 块…钱 and
 * offered his own 块多元 as the alternative.
 * 5 (Nov 2026): what the ear can't tell (shared/lesson/heardCheck.ts) — a "Listen and translate" answered in Chinese
 * never faults 他 for 她 (one sound, tā); the prompt says so and `forgiveUnheard` makes sure.
 */
export const ANSWER_CHECK_VERSION = 5;

export type AnswerCheckVerdict = 'correct' | 'acceptable' | 'almost' | 'wrong';
export const ANSWER_CHECK_VERDICTS: readonly AnswerCheckVerdict[] = ['correct', 'acceptable', 'almost', 'wrong'];

export type AnswerCheckSuggestion = 'got_it' | 'missed_it';

export interface AnswerCheckTip {
  /** One short line in English. */
  text: string;
  /** The exact Chinese the tip is about (tappable into the language explorer). */
  quote?: string;
  /** Speaking: the better version of the quoted words (Chinese). */
  fix?: string;
  /** Pinyin of `fix` (the app's pinyin path). */
  fix_pinyin?: string;
}

/** Speaking: one part of the task (① ② ③… or a main ask) — covered, covered with a slip, or missing. */
export type AnswerCheckPartStatus = 'used' | 'used_with_issue' | 'missing';
export const ANSWER_CHECK_PART_STATUSES: readonly AnswerCheckPartStatus[] = ['used', 'used_with_issue', 'missing'];

export interface AnswerCheckPart {
  /** "① 就是…吧" — the task's own marker + structure. */
  label: string;
  status: AnswerCheckPartStatus;
  /** One short line: what they said for it / what is missing. */
  note?: string;
}

export interface AnswerCheckAlternative {
  hanzi: string;
  pinyin?: string;
  english?: string;
}

export interface AnswerCheck {
  verdict: AnswerCheckVerdict;
  /** One short line: what the verdict means for THIS answer. */
  headline: string;
  /** The learner's own sentence minimally fixed; '' when nothing needs fixing. */
  corrected: string;
  /** Pinyin of `corrected` (the app's pinyin path, with the 一 / 不 tone changes); '' when none. */
  corrected_pinyin: string;
  /** ≤ 3 short tips. */
  tips: AnswerCheckTip[];
  /** A natural / idiomatic way to say it, when it adds something. */
  alternative?: AnswerCheckAlternative;
  /** The button to pre-select. */
  suggested: AnswerCheckSuggestion;
  /** Speaking: what they meant — the transcript without false starts, fillers, asides and repeats. */
  cleaned?: string;
  cleaned_pinyin?: string;
  /** Speaking: the task's parts, in the task's order. */
  parts?: AnswerCheckPart[];
}

/** What is checked. */
export interface AnswerCheckInput {
  /** The English the learner had to say in Chinese (or the sentence they heard, for listening). */
  prompt_en: string;
  model_answer: string;
  model_pinyin?: string;
  /** The learner's answer. */
  answer: string;
  exercise_type: string;
  /** How the answer was given: spoken = a speech-recognition transcript (homophones / punctuation lenient). */
  input?: 'spoken' | 'edited' | 'typed';
  /** The lesson's title / grammar point, so the tips stay on topic. */
  focus?: string;
  /** Speaking: the task's "Useful words" (hanzi). */
  hints?: string[];
  /** Speaking: the question played in Chinese, when there is one. */
  question_audio?: string;
}

/**
 * A read card's take (shared/study/readTakeCheck.ts): he READ the card's Chinese aloud — model = the card's
 * hanzi, answer = the transcript; did he read it right (a same-meaning word = almost, never wrong).
 */
export const READ_ALOUD_CHECK_TYPE = 'read_aloud';

/**
 * A word order (scramble) he built that is neither the correct order nor an accepted alternative
 * (shared/lesson/scrambleCheck.ts): the answer / model answer are the tiles joined with spaces.
 */
export const SCRAMBLE_CHECK_TYPE = 'scramble';

/** Bump when the word-order prompt or its shape changes (its cache texts start `o<version>`). */
export const SCRAMBLE_CHECK_VERSION = 1;

export function isScrambleCheck(exerciseType: string | null | undefined): boolean {
  return exerciseType === SCRAMBLE_CHECK_TYPE;
}

/** Exercise types whose answer gets the check (sentence_making has its own, POST /api/lessons/sentence-feedback). */
export const ANSWER_CHECK_TYPES: readonly string[] = ['translate', 'listen_translate', READ_ALOUD_CHECK_TYPE, SCRAMBLE_CHECK_TYPE];

export function isReadAloudCheck(exerciseType: string | null | undefined): boolean {
  return exerciseType === READ_ALOUD_CHECK_TYPE;
}

/** Free speaking: the recording's transcript is checked (model answer = only "one way to say it"). */
export const SPEAKING_CHECK_TYPES: readonly string[] = ['oral_expression', 'speak'];

/**
 * Bump when the meaning-check prompt changes (Sentences by ear; its cache texts start `m<version>`).
 * 3 (Nov 2026): he / she / it (tā), an unmarked tense and number are never faults by ear (shared/lesson/heardCheck.ts).
 */
export const MEANING_CHECK_VERSION = 3;

/** Bump when the speaking prompt or its shape changes (its cache texts start `s<version>`). */
export const SPEAKING_CHECK_VERSION = 1;

export function isSpeakingCheckType(exerciseType: string | null | undefined): boolean {
  return SPEAKING_CHECK_TYPES.includes(exerciseType ?? '');
}

export const ANSWER_CHECK_LIMITS = {
  prompt: 400, model: 300, answer: 300, focus: 200, tip: 220, quote: 60, headline: 160, alternative: 200,
  /** A minute or two of speech, said with fillers and restarts. */
  speech: 1500, speechPrompt: 1000, hint: 40, hints: 12, question: 200, part: 80, partNote: 160, parts: 8, speakingTips: 4,
} as const;

/** The longest answer an exercise type takes. */
export function answerLimitFor(exerciseType: string | null | undefined): number {
  return isSpeakingCheckType(exerciseType) ? ANSWER_CHECK_LIMITS.speech : ANSWER_CHECK_LIMITS.answer;
}

const HAN = /\p{Script=Han}/u;

/** Does the text contain Chinese characters? */
export function hasHan(text: string): boolean {
  return HAN.test(text);
}

/**
 * A MEANING check (Hard mode's "Sentences by ear", shared/study/sentenceRound.ts `listenCheckInput`): he
 * heard a Chinese sentence (`prompt_en` holds that Chinese) and gave its meaning in English; the model
 * answer is the sentence's English. listen_translate with no Chinese in the model answer nor in his answer,
 * and letters to read. A lesson's listen_translate (a Chinese model answer) never is one.
 */
export function isMeaningCheck(input: Pick<AnswerCheckInput, 'exercise_type' | 'answer' | 'model_answer'>): boolean {
  if (input.exercise_type !== 'listen_translate') return false;
  const answer = input.answer ?? '';
  return !hasHan(input.model_answer ?? '') && !hasHan(answer) && /\p{L}/u.test(answer) && /\p{L}/u.test(input.model_answer ?? '');
}

/** English compared for a meaning check: lower case, letters and digits only, single spaces. */
export function meaningAnswerText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Does this exercise's answer get Claude's check? Only an answer in Chinese (a listening answer in English is not). */
export function answerCheckApplies(exerciseType: string, answer: string | null | undefined): boolean {
  if (!ANSWER_CHECK_TYPES.includes(exerciseType) && !isSpeakingCheckType(exerciseType)) return false;
  const a = (answer ?? '').trim();
  return a.length > 0 && hasHan(a) && normalizeHanziAnswer(a).length > 0;
}

/** Whitespace collapsed (display text keeps its full-width punctuation). */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A Chinese text as compared: digits as numerals (3块 = 三块), whitespace / punctuation dropped. */
export function checkKey(s: string): string {
  return normalizeHanziAnswer(digitsToHanzi(s.normalize('NFKC')));
}

/**
 * The text a check is cached by (server: SHA-256 of it; device: the text itself). Answers that
 * differ only in punctuation / spacing share a check; a spoken answer is checked differently from
 * a typed one (leniency), so the input mode is part of it.
 */
export function answerCheckCacheText(input: AnswerCheckInput): string {
  if (isSpeakingCheckType(input.exercise_type)) {
    return [
      `s${SPEAKING_CHECK_VERSION}`,
      input.exercise_type,
      collapse(input.prompt_en.normalize('NFKC')).toLowerCase(),
      normalizeHanziAnswer(input.model_answer),
      normalizeHanziAnswer(input.answer),
      collapse((input.focus ?? '').normalize('NFKC')).toLowerCase(),
      (input.hints ?? []).map((h) => normalizeHanziAnswer(h)).filter(Boolean).join(','),
      normalizeHanziAnswer(input.question_audio ?? ''),
    ].join('|');
  }
  if (isScrambleCheck(input.exercise_type)) {
    // A word order: the English and the two orders (the tiles' spaces aside) — no input mode, no focus.
    return [
      `o${SCRAMBLE_CHECK_VERSION}`,
      input.exercise_type,
      collapse(input.prompt_en.normalize('NFKC')).toLowerCase(),
      normalizeHanziAnswer(input.model_answer),
      normalizeHanziAnswer(input.answer),
    ].join('|');
  }
  const mode = input.input === 'spoken' ? 'spoken' : 'typed';
  if (isMeaningCheck(input)) {
    // A meaning check: the Chinese heard, the English model and his English (case / punctuation aside).
    return [
      `m${MEANING_CHECK_VERSION}`,
      input.exercise_type,
      mode,
      normalizeHanziAnswer(input.prompt_en),
      meaningAnswerText(input.model_answer),
      meaningAnswerText(input.answer),
    ].join('|');
  }
  return [
    `v${ANSWER_CHECK_VERSION}`,
    input.exercise_type,
    mode,
    collapse(input.prompt_en.normalize('NFKC')).toLowerCase(),
    checkKey(input.model_answer),
    checkKey(input.answer),
    collapse((input.focus ?? '').normalize('NFKC')).toLowerCase(),
  ].join('|');
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? collapse(v).slice(0, max) : '');

// ============ Sanity rules (Nov 2026) ============
//
// Rules the model can't break, on top of the shape: Jerome said "因为这个问题，我睡不着觉" (the model answer was
// 我因为这个问题睡不着觉) and got "✓ Also right — Correct meaning, but 因为 clause should come before the subject"
// with the tip "因为这个问题 我睡不着觉 reads more naturally than 因为这个问题 我睡不着觉": the model mixed up the two
// answers and criticised him for what he already did. A tip that compares a text with itself, or recommends what he
// already said, is dropped; a right answer that IS the model answer gets no tips; a right verdict whose "but" headline
// lost all its tips gets a plain positive one.

/** The plain headline of a right answer whose critique the sanity rules removed. */
export const PLAIN_CORRECT_HEADLINE = 'Natural and right — nicely said.';
export const PLAIN_ACCEPTABLE_HEADLINE = 'Different wording, same meaning — that works.';

// English words matched with explicit ASCII edges (never `\b`), so the Lab's Java regexes agree character for character.
const W = (words: string) => `(?<![A-Za-z0-9_])(?:${words})(?![A-Za-z0-9_])`;
/** A headline that criticises ("…, but …", "should"). */
const CRITIQUE = new RegExp(W('but|however|though|although|should|instead'), 'i');
/** A line that compares two texts. */
const COMPARES = new RegExp(`${W('than|instead|rather|vs|versus|not')}|→|->|⇒`, 'i');
/** Words right before a recommended text ("Use X", "→ X"). */
const RECOMMEND_BEFORE = new RegExp(`(?:→|->|⇒|${W('use|say|try|write|prefer|better|instead')})[ :："'“”‘’(（]*$`, 'i');
/** Words right after a recommended text ("X reads more naturally", "X is better"). */
const RECOMMEND_AFTER = new RegExp(`^[ "'“”‘’)）]*(?:reads|sounds|is|would be|works|feels) +${W('more|better|nicer|preferred')}`, 'i');
/** A stretch of Chinese in an English line: Han characters, spaces / Chinese punctuation between them kept in. */
const HAN_SPAN = /\p{Script=Han}(?:[\p{Script=Han} ，。、！？；：]*\p{Script=Han})?/gu;

export interface HanSpan { start: number; end: number; norm: string }

/** The Chinese stretches of a line (2+ characters once normalised), in order; `start` / `end` in UTF-16 units. */
export function chineseSpans(text: string): HanSpan[] {
  const out: HanSpan[] = [];
  for (const m of text.matchAll(HAN_SPAN)) {
    const norm = normalizeHanziAnswer(m[0]);
    if (Array.from(norm).length >= 2) out.push({ start: m.index!, end: m.index! + m[0].length, norm });
  }
  return out;
}

/** "X reads better than X": a line comparing a Chinese text with itself. */
export function comparesIdenticalTexts(text: string): boolean {
  if (!COMPARES.test(text)) return false;
  const spans = chineseSpans(text);
  return spans.some((a, i) => spans.slice(i + 1).some((b) => b.norm === a.norm));
}

/** Does the line recommend `mine` (his own whole answer, normalised) — "Use X", "→ X", "X reads more naturally"? */
export function recommendsText(text: string, mine: string): boolean {
  if (Array.from(mine).length < 2) return false;
  return chineseSpans(text).some((s) => s.norm === mine
    && (RECOMMEND_BEFORE.test(text.slice(0, s.start)) || RECOMMEND_AFTER.test(text.slice(s.end))));
}

/** Does the line write out his whole answer (normalised)? */
function quotesWholeAnswer(text: string, mine: string): boolean {
  return Array.from(mine).length >= 2 && chineseSpans(text).some((s) => s.norm === mine);
}

/**
 * Is this tip one to drop? (`good` = the verdict is correct / acceptable; `mine` = his answer normalised;
 * `sameAsModel` = his answer IS the model answer.) A right answer that is the model answer gets no tips; any tip
 * comparing a text with itself or recommending what he already said goes; on a right answer, so does a tip that
 * writes out his whole sentence (praise, or the model confusing the two answers).
 */
export function insaneTip(tip: { text: string; fix?: string }, good: boolean, mine: string, sameAsModel: boolean): boolean {
  if (good && sameAsModel) return true;
  if (comparesIdenticalTexts(tip.text)) return true;
  if (recommendsText(tip.text, mine)) return true;
  if (tip.fix && Array.from(mine).length >= 2 && checkKey(tip.fix) === mine) return true;
  if (good && quotesWholeAnswer(tip.text, mine)) return true;
  return false;
}

/**
 * The headline after the sanity rules: a right verdict keeps its own unless it compares a text with itself /
 * recommends his own answer, or it criticises ("but", "should") and every tip behind the criticism was dropped —
 * then the plain positive line. Almost / wrong keep theirs.
 */
export function saneHeadline(headline: string, verdict: AnswerCheckVerdict, mine: string, dropped: number, tipsLeft: number, speaking = false): string {
  if (verdict !== 'correct' && verdict !== 'acceptable') return headline;
  const plain = verdict === 'correct' || speaking ? PLAIN_CORRECT_HEADLINE : PLAIN_ACCEPTABLE_HEADLINE;
  if (comparesIdenticalTexts(headline) || recommendsText(headline, mine)) return plain;
  if (dropped > 0 && tipsLeft === 0 && CRITIQUE.test(headline)) return plain;
  return headline;
}

// ============ Coherence rules (Nov 2026) ============
//
// Jerome said 这个牛角包 3块多元 for "This croissant was just over three yuan." (model 这个牛角包三块多钱). "~ Almost" was right
// — 块 and 元 are two units stacked — but the check said "Use 钱 or 块 alone, not both together" over a corrected line
// 这个牛角包3块多钱 that has both, and its tip offered "…or just 元 alone (块多元)" — his own wrong form — as a fix. On an
// almost / wrong check: a tip recommending (part of) what he got wrong, or telling him to avoid what the corrected line
// itself uses, is dropped; such a headline becomes a neutral one.

export const NEUTRAL_ALMOST_HEADLINE = 'Nearly — compare with the corrected version.';
export const NEUTRAL_WRONG_HEADLINE = 'Not quite — compare with the corrected version.';
export const NEUTRAL_ALMOST_NO_FIX_HEADLINE = 'Nearly — one thing to fix.';
export const NEUTRAL_WRONG_NO_FIX_HEADLINE = 'Not quite — have another go.';

/** The neutral headline of an almost / wrong check whose own headline contradicted it. */
export function neutralHeadline(verdict: AnswerCheckVerdict, hasFix: boolean): string {
  if (verdict === 'wrong') return hasFix ? NEUTRAL_WRONG_HEADLINE : NEUTRAL_WRONG_NO_FIX_HEADLINE;
  return hasFix ? NEUTRAL_ALMOST_HEADLINE : NEUTRAL_ALMOST_NO_FIX_HEADLINE;
}

/** Words that say what to use (positive) or not to use (negative); the last one before a text decides. */
const CUES = new RegExp(
  `→|->|⇒|${W("instead of|rather than|do not|don't|don’t|not|never|avoid|without|than|use|say|try|write|prefer|better|just|or|instead|should be|becomes")}`,
  'gi',
);
const NEGATIVE_CUE = new RegExp(`^(?:${["instead of", 'rather than', 'do not', "don't", 'don’t', 'not', 'never', 'avoid', 'without', 'than'].join('|')})$`, 'i');
/** Where a clause ends (a recommendation never reaches past it). */
const CLAUSE_END = /[.;:!?。；：！？]/;
/** "not both", "both together", "can't combine…" */
const NOT_BOTH = new RegExp(W("not both|never both|both together|not together|do not combine|don't combine|don’t combine|never combine|can't combine|can’t combine|cannot combine"), 'i');
/** "avoid X", "don't use X", "drop X" right before a Chinese text. */
const AVOID_BEFORE = new RegExp(`${W("avoid|do not use|don't use|don’t use|never use|drop|remove")}[ :："'“”‘’(（]*$`, 'i');
const HAN_RUN = /\p{Script=Han}+/gu;

/** Is the text at `start` recommended — the last cue word in its clause says use / say / try / or / → (not "not", "instead of")? */
export function recommendedAt(text: string, start: number): boolean {
  let from = 0;
  for (let i = start - 1; i >= 0; i--) {
    if (CLAUSE_END.test(text[i])) {
      from = i + 1;
      break;
    }
  }
  let last: string | null = null;
  for (const m of text.slice(from, start).matchAll(CUES)) last = m[0];
  return last !== null && !NEGATIVE_CUE.test(last);
}

/**
 * A line offering (part of) his own wrong answer as the thing to say: a Chinese text (2+ characters) recommended by its
 * clause that is in his answer but neither in the corrected line nor in the model answer (keys from `checkKey`).
 */
export function recommendsWrongForm(text: string, mine: string, corrected: string, model: string): boolean {
  return chineseSpans(text).some((s) => mine.includes(s.norm) && !corrected.includes(s.norm) && !model.includes(s.norm) && recommendedAt(text, s.start));
}

/**
 * A line telling him to avoid what the corrected line itself uses: "not both" / "both together" after 2+ Chinese texts
 * that are ALL in the corrected line ("Use 钱 or 块 alone, not both together" over 三块多钱), or "avoid / don't use X" where
 * X (2+ characters) is in it. `corrected` = its key ('' = nothing to contradict).
 */
export function forbidsCorrected(text: string, corrected: string): boolean {
  if (!corrected) return false;
  const both = NOT_BOTH.exec(text);
  if (both) {
    const items = [...new Set(Array.from(text.slice(0, both.index).matchAll(HAN_RUN), (m) => normalizeHanziAnswer(m[0])).filter(Boolean))];
    if (items.length >= 2 && items.every((i) => corrected.includes(i))) return true;
  }
  return chineseSpans(text).some((s) => corrected.includes(s.norm) && AVOID_BEFORE.test(text.slice(0, s.start)));
}

/** A line of an almost / wrong check that contradicts the check itself. */
export function incoherentLine(text: string, mine: string, corrected: string, model: string): boolean {
  return recommendsWrongForm(text, mine, corrected, model) || forbidsCorrected(text, corrected);
}

/** Request body → input, or the problems (400). */
export function pickAnswerCheckInput(raw: unknown): { input: AnswerCheckInput } | { problems: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = ANSWER_CHECK_LIMITS;
  const exerciseType = str(r.exercise_type, 40) || 'translate';
  const speaking = isSpeakingCheckType(exerciseType);
  const input: AnswerCheckInput = {
    prompt_en: str(r.prompt_en, speaking ? L.speechPrompt : L.prompt),
    model_answer: str(r.model_answer, L.model),
    model_pinyin: str(r.model_pinyin, L.model * 3) || undefined,
    answer: str(r.answer, answerLimitFor(exerciseType)),
    exercise_type: exerciseType,
    input: r.input === 'spoken' || r.input === 'edited' || r.input === 'typed' ? r.input : undefined,
    focus: str(r.focus, L.focus) || undefined,
  };
  if (speaking) {
    const hints = (Array.isArray(r.hints) ? r.hints : []).map((h) => str(h, L.hint)).filter(Boolean).slice(0, L.hints);
    if (hints.length) input.hints = hints;
    const questionAudio = str(r.question_audio, L.question);
    if (questionAudio) input.question_audio = questionAudio;
  }
  const problems: string[] = [];
  if (!input.prompt_en) problems.push('prompt_en is required');
  if (!input.model_answer && !speaking) problems.push('model_answer is required');
  if (!input.answer) problems.push('answer is required');
  else if (!hasHan(input.answer) && !isMeaningCheck(input)) problems.push('answer has no Chinese to check');
  return problems.length ? { problems } : { input };
}

/** Correct / acceptable → Got it; almost / wrong → Missed it. */
export function suggestedFor(verdict: AnswerCheckVerdict): AnswerCheckSuggestion {
  return verdict === 'correct' || verdict === 'acceptable' ? 'got_it' : 'missed_it';
}

/** The headline of an answer that IS the model answer (no model call). */
export const EXACT_ANSWER_HEADLINE = 'Exactly right — nice!';

/**
 * The check of an answer that IS the model answer, made on the device with no model call: the
 * same rule as the "✓ Exact match" chip under "You said" (`isExactHanziMatch`: whitespace and
 * sentence punctuation ignored), so the chip and the skipped call always agree. Correct, Got it,
 * nothing to fix. Null when the check doesn't apply or the answer differs (→ ask Claude). The
 * apps show it at once (offline too); the worker answers it the same way without a call.
 */
export function exactAnswerCheck(input: Pick<AnswerCheckInput, 'exercise_type' | 'answer' | 'model_answer'>): AnswerCheck | null {
  // A meaning check: his English IS the sentence's English (case, punctuation and spacing aside).
  if (isMeaningCheck(input)) {
    const mine = meaningAnswerText(input.answer);
    if (!mine || mine !== meaningAnswerText(input.model_answer)) return null;
    return { verdict: 'correct', headline: EXACT_ANSWER_HEADLINE, corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' };
  }
  if (!answerCheckApplies(input.exercise_type, input.answer)) return null;
  // Free speaking has no single right answer: its model answer is only "one way to say it".
  if (isSpeakingCheckType(input.exercise_type)) return null;
  if (!isExactHanziMatch(input.answer, input.model_answer)) return null;
  return { verdict: 'correct', headline: EXACT_ANSWER_HEADLINE, corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' };
}

export type AnswerCheckTone = 'good' | 'warn' | 'bad';

/** The verdict chip (`speaking`: a free-speaking check — there is no single right answer to be "also" right next to). */
export function answerCheckChip(verdict: AnswerCheckVerdict, speaking = false): { label: string; tone: AnswerCheckTone } {
  switch (verdict) {
    case 'correct': return { label: speaking ? '✓ Well said' : '✓ Correct', tone: 'good' };
    case 'acceptable': return { label: speaking ? '✓ Good' : '✓ Also right', tone: 'good' };
    case 'almost': return { label: '~ Almost', tone: 'warn' };
    case 'wrong': return { label: '✗ Not quite', tone: 'bad' };
  }
}

/**
 * A check from the model (or the network / a cache) reduced to the known shape. Throws when the
 * essentials are missing (the worker retries). Rules the model can't break:
 * - correct / acceptable never carry a correction;
 * - a "correction" that changes no character is dropped;
 * - a quote must contain Chinese; an alternative must be Chinese and say something new;
 * - `suggested` follows the verdict;
 * - the sanity rules (`insaneTip`, `saneHeadline`): no tip comparing a text with itself or recommending what he
 *   already said, no tips on a right answer that IS the model answer (`model`, when given), no "but" headline left
 *   with nothing behind it.
 */
export function normalizeAnswerCheck(raw: unknown, answer: string, model?: string | null): AnswerCheck {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = ANSWER_CHECK_LIMITS;
  const verdict = (ANSWER_CHECK_VERDICTS as readonly unknown[]).includes(r.verdict) ? r.verdict as AnswerCheckVerdict : null;
  const headline = str(r.headline, L.headline);
  if (!verdict || !headline) throw new Error('Invalid answer check');
  const mine = checkKey(answer);
  // A speaking check is the one with `cleaned` (what they meant): its "cleaner version" may fix an
  // acceptable answer too, and it is compared with what they meant, not the raw transcript.
  const cleanedRaw = str(r.cleaned, L.speech);
  const speaking = !!cleanedRaw && hasHan(cleanedRaw);
  const meant = speaking ? checkKey(cleanedRaw) : mine;
  const noFix = verdict === 'correct' || (verdict === 'acceptable' && !speaking);
  let corrected = noFix ? '' : str(r.corrected, speaking ? L.speech : L.answer * 2);
  if (corrected && (!hasHan(corrected) || checkKey(corrected) === mine || checkKey(corrected) === meant)) corrected = '';
  const correctedPinyin = corrected ? str(r.corrected_pinyin, (speaking ? L.speech : L.answer) * 6) : '';
  const good = verdict === 'correct' || verdict === 'acceptable';
  const sameAsModel = !!model && !!mine && checkKey(model) === mine;
  // Almost / wrong: no line may offer his wrong form or forbid what the corrected line uses (coherence rules).
  const bad = verdict === 'almost' || verdict === 'wrong';
  const correctedKey = checkKey(corrected);
  const modelKey = model ? checkKey(model) : '';
  const incoherent = (line: string) => bad && !speaking && incoherentLine(line, mine, correctedKey, modelKey);
  let dropped = 0;
  const tips: AnswerCheckTip[] = [];
  for (const t of Array.isArray(r.tips) ? r.tips : []) {
    const o = (t && typeof t === 'object' ? t : { text: t }) as Record<string, unknown>;
    const text = str(o.text, L.tip);
    if (!text) continue;
    if (insaneTip({ text, fix: str(o.fix, L.alternative) }, good, mine, sameAsModel) || incoherent(text)) {
      dropped++;
      continue;
    }
    const quote = str(o.quote, L.quote);
    const tip: AnswerCheckTip = quote && hasHan(quote) ? { text, quote } : { text };
    const fix = str(o.fix, L.alternative);
    if (fix && hasHan(fix) && normalizeHanziAnswer(fix) !== normalizeHanziAnswer(quote)) {
      tip.fix = fix;
      const fp = str(o.fix_pinyin, L.alternative * 6);
      if (fp) tip.fix_pinyin = fp;
    }
    tips.push(tip);
    if (tips.length === (speaking ? L.speakingTips : 3)) break;
  }
  let alternative: AnswerCheckAlternative | undefined;
  const a = (r.alternative && typeof r.alternative === 'object' ? r.alternative : null) as Record<string, unknown> | null;
  const altHanzi = a ? str(a.hanzi, L.alternative) : '';
  if (altHanzi && hasHan(altHanzi)) {
    const n = checkKey(altHanzi);
    if (n !== mine && n !== correctedKey) {
      alternative = { hanzi: altHanzi };
      const p = str(a!.pinyin, L.alternative * 6);
      const e = str(a!.english, L.alternative);
      if (p) alternative.pinyin = p;
      if (e) alternative.english = e;
    }
  }
  const saneHead = incoherent(headline) ? neutralHeadline(verdict, !!corrected) : saneHeadline(headline, verdict, mine, dropped, tips.length, speaking);
  const out: AnswerCheck = { verdict, headline: saneHead, corrected, corrected_pinyin: correctedPinyin, tips, suggested: suggestedFor(verdict) };
  if (alternative) out.alternative = alternative;
  if (speaking) {
    out.cleaned = cleanedRaw;
    const cp = str(r.cleaned_pinyin, L.speech * 6);
    if (cp) out.cleaned_pinyin = cp;
    const parts: AnswerCheckPart[] = [];
    for (const p of Array.isArray(r.parts) ? r.parts : []) {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const label = str(o.label, L.part);
      const status = (ANSWER_CHECK_PART_STATUSES as readonly unknown[]).includes(o.status) ? o.status as AnswerCheckPartStatus : null;
      if (!label || !status) continue;
      const note = str(o.note, L.partNote);
      parts.push(note ? { label, status, note } : { label, status });
      if (parts.length === L.parts) break;
    }
    out.parts = parts;
  }
  return out;
}

/** The text shown as "A cleaner version": the correction, else what they meant ('' when neither). */
export function cleanerVersion(check: AnswerCheck): { hanzi: string; pinyin: string; diffFrom: string | null } {
  if (check.corrected) return { hanzi: check.corrected, pinyin: check.corrected_pinyin, diffFrom: check.cleaned || null };
  if (check.cleaned) return { hanzi: check.cleaned, pinyin: check.cleaned_pinyin ?? '', diffFrom: null };
  return { hanzi: '', pinyin: '', diffFrom: null };
}

/** A part's mark: ✓ used, ~ used with a slip, ✗ missing. */
export function speakingPartMark(status: AnswerCheckPartStatus): { icon: string; tone: AnswerCheckTone } {
  switch (status) {
    case 'used': return { icon: '✓', tone: 'good' };
    case 'used_with_issue': return { icon: '~', tone: 'warn' };
    case 'missing': return { icon: '✗', tone: 'bad' };
  }
}

export interface SpeakingTaskPart {
  /** ① ② ③ … as written in the task. */
  marker: string;
  /** The structure / ask after the marker: "就是…吧". */
  structure: string;
  /** What that part asks for, when the marker sits in brackets after it: "Guess who she is". */
  description: string;
}

const CIRCLED = /[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]/;
const OPEN_PARENS = ['(', '（'];
const CLOSE_PARENS = [')', '）'];
const lastIndexOfAny = (s: string, chars: string[]) => Math.max(...chars.map((c) => s.lastIndexOf(c)));
const firstIndexOfAny = (s: string, chars: string[]) => {
  const found = chars.map((c) => s.indexOf(c)).filter((i) => i >= 0);
  return found.length ? Math.min(...found) : -1;
};
const trimPart = (s: string) => collapse(s).replace(/^[,，;；:：、.。\s]+/, '').replace(/[,，;；:：、.。\s]+$/, '');

/**
 * The task's numbered parts (① ② ③…) — "Guess who she is (① 就是…吧), tell her where two places
 * are (② 就在)…" → [{ marker: '①', structure: '就是…吧', description: 'Guess who she is' }, …].
 * A marker inside brackets takes the bracket's text as the structure and the clause before the
 * bracket as the description; otherwise the text up to the next marker. [] when unnumbered.
 */
export function speakingTaskParts(prompt: string | null | undefined): SpeakingTaskPart[] {
  const text = (prompt ?? '').normalize('NFC');
  const marks: number[] = [];
  for (let i = 0; i < text.length; i++) if (CIRCLED.test(text[i])) marks.push(i);
  const out: SpeakingTaskPart[] = [];
  let prevEnd = 0;
  marks.forEach((at, k) => {
    const next = k + 1 < marks.length ? marks[k + 1] : text.length;
    const marker = text[at];
    const before = text.slice(0, at);
    const openAt = lastIndexOfAny(before, OPEN_PARENS);
    const inParen = openAt >= 0 && openAt > lastIndexOfAny(before, CLOSE_PARENS) && text.slice(openAt + 1, at).trim() === '';
    const seg = text.slice(at + 1, next);
    let structure: string;
    let description = '';
    if (inParen) {
      const close = firstIndexOfAny(seg, CLOSE_PARENS);
      structure = close >= 0 ? seg.slice(0, close) : seg;
      const clause = text.slice(Math.min(prevEnd, openAt), openAt);
      const pieces = clause.split(/[.。:：;；!?！？]/);
      description = trimPart(pieces[pieces.length - 1]).replace(/^(and|then|also)(\s+|$)/i, '');
      prevEnd = close >= 0 ? at + 1 + close + 1 : next;
    } else {
      structure = seg.replace(/\s+(and|then)\s*$/i, '');
      prevEnd = next;
    }
    structure = trimPart(structure).slice(0, 60);
    if (structure && !out.some((p) => p.marker === marker)) out.push({ marker, structure, description: description.slice(0, 120) });
  });
  return out;
}

/** Lenient parse of a stored / cached / received check: null when it isn't one. */
export function parseAnswerCheck(raw: unknown, answer: string, model?: string | null): AnswerCheck | null {
  try {
    return normalizeAnswerCheck(raw, answer, model);
  } catch {
    return null;
  }
}

export interface TipSegment {
  text: string;
  /** Chinese: tappable into the language explorer (a quote as one word, other Chinese by character). */
  han: boolean;
  /** This is the tip's quote (shown marked). */
  quote: boolean;
}

/**
 * A tip's text cut into segments that concatenate to it exactly: each occurrence of the quote is
 * ONE segment (so a tap opens it as a word), every other Chinese character its own segment, the
 * rest plain. `quoteInText` says whether the quote appeared (else the apps show it before the text).
 */
export function tipSegments(tip: AnswerCheckTip): { segments: TipSegment[]; quoteInText: boolean } {
  const segments: TipSegment[] = [];
  const quote = tip.quote ?? '';
  const pushPlainOrHan = (part: string) => {
    for (const ch of Array.from(part)) {
      const han = HAN.test(ch);
      const last = segments[segments.length - 1];
      if (!han && last && !last.han && !last.quote) last.text += ch;
      else segments.push({ text: ch, han, quote: false });
    }
  };
  let rest = tip.text;
  let quoteInText = false;
  while (quote && rest.includes(quote)) {
    const at = rest.indexOf(quote);
    pushPlainOrHan(rest.slice(0, at));
    segments.push({ text: quote, han: true, quote: true });
    quoteInText = true;
    rest = rest.slice(at + quote.length);
  }
  pushPlainOrHan(rest);
  return { segments, quoteInText };
}

/** 💬 Ask about this: the one-tap questions offered before anything is asked. */
export function askQuickQuestions(verdict: AnswerCheckVerdict | null | undefined, exerciseType?: string | null): string[] {
  if (isSpeakingCheckType(exerciseType)) return ['How could I say it more naturally?', 'Explain the grammar', 'What did I leave out?'];
  return verdict === 'correct' || verdict === 'acceptable'
    ? ['Why does mine work?', 'How is it different from the model?', 'Other ways to say it?']
    : ['Why is mine wrong?', 'Explain the grammar', 'Other ways to say it?'];
}

/** One answer given to an exercise (the attempt keeps every try). */
export interface AnswerTry {
  text: string;
  input?: 'spoken' | 'edited' | 'typed';
  check?: AnswerCheck;
}

/** Claude's corrected line as shown: digits as Chinese numerals (a spoken 3块 → 三块), so its red-pen diff and pinyin agree. */
export function correctedDisplay(corrected: string): string {
  return digitsToHanzi(corrected);
}

const PINYIN_PUNCT: Record<string, string> = { '，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '；': ';', '：': ':' };

/**
 * A line's pinyin from its word segments (the device segmenter, shared/chinese/segment.ts): one space between words, none
 * inside one (zhège niújiǎobāo sānkuài duō qián), Chinese punctuation as its ASCII mark, nothing for anything else.
 * '' when a Han word has no pinyin (the server's line is shown instead).
 */
export function wordsPinyinLine(words: ReadonlyArray<{ text: string; pinyin?: string | null }>): string {
  let out = '';
  for (const w of words) {
    if (hasHan(w.text)) {
      const p = (w.pinyin ?? '').replace(/\s+/g, '');
      if (!p) return '';
      out += (out && !/[\s(“]$/.test(out) ? ' ' : '') + p;
    } else {
      for (const ch of Array.from(w.text)) {
        const mark = PINYIN_PUNCT[ch] ?? (/[,.!?;:]/.test(ch) ? ch : '');
        if (mark) out += mark;
      }
    }
  }
  return out.trim();
}
