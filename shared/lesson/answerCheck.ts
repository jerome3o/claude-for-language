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
 * Lab port: core `LessonAnswerCheck.kt`, parity-tested (parity/fixtures/lesson-answer-check.ts).
 * docs/STUDY_SESSION.md "Mini lessons" → "Claude checks your answer".
 *
 * Free SPEAKING ("口语 · Speaking — recorded", `oral_expression`, and "Say it out loud", `speak`)
 * gets the same check of the recording's transcript, graciously: disfluencies, restarts, "sorry" /
 * "wait", English asides, repeats and the recogniser's punctuation never count against the learner.
 * Its check adds `cleaned` (what they meant), `parts` (the task's ① ② ③ covered or missing) and a
 * better version per tip (`fix`). docs/STUDY_SESSION.md "Claude checks your speaking".
 */
import { normalizeHanziAnswer } from './answer-check';

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
  question?: string;
}

/** Exercise types whose answer gets the check (sentence_making has its own, POST /api/lessons/sentence-feedback). */
export const ANSWER_CHECK_TYPES: readonly string[] = ['translate', 'listen_translate'];

/** Free speaking: the recording's transcript is checked (model answer = only "one way to say it"). */
export const SPEAKING_CHECK_TYPES: readonly string[] = ['oral_expression', 'speak'];

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

/** Does this exercise's answer get Claude's check? Only an answer in Chinese (a listening answer in English is not). */
export function answerCheckApplies(exerciseType: string, answer: string | null | undefined): boolean {
  if (!ANSWER_CHECK_TYPES.includes(exerciseType) && !isSpeakingCheckType(exerciseType)) return false;
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
  if (isSpeakingCheckType(input.exercise_type)) {
    return [
      `s${SPEAKING_CHECK_VERSION}`,
      input.exercise_type,
      collapse(input.prompt_en.normalize('NFKC')).toLowerCase(),
      normalizeHanziAnswer(input.model_answer),
      normalizeHanziAnswer(input.answer),
      collapse((input.focus ?? '').normalize('NFKC')).toLowerCase(),
      (input.hints ?? []).map((h) => normalizeHanziAnswer(h)).filter(Boolean).join(','),
      normalizeHanziAnswer(input.question ?? ''),
    ].join('|');
  }
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
    const question = str(r.question, L.question);
    if (question) input.question = question;
  }
  const problems: string[] = [];
  if (!input.prompt_en) problems.push('prompt_en is required');
  if (!input.model_answer && !speaking) problems.push('model_answer is required');
  if (!input.answer) problems.push('answer is required');
  else if (!hasHan(input.answer)) problems.push('answer has no Chinese to check');
  return problems.length ? { problems } : { input };
}

/** Correct / acceptable → Got it; almost / wrong → Missed it. */
export function suggestedFor(verdict: AnswerCheckVerdict): AnswerCheckSuggestion {
  return verdict === 'correct' || verdict === 'acceptable' ? 'got_it' : 'missed_it';
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
  // A speaking check is the one with `cleaned` (what they meant): its "cleaner version" may fix an
  // acceptable answer too, and it is compared with what they meant, not the raw transcript.
  const cleanedRaw = str(r.cleaned, L.speech);
  const speaking = !!cleanedRaw && hasHan(cleanedRaw);
  const meant = speaking ? normalizeHanziAnswer(cleanedRaw) : mine;
  const noFix = verdict === 'correct' || (verdict === 'acceptable' && !speaking);
  let corrected = noFix ? '' : str(r.corrected, speaking ? L.speech : L.answer * 2);
  if (corrected && (!hasHan(corrected) || normalizeHanziAnswer(corrected) === mine || normalizeHanziAnswer(corrected) === meant)) corrected = '';
  const correctedPinyin = corrected ? str(r.corrected_pinyin, (speaking ? L.speech : L.answer) * 6) : '';
  const tips: AnswerCheckTip[] = [];
  for (const t of Array.isArray(r.tips) ? r.tips : []) {
    const o = (t && typeof t === 'object' ? t : { text: t }) as Record<string, unknown>;
    const text = str(o.text, L.tip);
    if (!text) continue;
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
      description = trimPart(pieces[pieces.length - 1]).replace(/^(and|then|also)\s+/i, '');
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
