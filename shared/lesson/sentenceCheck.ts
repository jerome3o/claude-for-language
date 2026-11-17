/**
 * Claude's check of a sentence the learner MADE (sentence_making; docs/STUDY_SESSION.md "Sentence making: an honest
 * verdict"). Jerome said 我本来要去健身馆，但是我学中文。 for 本来 + 要 and got a green "✓ Natural and correct" over an
 * explanation saying the second half didn't follow and 健身馆 is usually 健身房. So:
 *
 * 1. **Three grades**, not right / wrong:
 *    - `right` (green ✓) — natural, every target word used well;
 *    - `needs_work` (orange ≈) — the target words are used right, but the sentence has a real problem elsewhere: it
 *      doesn't make sense or hang together, a wrong word, a grammar slip;
 *    - `wrong` (red ✗) — a target word misused or missing.
 *    Scored like the answer check's "almost": only `right` counts as right first time; needs_work comes back in the
 *    lesson's retry round / revision.
 * 2. **Coherent** — the grade agrees with the words: a `right` whose headline / reason / more names a problem ("but",
 *    "should", "usually X", "unnatural"…) is `needs_work` (`guardSentenceGrade`); a word that isn't in the sentence is
 *    never "used" (→ `wrong`). Applied by the worker before it answers AND by both apps on what they get
 *    (`sentenceCheckView`), so an older cached answer can't show green over a correction either.
 * 3. **Slim** — one headline line, at most one short reason line, the fuller text only behind "More ▸" when it adds
 *    something. No corrected sentence in the first call (fast): a `fixable` flag only.
 * 4. **Iterate** — 🎤 Try again (a new sentence, re-checked the same way, practice only) and ✨ Show a fixed version
 *    (a second small call that fixes HIS sentence with minimal edits, cached per exercise + sentence).
 *
 * Pure; the Lab port is core `SentenceCheck.kt`, parity-tested (android-lab/parity/fixtures/sentence-check.ts).
 */
import { normalizeHanziAnswer, sentenceUsesWord } from './answer-check';
import { digitsToHanzi } from '../text/numberHanzi';
import type { LessonSentence } from './types';

/** v1 = correct / minor / incorrect + comment + a corrected sentence; v2 = the grades, headline, reason, fixable. */
export const SENTENCE_CHECK_VERSION = 2;
export const SENTENCE_FIX_VERSION = 1;
/** The exercise type a check / fix is cached under (the answer checks' table, `lesson_answer_checks`). */
export const SENTENCE_CHECK_CACHE_TYPE = 'sentence_making';
export const SENTENCE_FIX_CACHE_TYPE = 'sentence_making_fix';

export type SentenceGrade = 'right' | 'needs_work' | 'wrong';
export const SENTENCE_GRADES: readonly SentenceGrade[] = ['right', 'needs_work', 'wrong'];
export type SentenceTone = 'good' | 'warn' | 'bad';

/** Claude's feedback on a sentence the learner made (stored in the attempt as `answer.feedback`). */
export interface SentenceFeedback {
  /** Legacy (older apps read it): right → correct, needs_work → minor, wrong → incorrect. */
  verdict: 'correct' | 'minor' | 'incorrect';
  /** The grade (v2); absent on a v1 check — `sentenceGradeOf` derives it. */
  grade?: SentenceGrade;
  /** One short line: what's right and the one thing to change. */
  headline?: string;
  /** At most one short line: why. */
  reason?: string;
  /** The fuller explanation, only when it adds something. */
  more?: string;
  /** Claude can fix his sentence with small edits (✨ Show a fixed version). */
  fixable?: boolean;
  /** Did the sentence use every target word (in a sense that fits)? */
  uses_all_words: boolean;
  /** v1 only: the corrected sentence (no longer made up front — ✨ Show a fixed version asks for it). */
  corrected?: LessonSentence;
  /** Legacy (older apps show it): headline + reason. */
  comment: string;
}

