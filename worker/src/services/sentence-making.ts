/**
 * Claude's check of a sentence the learner made in a sentence_making lesson exercise (rules in
 * shared/lesson/sentenceCheck.ts; docs/STUDY_SESSION.md "Sentence making: an honest verdict"):
 *
 * - `checkMadeSentence` — the grade (right · needs_work · wrong), ONE headline, at most one short reason, a
 *   `fixable` flag. Fast (the learner is mid-lesson): the small model through structuredCall (forced tool, thinking
 *   off, a short budget), the coherence guard applied to whatever comes back. NO corrected sentence here.
 * - `fixMadeSentence` — ✨ Show a fixed version, only on tap: HIS sentence with the smallest edits that fix THE PROBLEM
 *   THE CHECK FOUND — told what it is (the cached check of the same sentence, else the app's copy of it), because a
 *   problem of meaning ("unclear what the angle reveals") has no small edit to find on its own: without it the model
 *   handed his sentence back re-punctuated, both models, every time (Nov 2026). A fix that is still his sentence goes
 *   back with why; after that, a non-retryable failure (502), never a "busy" 503 the apps retry in vain.
 *
 * Both are cached for everyone in `lesson_answer_checks` by SHA-256 of `sentenceCheckCacheText` (the words, the
 * task, his sentence without punctuation): the same sentence for the same exercise is never asked twice.
 * A SPOKEN sentence arrives scrubbed of the recogniser's punctuation (`scrubSpokenTranscript`).
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  cleanSentenceFixProblem, normalizeSentenceFeedback, normalizeSentenceFix, sentenceCheckCacheText, sentenceFixProblem,
  SentenceFixRejected, SENTENCE_FIX_FAILED, SENTENCE_CHECK_CACHE_TYPE, SENTENCE_CHECK_VERSION, SENTENCE_FIX_CACHE_TYPE, SENTENCE_FIX_VERSION,
  type SentenceCheckInput, type SentenceFeedback, type SentenceFix,
} from '@shared/lesson/sentenceCheck';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { structuredCall, StructuredCallError } from './structured-call';
import { HAIKU_MODEL, SONNET_MODEL } from './models';
import { appPinyin } from './answer-check';

export { withoutPunctuation } from '@shared/lesson/sentenceCheck';

/** The transcript rule every spoken check carries (the speaking check's graciousness, short). */
export const SPOKEN_SENTENCE_RULE = `The sentence may be SPOKEN: a speech-recognition transcript, already stripped of the recogniser's punctuation.
- Read it as ONE continuous utterance. Punctuation and sentence breaks come from where the learner paused — never judge them, never mention punctuation, never call it split, a fragment, a run-on or "two sentences".
- Fillers (嗯, 那个, 就是), a restart or a repeated word are not mistakes.
- A wrong character that sounds like the right one (在/再, 他/她, 的/得/地, 有/又) is the recogniser's: read the word the learner clearly meant from the context.
- Numbers written as digits (3, 2026) are the same as the characters.
- Judge the words, grammar and word order only.`;

/**
 * Text a learner may have DICTATED into a voice-first box (the chat composer, the Coach / Claude box) and then asked to
 * have checked: the recogniser's punctuation / homophones / digits are never the learner's mistake (the chat
 * auto-check and the Coach's "Check my sentence" carry it in their static system prompt).
 */
export const DICTATED_TEXT_RULE = `The text may have been DICTATED (the app's composers are voice-first): then it is a speech-recognition transcript. Its punctuation, spacing and sentence breaks are the recogniser's guesses where the learner paused — never a mistake, never mentioned, never the only change in a correction; a homophone the recogniser picked (在/再, 他/她, 的/得/地) or a number written as digits is not the learner's error either. Judge the words, grammar and word order.`;

export const SENTENCE_CHECK_SYSTEM = `You check one sentence a Chinese learner made in a lesson exercise: they had to make their OWN sentence using the target words (in the situation given, if any).

Grades — pick the one that is TRUE, and make every line agree with it:
- "right": natural and makes sense as a whole, every target word used appropriately, nothing a teacher would correct. Any topic that plausibly fits the task is fine — never lower the grade for the content they chose.
- "needs_work": the target words ARE used correctly, but the sentence has a real problem elsewhere: it doesn't make sense or doesn't hang together (a clause that doesn't follow, a connector like 但是 / 所以 that doesn't fit what it joins), a wrong or unusual word, a grammar slip, an unnatural phrasing.
- "wrong": a target word is misused or missing, or the sentence can't be understood.
- If you notice ANY problem worth mentioning, the grade is NOT "right". A "right" headline and reason are plainly positive: no "but", "however", "should", "usually", "instead", "better".

Lines (English, short — the learner reads them mid-lesson):
- headline: ≤ 12 words, "<what's right> — <the one problem>" for needs_work (e.g. "本来…要 used right — the second half doesn't follow"); plain praise for right; the misused / missing word for wrong.
- reason: optional, ONE short sentence (≤ 20 words) saying why — name the Chinese words at fault. Empty when the headline says it all.
- more: optional, at most 2 short sentences, only when they add something the reason doesn't (a second point). Usually empty.
- fixable: true when their sentence can be fixed with small edits that keep their idea (needs_work / wrong).
- uses_all_words: true only if every target word appears and is used in a sense that fits.
- Do NOT write a corrected sentence.

${SPOKEN_SENTENCE_RULE}
Answer with the check_sentence tool.`;

