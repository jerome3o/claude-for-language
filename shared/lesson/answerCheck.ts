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
 */
import { isExactHanziMatch, normalizeHanziAnswer } from './answer-check';

/** Bump when the prompt or the shape changes: cached checks (server + device) are keyed by it. */
export const ANSWER_CHECK_VERSION = 1;

export type AnswerCheckVerdict = 'correct' | 'acceptable' | 'almost' | 'wrong';
export const ANSWER_CHECK_VERDICTS: readonly AnswerCheckVerdict[] = ['correct', 'acceptable', 'almost', 'wrong'];

export type AnswerCheckSuggestion = 'got_it' | 'missed_it';

export interface AnswerCheckTip {
  /** One short line in English. */
  text: string;
  /** The exact Chinese the tip is about (tappable into the language explorer). */
  quote?: string;
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
}

/** Exercise types whose answer gets the check (sentence_making has its own, POST /api/lessons/sentence-feedback). */
export const ANSWER_CHECK_TYPES: readonly string[] = ['translate', 'listen_translate'];

export const ANSWER_CHECK_LIMITS = { prompt: 400, model: 300, answer: 300, focus: 200, tip: 220, quote: 60, headline: 160, alternative: 200 } as const;

const HAN = /\p{Script=Han}/u;

/** Does the text contain Chinese characters? */
export function hasHan(text: string): boolean {
  return HAN.test(text);
}

/** Does this exercise's answer get Claude's check? Only an answer in Chinese (a listening answer in English is not). */
export function answerCheckApplies(exerciseType: string, answer: string | null | undefined): boolean {
  if (!ANSWER_CHECK_TYPES.includes(exerciseType)) return false;
  const a = (answer ?? '').trim();
  return a.length > 0 && hasHan(a) && normalizeHanziAnswer(a).length > 0;
}

/** Whitespace collapsed (display text keeps its full-width punctuation). */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The text a check is cached by (server: SHA-256 of it; device: the text itself). Answers that
 * differ only in punctuation / spacing share a check; a spoken answer is checked differently from
 * a typed one (leniency), so the input mode is part of it.
 */
export function answerCheckCacheText(input: AnswerCheckInput): string {
  const mode = input.input === 'spoken' ? 'spoken' : 'typed';
  return [
    `v${ANSWER_CHECK_VERSION}`,
    input.exercise_type,
    mode,
    collapse(input.prompt_en.normalize('NFKC')).toLowerCase(),
    normalizeHanziAnswer(input.model_answer),
    normalizeHanziAnswer(input.answer),
    collapse((input.focus ?? '').normalize('NFKC')).toLowerCase(),
  ].join('|');
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? collapse(v).slice(0, max) : '');

/** Request body → input, or the problems (400). */
export function pickAnswerCheckInput(raw: unknown): { input: AnswerCheckInput } | { problems: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = ANSWER_CHECK_LIMITS;
  const input: AnswerCheckInput = {
    prompt_en: str(r.prompt_en, L.prompt),
    model_answer: str(r.model_answer, L.model),
    model_pinyin: str(r.model_pinyin, L.model * 3) || undefined,
    answer: str(r.answer, L.answer),
    exercise_type: str(r.exercise_type, 40) || 'translate',
    input: r.input === 'spoken' || r.input === 'edited' || r.input === 'typed' ? r.input : undefined,
    focus: str(r.focus, L.focus) || undefined,
  };
  const problems: string[] = [];
  if (!input.prompt_en) problems.push('prompt_en is required');
  if (!input.model_answer) problems.push('model_answer is required');
  if (!input.answer) problems.push('answer is required');
  else if (!hasHan(input.answer)) problems.push('answer has no Chinese to check');
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
  if (!answerCheckApplies(input.exercise_type, input.answer)) return null;
  if (!isExactHanziMatch(input.answer, input.model_answer)) return null;
  return { verdict: 'correct', headline: EXACT_ANSWER_HEADLINE, corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' };
}

export type AnswerCheckTone = 'good' | 'warn' | 'bad';

/** The verdict chip. */
export function answerCheckChip(verdict: AnswerCheckVerdict): { label: string; tone: AnswerCheckTone } {
  switch (verdict) {
    case 'correct': return { label: '✓ Correct', tone: 'good' };
    case 'acceptable': return { label: '✓ Also right', tone: 'good' };
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
 * - `suggested` follows the verdict.
 */
export function normalizeAnswerCheck(raw: unknown, answer: string): AnswerCheck {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = ANSWER_CHECK_LIMITS;
  const verdict = (ANSWER_CHECK_VERDICTS as readonly unknown[]).includes(r.verdict) ? r.verdict as AnswerCheckVerdict : null;
  const headline = str(r.headline, L.headline);
  if (!verdict || !headline) throw new Error('Invalid answer check');
  const mine = normalizeHanziAnswer(answer);
  let corrected = verdict === 'correct' || verdict === 'acceptable' ? '' : str(r.corrected, L.answer * 2);
  if (corrected && (!hasHan(corrected) || normalizeHanziAnswer(corrected) === mine)) corrected = '';
  const correctedPinyin = corrected ? str(r.corrected_pinyin, L.answer * 6) : '';
  const tips: AnswerCheckTip[] = [];
  for (const t of Array.isArray(r.tips) ? r.tips : []) {
    const o = (t && typeof t === 'object' ? t : { text: t }) as Record<string, unknown>;
    const text = str(o.text, L.tip);
    if (!text) continue;
    const quote = str(o.quote, L.quote);
    tips.push(quote && hasHan(quote) ? { text, quote } : { text });
    if (tips.length === 3) break;
  }
  let alternative: AnswerCheckAlternative | undefined;
  const a = (r.alternative && typeof r.alternative === 'object' ? r.alternative : null) as Record<string, unknown> | null;
  const altHanzi = a ? str(a.hanzi, L.alternative) : '';
  if (altHanzi && hasHan(altHanzi)) {
    const n = normalizeHanziAnswer(altHanzi);
    if (n !== mine && n !== normalizeHanziAnswer(corrected)) {
      alternative = { hanzi: altHanzi };
      const p = str(a!.pinyin, L.alternative * 6);
      const e = str(a!.english, L.alternative);
      if (p) alternative.pinyin = p;
      if (e) alternative.english = e;
    }
  }
  const out: AnswerCheck = { verdict, headline, corrected, corrected_pinyin: correctedPinyin, tips, suggested: suggestedFor(verdict) };
  if (alternative) out.alternative = alternative;
  return out;
}

/** Lenient parse of a stored / cached / received check: null when it isn't one. */
export function parseAnswerCheck(raw: unknown, answer: string): AnswerCheck | null {
  try {
    return normalizeAnswerCheck(raw, answer);
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
export function askQuickQuestions(verdict: AnswerCheckVerdict | null | undefined): string[] {
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