/** His sentence fixed with minimal edits (✨ Show a fixed version). */
export interface SentenceFix {
  hanzi: string;
  pinyin?: string;
  english?: string;
}

export const SENTENCE_CHECK_LIMITS = { headline: 100, reason: 220, more: 500, line: 110, sentence: 300, words: 6 } as const;

// ============ Copy ============

export const SENTENCE_TRY_AGAIN_LABEL = 'Try again';
export const SENTENCE_SHOW_FIX_LABEL = 'Show a fixed version';
export const SENTENCE_FIX_LABEL = 'Fixed';
export const SENTENCE_SAY_FIX_LABEL = 'Say it';
export const SENTENCE_MORE_LABEL = 'More';
export const SENTENCE_EXAMPLE_TOGGLE = 'Example sentence';
export const SENTENCE_FIXING_LINE = 'Fixing your sentence…';
export const SENTENCE_FIX_OFFLINE = 'A fixed version needs a connection — try again when you’re online.';
export const SENTENCE_FIX_FAILED = 'Claude couldn’t fix this one — try saying it another way.';
export const SENTENCE_RETRY_OFFLINE = 'Claude can’t check it offline — compare it with the example.';
export const SENTENCE_RETRY_NOTE = 'Practice — your first answer is the one that counts';
export const SENTENCE_SELF_CHECK = 'Is your sentence grammatical, and does it use every word?';
export const SENTENCE_SELF_CHECK_HANDWRITTEN = 'Compare with the example — is your sentence right, and does it use every word?';
export const SENTENCE_RIGHT_HEADLINE = 'Natural and correct';
export const SENTENCE_MISSING_WORD_HEADLINE = 'Use every target word';
export const SENTENCE_WRONG_HEADLINE = 'Not quite — check how the target words are used';

/** The grade's mark: icon + tone + a word for screen readers (never colour alone). */
export function sentenceGradeChip(grade: SentenceGrade): { icon: string; tone: SentenceTone; label: string } {
  switch (grade) {
    case 'right': return { icon: '✓', tone: 'good', label: 'Right' };
    case 'needs_work': return { icon: '≈', tone: 'warn', label: 'Nearly' };
    default: return { icon: '✗', tone: 'bad', label: 'Not quite' };
  }
}

/** "本来 and 要", "a, b and c"; more than three → "The target words". */
export function targetWordsPhrase(words: readonly string[]): string {
  const ws = words.map((w) => w.trim()).filter(Boolean);
  if (ws.length === 0 || ws.length > 3) return 'The target words';
  if (ws.length === 1) return ws[0];
  return `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`;
}

/** The needs_work headline when Claude's own line didn't say what to change: "本来 and 要 used right — one thing to fix". */
export function needsWorkHeadline(words: readonly string[]): string {
  return `${targetWordsPhrase(words)} used right — one thing to fix`;
}

// ============ The coherence guard ============

// English words matched with explicit ASCII edges (never `\b`), so the Lab's Java regexes agree character for character.
const W = (words: string) => `(?<![A-Za-z0-9_])(?:${words})(?![A-Za-z0-9_])`;

/** Praise that only LOOKS like a problem ("nothing to fix", "no mistakes", "not wrong"), removed before looking for one. */
const PRAISE = new RegExp(W([
  'nothing to (?:fix|change|correct)', 'no need to (?:fix|change)', 'no (?:real )?(?:mistakes?|errors?|problems?|issues?|fix(?:es)?)',
  'not (?:wrong|a mistake|an error)', 'without (?:any )?(?:mistakes?|errors?)', 'nothing wrong', 'can.t fault',
].join('|')), 'gi');

