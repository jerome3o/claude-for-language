/**
 * "Which sentence is wrong?" multiple choice — never read the mistake aloud.
 *
 * Jerome (Nov 2026): "Some of the questions have multi-choice, pick which answer is wrong questions. On those
 * questions, it reads out the audio of the incorrect version of the sentence. I think it should actually read out the
 * correct version instead." In such a `choice` the option marked as the answer IS the wrong sentence, so the player's
 * ▶ / autoplay / 🎤 Say it again / the lesson audio prefetch must speak its CORRECTION instead — never the mistake as
 * a model (the rule `judge` already follows: `judgeSpokenText`).
 *
 * - Detection (`choiceAsksForWrong`): the spec's own `correction` is the explicit marker; otherwise the question,
 *   English or Chinese ("Which sentence is wrong / incorrect / has a mistake?", "Find the error", "哪个句子是错的",
 *   "找出病句"), conservatively — "which has NO mistake", "which is correct", comprehension questions ("…according to
 *   the dialogue") are not.
 * - New lessons carry `correction` (doc.ts tells authors; `choiceCorrectionWarnings` flags one without it).
 * - Older lessons: the device asks `POST /api/lessons/choice-correction` once (cached for everyone by
 *   `choiceCorrectionCacheText`); offline with nothing cached the wrong option simply has no ▶.
 *
 * Pure; the Lab app's core `ChoiceMistake.kt` is parity-tested against it (android-lab/parity/fixtures/choice-mistake.ts).
 */
import type { ChoiceExerciseSpec, CustomLessonSpec, LessonSentence } from './types';

/** Bump when the correction prompt / shape changes (the server cache row's version). */
export const CHOICE_CORRECTION_VERSION = 1;

/** One clause: never across a sentence end or a line break. */
const CLAUSE = '[^.?!。？！\\n]';
/** ASCII word edges (not `\b`: JS and Java disagree on a Han character next to a Latin one — "用了incorrectly"). */
const WB = '(?<![A-Za-z0-9_])';
const WE = '(?![A-Za-z0-9_])';
const WRONG_EN = `(?:wrong(?:ly)?|incorrect(?:ly)?|not\\s+(?:correct|right|grammatical|natural)|(?:is|are)n['’]t\\s+(?:correct|right|grammatical|natural)|ungrammatical|unnatural|mistakes?|errors?|mistaken)`;
const ZH_WRONG = '(?:错|不对|不正确|有问题|有毛病|语病|病句|不通|不自然|不合适|不恰当)';

/** Patterns that ask for the WRONG option. */
const ASKS_WRONG: RegExp[] = [
  // Which (sentence / one / of these) is wrong / has a mistake / uses 了 incorrectly?
  new RegExp(`${WB}which${WE}${CLAUSE}{0,60}?${WB}${WRONG_EN}${WE}`, 'i'),
  // Find / spot / pick / choose the wrong sentence · the mistake · the error.
  new RegExp(`${WB}(?:find|spot|pick|choose|select|identify|tap|mark)${WE}${CLAUSE}{0,40}?${WB}${WRONG_EN}${WE}`, 'i'),
  // 哪个 / 哪句 / 哪一项 … 错 / 不对 / 有问题 / 病句
  new RegExp(`哪一?(?:个|句|项|条|段|些)${CLAUSE}{0,12}?${ZH_WRONG}`),
  // 找出 / 选出 / 指出 … 错 / 病句
  new RegExp(`(?:找出|选出|指出|挑出)${CLAUSE}{0,8}?${ZH_WRONG}`),
];

/** Patterns that mean it is NOT asking for a mistake (checked first; conservative). */
const NOT_WRONG: RegExp[] = [
  // Which has NO mistake / is not wrong / nothing wrong / error-free.
  new RegExp(`${WB}(?:no|without|free\\s+of|nothing|not)\\s+(?:an?\\s+|any\\s+)?(?:mistakes?|errors?|wrong)${WE}`, 'i'),
  new RegExp(`${WB}error-free${WE}`, 'i'),
  // The question asks for the RIGHT one (and maybe mentions that one has a mistake).
  new RegExp(`${WB}(?<!not\\s)(?:correct|right|natural|grammatical)\\s+(?:one|sentence|option|answer|version|choice)${WE}`, 'i'),
  // Comprehension: a statement that is "wrong" about the text, not wrong Chinese.
  new RegExp(`${WB}according\\s+to${WE}|${WB}based\\s+on${WE}|${WB}in\\s+the\\s+(?:text|dialogue|story|passage|conversation|audio|reading|article)${WE}`, 'i'),
  /根据|对话中|短文|课文|文章/,
  // 没有错误 / 没错 / 无误 / 不错 ("good").
  /没有?(?:错|问题|毛病|语病)|无误|不错/,
  // 哪个是正确的 / 选出正确的.
  /哪一?(?:个|句|项|条)(?:句子|说法|话)?(?:是)?(?:正确|对)的|(?:选出|找出)(?:正确|对)的/,
];