const CHECK_TOOL = {
  name: 'check_sentence',
  description: 'Return the grade, a one-line headline, an optional short reason, and whether the sentence can be fixed with small edits.',
  input_schema: {
    type: 'object' as const,
    properties: {
      grade: { type: 'string', enum: ['right', 'needs_work', 'wrong'] },
      headline: { type: 'string', description: 'One short line in English (≤ 12 words)' },
      reason: { type: 'string', description: 'Optional: one short sentence saying why' },
      more: { type: 'string', description: 'Optional: a second point, only when it adds something' },
      fixable: { type: 'boolean' },
      uses_all_words: { type: 'boolean' },
    },
    required: ['grade', 'headline', 'fixable', 'uses_all_words'],
  },
};

export const SENTENCE_FIX_SYSTEM = `A Chinese learner made their own sentence with some target words, and a check found a problem with it (you are told what). Fix THEIR sentence so that problem is gone, with the SMALLEST edits that do it: keep their idea, their words and their structure wherever you can, and keep every target word.
- The fix must address the problem you are given. When it is about MEANING — the sentence doesn't hang together, a clause doesn't follow, it states a fact without saying what the target words set up (e.g. 从我妈妈的角度来看 followed by no view of hers) — ADD or change the words that are missing (what the mother thinks, what actually happened…), keeping the rest of their sentence. Example: 我本来要去健身馆，但是我学中文。 → 我本来要去健身房，可是后来去学中文了。
- Changing only punctuation or spacing is NOT a fix: the words must change.
- Give the fixed sentence in simplified characters, its English, and pinyin with tone marks.

${SPOKEN_SENTENCE_RULE}
Answer with the fix_sentence tool.`;

const FIX_TOOL = {
  name: 'fix_sentence',
  description: 'Return the learner\'s sentence with minimal edits that fix it.',
  input_schema: {
    type: 'object' as const,
    properties: {
      hanzi: { type: 'string' },
      pinyin: { type: 'string', description: 'Tone marks, not numbers' },
      english: { type: 'string' },
    },
    required: ['hanzi', 'english'],
  },
};

export type SentenceMakingInput = SentenceCheckInput & { input?: 'spoken' | 'edited' | 'typed' };

export interface SentenceMakingDeps {
  apiKey: string;
  client?: Pick<Anthropic, 'messages'>;
}

function userTurn(input: SentenceMakingInput, problem?: string): string {
  const spoken = input.input === 'spoken' || input.input === 'edited';
  return [
    `Target words: ${input.words.join('、')}`,
    input.task ? `Task: ${input.task}` : null,
    `The learner's sentence${spoken ? ' (SPOKEN — speech-recognition transcript, punctuation removed)' : ''}: ${input.sentence.trim()}`,
    problem !== undefined ? `What the check found wrong: ${problem || '(not given — make it natural and make it hang together)'}` : null,
  ].filter(Boolean).join('\n');
}