/** A line that names a problem: a contrast / correction cue, or a word that says something is off. */
const PROBLEM = new RegExp(W([
  'but', 'however', 'though', 'although', 'should', 'shouldn.t', 'instead', 'usually', 'normally', 'typically',
  'rather than', 'better', 'more natural', 'more common', 'more idiomatic', 'unnatural', 'awkward', 'odd', 'strange',
  'wrong', 'incorrect', 'mistake', 'mistakes', 'error', 'missing', 'typo', 'doesn.t', 'does not', 'isn.t', 'is not',
  'not quite', 'needs', 'need to', 'fix', 'replace', 'change', 'confusing', 'unclear', 'contrived', 'illogical',
  'doesn.t follow', 'mismatch', 'misused', 'overused',
].join('|')), 'i');

/** Does this line name a problem (and so can't sit under a ✓)? */
export function namesProblem(text: string | null | undefined): boolean {
  const t = (text ?? '').replace(PRAISE, ' ');
  return PROBLEM.test(t);
}

/** A connector the problem clause starts with ("but", "however,") — dropped when the clause stands alone. */
const LEAD = new RegExp(`^(?:${W('but|however|though|although|yet|and|so')})[ ,，]*`, 'i');

/** The clauses of an explanation: split at sentence ends and semicolons. */
export function explanationClauses(text: string | null | undefined): string[] {
  return (text ?? '').split(/(?<=[.!?。！？])\s+|[;；]\s*/u).map((s) => s.trim()).filter(Boolean);
}

/** The first clause of `text` that names a problem, its leading "but" dropped and capitalised; null when none does. */
export function problemClause(text: string | null | undefined): string | null {
  for (const c of explanationClauses(text)) {
    if (!namesProblem(c)) continue;
    const s = c.replace(LEAD, '').trim();
    if (!s) continue;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return null;
}

/**
 * The grade the words allow: a target word missing → `wrong`; a `right` whose own lines name a problem → `needs_work`;
 * otherwise as given.
 */
export function guardSentenceGrade(grade: SentenceGrade, lines: ReadonlyArray<string | null | undefined>, usesAllWords: boolean): SentenceGrade {
  if (!usesAllWords) return 'wrong';
  if (grade === 'right' && lines.some(namesProblem)) return 'needs_work';
  return grade;
}

/** A v1 check's grade: correct → right, minor → needs_work, incorrect → wrong; a word not used → wrong. */
export function legacyGrade(verdict: string | null | undefined, usesAllWords: boolean): SentenceGrade {
  if (!usesAllWords) return 'wrong';
  if (verdict === 'correct') return 'right';
  if (verdict === 'minor') return 'needs_work';
  return 'wrong';
}

/** Grade → the legacy verdict older apps read. */
export function legacyVerdict(grade: SentenceGrade): SentenceFeedback['verdict'] {
  return grade === 'right' ? 'correct' : grade === 'needs_work' ? 'minor' : 'incorrect';
}

const cps = (s: string) => [...s];

/** The first sentence of a line, at most `max` characters (answer-diff's `firstSentence`, kept here to avoid a cycle). */
export function sentenceLine(text: string | null | undefined, max: number = SENTENCE_CHECK_LIMITS.line): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.+?[.!?。！？](?=\s|$)/u);
  const s = (m ? m[0] : t).trim();
  if (cps(s).length <= max) return s;
  // Too long: cut at the last comma (when it keeps at least half), else the last space, never mid-word.
  const head = cps(s).slice(0, max - 1).join('');
  const comma = Math.max(head.lastIndexOf(', '), head.lastIndexOf('，'));
  const space = head.lastIndexOf(' ');
  const at = comma >= head.length / 2 ? comma : space > 0 ? space : head.length;
  return `${head.slice(0, at).replace(/[\s,，;；:：—-]+$/u, '')}…`;
}