/** Does this question ask the learner to pick the WRONG sentence? (English or Chinese, conservative.) */
export function questionAsksForWrong(question: string | null | undefined): boolean {
  const q = (question ?? '').trim();
  if (!q) return false;
  if (NOT_WRONG.some((re) => re.test(q))) return false;
  return ASKS_WRONG.some((re) => re.test(q));
}

function hasCorrection(ex: Pick<ChoiceExerciseSpec, 'correction'>): boolean {
  return !!ex.correction && typeof ex.correction.hanzi === 'string' && ex.correction.hanzi.trim().length > 0;
}

/** A "which one is wrong?" choice: its answer option is the WRONG sentence. `correction` = the explicit marker. */
export function choiceAsksForWrong(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction'>): boolean {
  return hasCorrection(ex) || questionAsksForWrong(ex.question);
}

/** The spec's own correction of the wrong option (trimmed), or null. */
export function specChoiceCorrection(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction'>): LessonSentence | null {
  if (!hasCorrection(ex)) return null;
  const c = ex.correction as LessonSentence;
  const out: LessonSentence = { hanzi: c.hanzi.trim() };
  if (c.pinyin?.trim()) out.pinyin = c.pinyin.trim();
  if (c.english?.trim()) out.english = c.english.trim();
  return out;
}

/**
 * The correction the reveal shows: the spec's, else one fetched for an older lesson. `unchanged` = the server found
 * nothing wrong with the sentence (a false alarm): then it is an ordinary sentence and may be spoken.
 */
export type ChoiceCorrection =
  | { status: 'ready'; correction: LessonSentence; source: 'spec' | 'fetched' }
  | { status: 'unchanged' }
  | { status: 'loading' }
  | { status: 'unavailable'; offline: boolean }
  | { status: 'none' };

/** The state before any fetch: `none` for an ordinary choice, the spec's correction, else `loading`. */
export function initialChoiceCorrection(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction'>): ChoiceCorrection {
  const own = specChoiceCorrection(ex);
  if (own) return { status: 'ready', correction: own, source: 'spec' };
  return choiceAsksForWrong(ex) ? { status: 'loading' } : { status: 'none' };
}

/** Should the device ask the server for a correction (an older "which is wrong" choice without one)? */
export function needsChoiceCorrection(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction'>): boolean {
  return !hasCorrection(ex) && questionAsksForWrong(ex.question);
}

/** Is the option the wrong sentence — never spoken, shown struck? (Not after the server said it is fine.) */
export function isWrongOption(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction' | 'correct'>, index: number, state?: ChoiceCorrection): boolean {
  if (index !== ex.correct || !choiceAsksForWrong(ex)) return false;
  return state?.status !== 'unchanged';
}

/** May this option be spoken (▶, autoplay)? Every option but the wrong sentence. */
export function choiceOptionSpeakable(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction' | 'correct'>, index: number, state?: ChoiceCorrection): boolean {
  return !isWrongOption(ex, index, state);
}

/** The correction's text to speak, or '' (none known yet / none needed). */
export function correctionSpokenText(state: ChoiceCorrection | undefined): string {
  return state?.status === 'ready' ? state.correction.hanzi : '';
}

/**
 * What is spoken the moment an option is picked: the option itself, except the wrong sentence → its correction
 * ('' while it isn't known — the device speaks it once it arrives, if the exercise is still on screen).
 */
export function choicePickSpeech(
  ex: Pick<ChoiceExerciseSpec, 'question' | 'correction' | 'correct' | 'options'>,
  picked: number,
  state?: ChoiceCorrection,
): string {
  const option = ex.options[picked]?.hanzi ?? '';
  return isWrongOption(ex, picked, state) ? correctionSpokenText(state ?? initialChoiceCorrection(ex)) : option;
}

/** The sentence 🎤 Say it again practises: the answer, or for a "which is wrong" choice the correction (else none). */
export function choiceSayAgainSentence(
  ex: Pick<ChoiceExerciseSpec, 'question' | 'correction' | 'correct' | 'options'>,
  state?: ChoiceCorrection,
): LessonSentence | null {
  if (isWrongOption(ex, ex.correct, state)) {
    const known = state ?? initialChoiceCorrection(ex);
    return known.status === 'ready' ? known.correction : null;
  }
  return ex.options[ex.correct] ?? null;
}

/** What a choice speaks in the default voice (prefetch / server pre-generation): every option but the mistake + the correction. */
export function choiceTtsTexts(ex: Pick<ChoiceExerciseSpec, 'question' | 'correction' | 'correct' | 'options'>): string[] {
  const texts = ex.options.filter((_, i) => !isWrongOption(ex, i)).map((o) => o.hanzi);
  const own = specChoiceCorrection(ex);
  if (own) texts.push(own.hanzi);
  return texts;
}

// ============ The correction call (older lessons) ============