/** The repair note when a fix_sentence answer was refused (its tool result, marked as an error). */
export function sentenceFixRepairNote(error: unknown, problem: string): string | null {
  if (!(error instanceof SentenceFixRejected)) return null;
  if (error.kind === 'invalid') return 'That is not a fixed sentence: give the whole fixed sentence in simplified Chinese characters.';
  return `That is the learner's own sentence again — only the punctuation or spacing changed, so it fixes nothing. Change the WORDS so the problem is gone${problem ? `: ${problem}` : ''}. Keep their words and every target word; add what is missing.`;
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** One cached JSON (`lesson_answer_checks`) or null; a failure is only logged. */
async function readCached<T>(db: D1Database | null | undefined, kind: 'check' | 'fix', input: SentenceMakingInput): Promise<T | null> {
  if (!db) return null;
  const version = kind === 'check' ? SENTENCE_CHECK_VERSION : SENTENCE_FIX_VERSION;
  try {
    const hash = await sha256(sentenceCheckCacheText(input, kind));
    const row = await db.prepare('SELECT check_json FROM lesson_answer_checks WHERE hash = ? AND version = ?').bind(hash, version).first<{ check_json: string }>();
    return row ? JSON.parse(row.check_json) as T : null;
  } catch (error) {
    console.warn('[sentence-making] cache read failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Read / write one cached JSON (`lesson_answer_checks`); a failure is only logged. */
async function cached<T>(
  db: D1Database | null | undefined, kind: 'check' | 'fix', input: SentenceMakingInput, make: () => Promise<T>, verdictOf: (v: T) => string,
): Promise<{ value: T; cached: boolean }> {
  const type = kind === 'check' ? SENTENCE_CHECK_CACHE_TYPE : SENTENCE_FIX_CACHE_TYPE;
  const version = kind === 'check' ? SENTENCE_CHECK_VERSION : SENTENCE_FIX_VERSION;
  const hash = await sha256(sentenceCheckCacheText(input, kind));
  const hit = await readCached<T>(db, kind, input);
  if (hit) return { value: hit, cached: true };
  const value = await make();
  if (db) {
    try {
      await db.prepare(
        'INSERT OR REPLACE INTO lesson_answer_checks (hash, version, exercise_type, verdict, check_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(hash, version, type, verdictOf(value), JSON.stringify(value), new Date().toISOString()).run();
    } catch (error) {
      console.warn('[sentence-making] cache write failed:', error instanceof Error ? error.message : error);
    }
  }
  return { value, cached: false };
}

export async function checkMadeSentence(
  db: D1Database | null | undefined,
  input: SentenceMakingInput,
  deps: SentenceMakingDeps,
): Promise<{ feedback: SentenceFeedback; cached: boolean }> {
  const r = await cached(db, 'check', input, () => structuredCall({
    apiKey: deps.apiKey,
    model: HAIKU_MODEL,
    fallbackModel: SONNET_MODEL,
    system: SENTENCE_CHECK_SYSTEM,
    user: userTurn(input),
    tool: CHECK_TOOL,
    maxTokens: 500,
    attempts: 2,
    timeoutMs: 20_000,
    validate: (raw) => normalizeSentenceFeedback(raw, input),
    client: deps.client,
  }), (f) => f.grade ?? f.verdict);
  // A cached check goes through the guard again (a rule added since never shows green over a correction).
  const feedback = r.cached ? normalizeSentenceFeedback(r.value, input) : r.value;
  return { feedback, cached: r.cached };
}

/**
 * What the check found wrong with this sentence: the server's own cached check of the same input (the check always
 * runs first), else the app's copy (`clientProblem` — prompt text only, never trusted for anything else), else ''.
 */
export async function sentenceProblemFor(db: D1Database | null | undefined, input: SentenceMakingInput, clientProblem?: unknown): Promise<string> {
  const check = await readCached<SentenceFeedback>(db, 'check', input);
  if (check) {
    try {
      const problem = sentenceFixProblem(normalizeSentenceFeedback(check, input), input.words);
      if (problem) return problem;
    } catch {
      // An unreadable cached check: fall through to the app's copy.
    }
  }
  return cleanSentenceFixProblem(clientProblem);
}

export async function fixMadeSentence(
  db: D1Database | null | undefined,
  input: SentenceMakingInput,
  deps: SentenceMakingDeps,
  clientProblem?: unknown,
): Promise<{ fix: SentenceFix; cached: boolean; problem: string }> {
  const problem = await sentenceProblemFor(db, input, clientProblem);
  const r = await cached(db, 'fix', input, async () => {
    let fix: SentenceFix;
    try {
      fix = await structuredCall({
        apiKey: deps.apiKey,
        model: HAIKU_MODEL,
        fallbackModel: SONNET_MODEL,
        system: SENTENCE_FIX_SYSTEM,
        user: userTurn(input, problem),
        tool: FIX_TOOL,
        maxTokens: 400,
        attempts: 3,
        timeoutMs: 20_000,
        validate: (raw) => normalizeSentenceFix(raw, input.sentence),
        repair: (error) => sentenceFixRepairNote(error, problem),
        client: deps.client,
      });
    } catch (error) {
      // Every attempt answered, and none was a fix: asking again won't help (502, not a retryable 503).
      if (error instanceof StructuredCallError && error.last instanceof SentenceFixRejected) {
        throw new StructuredCallError(SENTENCE_FIX_FAILED, false, error.last);
      }
      throw error;
    }
    // The model's pinyin through the 一 / 不 rule; the app's own when it gave none.
    const pinyin = fix.pinyin ? applyYiBuToneChanges(fix.hanzi, fix.pinyin) : appPinyin(fix.hanzi);
    return pinyin ? { ...fix, pinyin } : fix;
  }, () => 'fix');
  return { fix: r.value, cached: r.cached, problem };
}