/** What a sentence check shows (both apps; the attempt review too). */
export interface SentenceCheckView {
  grade: SentenceGrade;
  icon: string;
  tone: SentenceTone;
  label: string;
  /** The ONE headline line. */
  headline: string;
  /** At most one short reason line ('' = none). */
  reason: string;
  /** The fuller text behind "More ▸" ('' = nothing more to say). */
  more: string;
  /** ✨ Show a fixed version is offered. */
  fixable: boolean;
  /** Counts as right (the exercise's score). */
  right: boolean;
  /** The guard changed Claude's grade (analytics / tests). */
  downgraded: boolean;
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A check (v2, or a v1 one from an older server / attempt) → what to show. Idempotent: the view of a normalised
 * check is that check. `words` = the exercise's target words (for the needs_work headline).
 */
export function sentenceCheckView(f: SentenceFeedback, words: readonly string[]): SentenceCheckView {
  const legacy = !f.grade;
  const given: SentenceGrade = f.grade && SENTENCE_GRADES.includes(f.grade) ? f.grade : legacyGrade(f.verdict, f.uses_all_words);
  const headline0 = (f.headline ?? '').trim();
  // A v1 check had no headline: its comment is the reason.
  const reason0 = (legacy ? f.comment : f.reason ?? '').trim();
  const more0 = (f.more ?? '').trim();
  const grade = guardSentenceGrade(given, [headline0, reason0, more0], f.uses_all_words);
  const downgraded = grade !== given;
  let headline = headline0;
  let reason = reason0;
  if (!f.uses_all_words && given !== 'wrong') {
    headline = SENTENCE_MISSING_WORD_HEADLINE;
  } else if (downgraded || !headline) {
    if (grade === 'right') headline = SENTENCE_RIGHT_HEADLINE;
    else if (grade === 'needs_work') headline = headline0 && namesProblem(headline0) ? headline0 : needsWorkHeadline(words);
    else headline = headline0 || SENTENCE_WRONG_HEADLINE;
  }
  if (downgraded && grade === 'needs_work') {
    reason = problemClause(reason0) ?? problemClause(more0) ?? reason0;
  }
  const headLine = sentenceLine(headline, SENTENCE_CHECK_LIMITS.headline);
  const reasonLine = sentenceLine(reason);
  // More ▸ only when it adds: the explanation as Claude wrote it when the lines shown are a cut of it, and `more`.
  const fuller: string[] = [];
  const pushMore = (t: string) => {
    if (t && !same(t, headLine) && !same(t, reasonLine) && !fuller.some((x) => same(x, t))) fuller.push(t);
  };
  if (reason0 && !same(reason0, reasonLine)) pushMore(reason0);
  pushMore(more0);
  const chip = sentenceGradeChip(grade);
  return {
    grade,
    icon: chip.icon,
    tone: chip.tone,
    label: chip.label,
    headline: headLine,
    reason: same(reasonLine, headLine) ? '' : reasonLine,
    more: fuller.join(' '),
    fixable: grade !== 'right' && f.fixable !== false,
    right: grade === 'right',
    downgraded,
  };
}

/** The grade of a stored check (the attempt review, analytics). */
export function sentenceGradeOf(f: SentenceFeedback): SentenceGrade {
  return sentenceCheckView(f, []).grade;
}

// ============ The worker's side: the model's answer → the stored shape ============

const str = (v: unknown, max: number) => (typeof v === 'string' ? cps(v.replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '');

/** The sentence with every punctuation mark and space removed (dictated punctuation is noise). */
export function withoutPunctuation(text: string): string {
  return text.replace(/[\p{P}\p{S}\s]/gu, '');
}

/**
 * The check_sentence tool's input → the stored feedback (throws when the essentials are missing, so the call is
 * retried). Accepts the v1 shape too (verdict + comment). A word not in the sentence is never "used".
 */
export function normalizeSentenceFeedback(raw: unknown, input: { words: readonly string[]; sentence: string; input?: string | null }): SentenceFeedback {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = SENTENCE_CHECK_LIMITS;
  // Typed: a word that isn't in the sentence is never "used". Spoken: the recogniser can mishear a word (有没有 →
  // 有不有), so the model's reading of what he meant decides.
  const spoken = input.input === 'spoken' || input.input === 'edited';
  const allPresent = spoken || input.words.every((w) => sentenceUsesWord(input.sentence, w));
  const usesAll = r.uses_all_words !== false && allPresent;
  let grade: SentenceGrade | null = (SENTENCE_GRADES as readonly unknown[]).includes(r.grade) ? r.grade as SentenceGrade : null;
  let headline = str(r.headline, L.headline);
  let reason = str(r.reason, L.reason);
  const v1 = r.verdict === 'correct' || r.verdict === 'minor' || r.verdict === 'incorrect';
  if (!grade && v1) {
    grade = legacyGrade(r.verdict as string, usesAll);
    if (!reason) reason = str(r.comment, L.more);
  }
  if (!grade || (!headline && !reason)) throw new Error('Invalid sentence check from AI');
  const more = str(r.more, L.more);
  const draft: SentenceFeedback = {
    verdict: legacyVerdict(grade), grade, headline, reason, more, fixable: r.fixable !== false, uses_all_words: usesAll, comment: '',
  };
  const view = sentenceCheckView(draft, input.words);
  const out: SentenceFeedback = {
    verdict: legacyVerdict(view.grade),
    grade: view.grade,
    headline: view.headline,
    uses_all_words: usesAll,
    fixable: view.fixable,
    comment: [view.headline, view.reason].filter(Boolean).join(' — '),
  };
  if (view.reason) out.reason = view.reason;
  if (view.more) out.more = view.more;
  return out;
}

/**
 * The fix_sentence tool's input → the fix (throws when it isn't one: no Chinese, or his own sentence back — the call
 * is retried). Pinyin / English are optional.
 */
export function normalizeSentenceFix(raw: unknown, sentence: string): SentenceFix {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hanzi = str(r.hanzi, SENTENCE_CHECK_LIMITS.sentence);
  if (!hanzi || !/\p{Script=Han}/u.test(hanzi)) throw new Error('Invalid sentence fix from AI');
  if (withoutPunctuation(digitsToHanzi(hanzi)) === withoutPunctuation(digitsToHanzi(sentence))) throw new Error('The fix is the same sentence');
  const out: SentenceFix = { hanzi };
  const pinyin = str(r.pinyin, SENTENCE_CHECK_LIMITS.sentence * 6);
  const english = str(r.english, SENTENCE_CHECK_LIMITS.sentence);
  if (pinyin) out.pinyin = pinyin;
  if (english) out.english = english;
  return out;
}

/** A request body → the check's input, or the problems (400). */
export interface SentenceCheckInput { words: string[]; task?: string; sentence: string }
export function pickSentenceCheckInput(raw: unknown): { input: SentenceCheckInput } | { problems: string[] } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = SENTENCE_CHECK_LIMITS;
  const words = Array.isArray(b.words) ? b.words.filter((w): w is string => typeof w === 'string' && w.trim().length > 0).map((w) => w.trim()).slice(0, L.words) : [];
  const sentence = typeof b.sentence === 'string' ? cps(b.sentence.trim()).slice(0, L.sentence).join('') : '';
  const task = typeof b.task === 'string' && b.task.trim() ? cps(b.task.trim()).slice(0, 300).join('') : undefined;
  const problems: string[] = [];
  if (words.length === 0) problems.push('words are required');
  if (!sentence) problems.push('sentence is required');
  return problems.length ? { problems } : { input: task ? { words, task, sentence } : { words, sentence } };
}

/**
 * The text a check / fix is cached by (server: SHA-256 of it in `lesson_answer_checks`; device: the text itself).
 * Sentences that differ only in punctuation / spacing / digits share one.
 */
export function sentenceCheckCacheText(input: SentenceCheckInput, kind: 'check' | 'fix'): string {
  const version = kind === 'check' ? SENTENCE_CHECK_VERSION : SENTENCE_FIX_VERSION;
  const key = normalizeHanziAnswer(digitsToHanzi(input.sentence.normalize('NFKC')));
  return [`${SENTENCE_CHECK_CACHE_TYPE}:${kind}:v${version}`, input.words.join('、'), (input.task ?? '').trim(), key].join('\n');
}