export interface ChoiceCorrectionInput {
  /** The exercise's question. */
  question: string;
  /** The wrong sentence (the option marked as the answer). */
  sentence: string;
  /** The other options (right sentences) — context only. */
  others?: string[];
  /** The author's explanation, when there is one — often names the mistake. */
  explanation?: string;
}

export const CHOICE_CORRECTION_LIMITS = { question: 300, sentence: 120, other: 120, others: 5, explanation: 400 };

/** The request body for a choice exercise's answer option (null when there is nothing to ask). */
export function choiceCorrectionInput(ex: Pick<ChoiceExerciseSpec, 'question' | 'correct' | 'options' | 'explanation'>): ChoiceCorrectionInput | null {
  const sentence = ex.options[ex.correct]?.hanzi?.trim() ?? '';
  if (!sentence || !/\p{Script=Han}/u.test(sentence)) return null;
  const others = ex.options.filter((_, i) => i !== ex.correct).map((o) => o.hanzi.trim()).filter(Boolean);
  const out: ChoiceCorrectionInput = { question: ex.question.trim(), sentence };
  if (others.length) out.others = others;
  if (ex.explanation?.trim()) out.explanation = ex.explanation.trim();
  return out;
}

/** Validate a request body (the server). */
export function pickChoiceCorrectionInput(body: unknown): { input: ChoiceCorrectionInput } | { problems: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const L = CHOICE_CORRECTION_LIMITS;
  const problems: string[] = [];
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  const sentence = typeof b.sentence === 'string' ? b.sentence.trim() : '';
  if (!sentence) problems.push('sentence is required');
  else if (!/\p{Script=Han}/u.test(sentence)) problems.push('sentence must be Chinese');
  else if (sentence.length > L.sentence) problems.push(`sentence is too long (≤ ${L.sentence})`);
  if (question.length > L.question) problems.push(`question is too long (≤ ${L.question})`);
  if (problems.length) return { problems };
  const input: ChoiceCorrectionInput = { question, sentence };
  const others = Array.isArray(b.others)
    ? b.others.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, L.others).map((o) => o.trim().slice(0, L.other))
    : [];
  if (others.length) input.others = others;
  if (typeof b.explanation === 'string' && b.explanation.trim()) input.explanation = b.explanation.trim().slice(0, L.explanation);
  return { input };
}

/** What the cache is keyed by (the server's SHA-256, the devices' local cache): the version, question and sentence. */
export function choiceCorrectionCacheText(input: Pick<ChoiceCorrectionInput, 'question' | 'sentence'>): string {
  return `choice-correction|v${CHOICE_CORRECTION_VERSION}|${input.question.trim()}|${input.sentence.trim()}`;
}

/** The server's answer: the corrected sentence, or `unchanged` when nothing is wrong with it. */
export interface ChoiceCorrectionResult {
  correction: LessonSentence;
  unchanged: boolean;
}

/** Normalise a reply (the model's tool input, a cached row, the API reply). Throws on an unusable one. */
export function normalizeChoiceCorrection(raw: unknown, sentence: string): ChoiceCorrectionResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const src = (r.correction && typeof r.correction === 'object' ? r.correction : r) as Record<string, unknown>;
  const hanzi = typeof src.hanzi === 'string' ? src.hanzi.trim() : '';
  const same = (a: string, b: string) => a.replace(/[\s。，、！？.,!?]/g, '') === b.replace(/[\s。，、！？.,!?]/g, '');
  const unchanged = r.unchanged === true || r.already_correct === true || (!!hanzi && same(hanzi, sentence));
  if (!unchanged && (!hanzi || !/\p{Script=Han}/u.test(hanzi))) throw new Error('No corrected sentence');
  const correction: LessonSentence = { hanzi: unchanged ? sentence.trim() : hanzi };
  if (typeof src.pinyin === 'string' && src.pinyin.trim()) correction.pinyin = src.pinyin.trim();
  if (typeof src.english === 'string' && src.english.trim()) correction.english = src.english.trim();
  return { correction, unchanged };
}

/** The reveal's state from a fetched result. */
export function choiceCorrectionFromResult(result: ChoiceCorrectionResult): ChoiceCorrection {
  return result.unchanged ? { status: 'unchanged' } : { status: 'ready', correction: result.correction, source: 'fetched' };
}

// ============ Authoring ============

/** Soft warnings (the editor, the MCP tools): a "which is wrong" choice should carry its correction — or be a judge. */
export function choiceCorrectionWarnings(spec: CustomLessonSpec): string[] {
  const out: string[] = [];
  spec.sections.forEach((section, s) => {
    section.exercises.forEach((ex, e) => {
      if (ex.type !== 'choice' || !needsChoiceCorrection(ex)) return;
      out.push(
        `sections[${s}].exercises[${e}]: a "which one is wrong?" choice should give "correction" (the right version of the wrong sentence) — it is what the learner hears; better, use a "judge" exercise`,
      );
    });
  });
  return out;
}
