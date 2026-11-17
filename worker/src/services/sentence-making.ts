/**
 * Claude's check of a sentence the learner made in a sentence_making lesson exercise (rules in
 * shared/lesson/sentenceCheck.ts; docs/STUDY_SESSION.md "Sentence making: an honest verdict"):
 *
 * - `checkMadeSentence` — the grade (right · needs_work · wrong), ONE headline, at most one short reason, a
 *   `fixable` flag. Fast (the learner is mid-lesson): the small model through structuredCall (forced tool, thinking
 *   off, a short budget), the coherence guard applied to whatever comes back. NO corrected sentence here.
 * - `fixMadeSentence` — ✨ Show a fixed version, only on tap: HIS sentence with the smallest edits that fix it.
 *
 * Both are cached for everyone in `lesson_answer_checks` by SHA-256 of `sentenceCheckCacheText` (the words, the
 * task, his sentence without punctuation): the same sentence for the same exercise is never asked twice.
 * A SPOKEN sentence arrives scrubbed of the recogniser's punctuation (`scrubSpokenTranscript`).
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  normalizeSentenceFeedback, normalizeSentenceFix, sentenceCheckCacheText,
  SENTENCE_CHECK_CACHE_TYPE, SENTENCE_CHECK_VERSION, SENTENCE_FIX_CACHE_TYPE, SENTENCE_FIX_VERSION,
  type SentenceCheckInput, type SentenceFeedback, type SentenceFix,
} from '@shared/lesson/sentenceCheck';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { structuredCall } from './structured-call';
import { HAIKU_MODEL, SONNET_MODEL } from './models';
import { appPinyin } from './answer-check';

export { withoutPunctuation } from '@shared/lesson/sentenceCheck';

/** The transcript rule every spoken check carries (the speaking check's graciousness, short). */
export const SPOKEN_SENTENCE_RULE = `The sentence may be SPOKEN: a speech-recognition transcript, already stripped of the recogniser's punctuation.
- Read it as ONE continuous utterance. Punctuation and sentence breaks come from where the learner paused — never judge them, never mention punctuation, never call it split, a fragment, a run-on or "two sentences".
- Fillers (嗯, 那个, 就是), a restart or a repeated word are not mistakes.
- A wrong character that sounds like the right one (在/再, 他/她, 的/得/地, 有/又) is the recogniser's: read the word the learner clearly meant from the context.
- Judge the words, grammar and word order only.`;

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

export const SENTENCE_FIX_SYSTEM = `A Chinese learner made their own sentence with some target words, and it needs a fix. Fix THEIR sentence with the SMALLEST edits that make it natural and make it hang together: keep their idea, their words and their structure wherever you can (e.g. 我本来要去健身馆，但是我学中文。 → 我本来要去健身房，可是后来去学中文了。). Keep every target word. Give the fixed sentence in simplified characters, its English, and pinyin with tone marks.

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

function userTurn(input: SentenceMakingInput): string {
  const spoken = input.input === 'spoken' || input.input === 'edited';
  return [
    `Target words: ${input.words.join('、')}`,
    input.task ? `Task: ${input.task}` : null,
    `The learner's sentence${spoken ? ' (SPOKEN — speech-recognition transcript, punctuation removed)' : ''}: ${input.sentence.trim()}`,
  ].filter(Boolean).join('\n');
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read / write one cached JSON (`lesson_answer_checks`); a failure is only logged. */
async function cached<T>(
  db: D1Database | null | undefined, kind: 'check' | 'fix', input: SentenceMakingInput, make: () => Promise<T>, verdictOf: (v: T) => string,
): Promise<{ value: T; cached: boolean; raw?: unknown }> {
  const type = kind === 'check' ? SENTENCE_CHECK_CACHE_TYPE : SENTENCE_FIX_CACHE_TYPE;
  const version = kind === 'check' ? SENTENCE_CHECK_VERSION : SENTENCE_FIX_VERSION;
  const hash = await sha256(sentenceCheckCacheText(input, kind));
  if (db) {
    try {
      const row = await db.prepare('SELECT check_json FROM lesson_answer_checks WHERE hash = ? AND version = ?').bind(hash, version).first<{ check_json: string }>();
      if (row) return { value: JSON.parse(row.check_json) as T, cached: true, raw: JSON.parse(row.check_json) };
    } catch (error) {
      console.warn('[sentence-making] cache read failed:', error instanceof Error ? error.message : error);
    }
  }
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

export async function fixMadeSentence(
  db: D1Database | null | undefined,
  input: SentenceMakingInput,
  deps: SentenceMakingDeps,
): Promise<{ fix: SentenceFix; cached: boolean }> {
  const r = await cached(db, 'fix', input, async () => {
    const fix = await structuredCall({
      apiKey: deps.apiKey,
      model: HAIKU_MODEL,
      fallbackModel: SONNET_MODEL,
      system: SENTENCE_FIX_SYSTEM,
      user: userTurn(input),
      tool: FIX_TOOL,
      maxTokens: 400,
      attempts: 2,
      timeoutMs: 20_000,
      validate: (raw) => normalizeSentenceFix(raw, input.sentence),
      client: deps.client,
    });
    // The model's pinyin through the 一 / 不 rule; the app's own when it gave none.
    const pinyin = fix.pinyin ? applyYiBuToneChanges(fix.hanzi, fix.pinyin) : appPinyin(fix.hanzi);
    return pinyin ? { ...fix, pinyin } : fix;
  }, () => 'fix');
  return { fix: r.value, cached: r.cached };
}
