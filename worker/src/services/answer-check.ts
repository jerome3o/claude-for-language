/**
 * Claude's check of a self-assessed lesson answer (shared/lesson/answerCheck.ts): the learner said
 * or typed a Chinese sentence for an English prompt; is it right, also right, almost or wrong —
 * with the minimal fix, short tips quoting the Chinese at fault, and a natural alternative.
 *
 * Fast and cheap (the learner is mid-lesson, the reveal is already on screen): Haiku through
 * structuredCall (forced tool, thinking off, low max_tokens, Sonnet as the last-attempt fallback).
 * Cached for everyone by SHA-256 of `answerCheckCacheText` in `lesson_answer_checks`
 * (migration 0127): the same answer to the same exercise is never asked twice.
 *
 * Free speaking (oral_expression / speak, `isSpeakingCheckType`) is a longer, kinder judgement of a
 * recording's transcript: the larger model first (the smaller one as the last-attempt fallback),
 * its own prompt and tool (`check_speaking`) — see SPEAKING_CHECK_SYSTEM.
 *
 * `askAboutAnswer` is the follow-up ("💬 Ask about this"): a short reply in English about this
 * exercise, the answer and the check, with the conversation so far.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  answerCheckCacheText, normalizeAnswerCheck, isSpeakingCheckType, speakingTaskParts,
  ANSWER_CHECK_VERSION, SPEAKING_CHECK_VERSION,
  type AnswerCheck, type AnswerCheckInput,
} from '@shared/lesson/answerCheck';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { structuredCall } from './structured-call';
import { pinyinProLine } from './pinyin-check';

export const ANSWER_CHECK_MODEL = 'claude-haiku-4-5';
export const ANSWER_CHECK_FALLBACK_MODEL = 'claude-sonnet-5';

export const ANSWER_CHECK_SYSTEM = `You check ONE answer a learner of Chinese gave in a lesson exercise: they were shown an English sentence and said or typed it in Chinese. A model answer is given, but it is only ONE way to say it.

Verdicts:
- "correct": grammatical, natural, means what the English says. Wording may differ freely from the model answer.
- "acceptable": right and understandable, a native speaker would accept it — just phrased differently, a little plainer or less idiomatic than the model. Never call different-but-valid wording wrong.
- "almost": the meaning is there but there is a real slip a teacher would correct: a wrong particle or negation (不 where a command needs 别 / 不要), a connector that can't join those words (和 between two verb phrases), a missing measure word, wrong word order, a clipped or unnatural ending.
- "wrong": it doesn't say what the English says, or it is ungrammatical enough to be misunderstood.

Rules:
- Judge THEIR sentence, not how close it is to the model answer. Optional words (很 inside a 即使 clause, 了, 的, a subject left out where Chinese drops it) never make an answer wrong.
- If the answer was SPOKEN it is a speech-recognition transcript: ignore punctuation, and read a wrong character that sounds like the right one (在/再, 他/她, 的/得) as the right one — never fault the learner for the recogniser.
- corrected: their OWN sentence with the smallest change that fixes it (keep their words and structure). Empty when the verdict is correct or acceptable.
- headline: one short line in English (≤ 12 words) saying what is right or what to change.
- tips: 0–3 short lines in English, each about one point. Quote the exact Chinese at fault in "quote" and say what to use instead and why, e.g. "也不着急 is a statement (\\"you're not anxious\\"); a command needs 别 → 也别着急." or "和 links nouns, not two actions — use a comma or 然后." No tips when there is nothing useful to add; never pad.
- alternative: optionally ONE natural, idiomatic way a native speaker would say it (hanzi + English), only when it teaches something beyond the correction (e.g. 即使再便宜, 多练习就好了). Omit otherwise.
- Stay on the lesson's focus when one is given. No pinyin needed. Answer with the check_answer tool.`;

const TOOL = {
  name: 'check_answer',
  description: 'Return the verdict on the learner\'s answer, a one-line headline, the minimal correction, tips and an optional natural alternative.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: ['correct', 'acceptable', 'almost', 'wrong'] },
      headline: { type: 'string', description: 'One short line in English' },
      corrected: { type: 'string', description: 'The learner\'s own sentence minimally fixed (hanzi only); empty when correct / acceptable' },
      tips: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One short line in English' },
            quote: { type: 'string', description: 'The exact Chinese the tip is about' },
          },
          required: ['text'],
        },
      },
      alternative: {
        type: 'object',
        properties: { hanzi: { type: 'string' }, english: { type: 'string' } },
        required: ['hanzi'],
      },
    },
    required: ['verdict', 'headline', 'corrected', 'tips'],
  },
};

// ============ Free speaking ============

export const SPEAKING_CHECK_SYSTEM = `You are a warm, encouraging Chinese tutor marking ONE spoken answer from a learner in a lesson's free speaking exercise. You get the task, any "useful words", sometimes a model answer (only ONE way to do it — never mark them against it) and a speech-recognition TRANSCRIPT of their recording, often a minute or more long.

Be gracious. The learner is speaking freely and will misspeak. NONE of these count against them, are mentioned in tips, or appear in the cleaned version:
- false starts, restarts and self-corrections ("你就是…你就是新来的…") — judge only their FINAL attempt at each bit;
- apologies and asides: "sorry", "wait", "um", "嗯", "那个", "怎么说", English words or whole English sentences said to themselves;
- repeating a word or a sentence;
- PUNCTUATION: the transcript's punctuation is the recogniser's guess. Ignore it completely — odd, extra or missing commas and full stops are never a mistake, never lower the verdict, are never mentioned, and are never changed in the cleaned version;
- sound-alike wrong characters (在/再, 他/她, 的/得/地, 做/作, 那/哪) and homophones: read them as what they meant — the recogniser wrote them, not the learner.
Work out what they MEANT to say, then judge that.

Then look for what a good teacher would really correct: grammar, word choice, word order, measure words, missing or wrong particles and verb complements, a structure from the task used wrongly. Do not nitpick what is fine in spoken Chinese (dropped subjects, 了 / 的 / 吧 / 啊 that are optional, a simpler word than the model's, casual phrasing).

Fields:
- cleaned: what they meant, in Chinese — the transcript with the disfluencies, asides, English and repeats removed, keeping THEIR words, word order and mistakes. Same content and errors as they said it. Keep English names they used (Annie).
- corrected: "a cleaner version" — the cleaned text with only the real mistakes fixed (keep their words and structure). Empty when nothing needs fixing.
- parts: when the task lists numbered parts (① ② ③…), one entry per part in order, label = the marker + its structure exactly as given (e.g. "① 就是…吧"); status "used" (they did it and the structure is right), "used_with_issue" (they did it but with a slip in that structure), "missing" (not done or the structure not used). note: one short English line quoting what they said for it, or what to add. Without numbered parts, list the task's 2–4 main asks the same way (short English labels), or none for a single, simple ask.
- tips: at most 4, the most useful first; each about ONE real point: "quote" = their exact Chinese words at fault (as in the transcript, copied exactly), "fix" = the better Chinese for those words, "text" = one short English line saying why (include pinyin with tone marks for the fixed words). No tips for disfluencies or punctuation; never pad — fewer is fine.
- verdict: "correct" = did the task and what they meant is natural and grammatical; "acceptable" = did the task and is clearly understandable, with a slip or two (most good answers); "almost" = a part of the task is missing or a target structure is misused, or several real errors; "wrong" = off-task or mostly not understandable.
- headline: one short, encouraging English line (≤ 14 words): what went well and the one thing to fix.
- Stay on the lesson's focus when one is given. Answer with the check_speaking tool.`;

const SPEAKING_TOOL = {
  name: 'check_speaking',
  description: 'Return the verdict on the learner\'s spoken answer, what they meant, a cleaner version, the task parts covered and the tips.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: ['correct', 'acceptable', 'almost', 'wrong'] },
      headline: { type: 'string', description: 'One short, encouraging line in English' },
      cleaned: { type: 'string', description: 'What they meant: the transcript without false starts, fillers, asides, English and repeats — their words and mistakes kept (Chinese)' },
      corrected: { type: 'string', description: 'The cleaned text with only the real mistakes fixed; empty when nothing needs fixing (Chinese)' },
      parts: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'The marker + structure exactly as in the task ("① 就是…吧"), or a short label' },
            status: { type: 'string', enum: ['used', 'used_with_issue', 'missing'] },
            note: { type: 'string', description: 'One short English line' },
          },
          required: ['label', 'status'],
        },
      },
      tips: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One short line in English, with the pinyin of the fix' },
            quote: { type: 'string', description: 'Their exact Chinese words the tip is about' },
            fix: { type: 'string', description: 'The better Chinese for those words' },
          },
          required: ['text', 'quote', 'fix'],
        },
      },
    },
    required: ['verdict', 'headline', 'cleaned', 'corrected', 'parts', 'tips'],
  },
};

/** The user turn for a speaking check. */
export function speakingCheckUserTurn(input: AnswerCheckInput): string {
  const parts = speakingTaskParts(input.prompt_en);
  return [
    input.focus ? `Lesson focus: ${input.focus}` : null,
    `Speaking task: ${input.prompt_en}`,
    parts.length
      ? `Numbered parts of the task:\n${parts.map((p) => `${p.marker} ${p.structure}${p.description ? ` — ${p.description}` : ''}`).join('\n')}`
      : null,
    input.question_audio ? `Question played to them in Chinese: ${input.question_audio}` : null,
    input.hints?.length ? `Useful words shown: ${input.hints.join('、')}` : null,
    input.model_answer ? `One way to say it (a model, NOT the only right answer): ${input.model_answer}` : null,
    `Transcript of their recording (speech recognition — punctuation is a guess): ${input.answer}`,
  ].filter(Boolean).join('\n');
}

/** The user turn the model sees. */
export function answerCheckUserTurn(input: AnswerCheckInput): string {
  if (isSpeakingCheckType(input.exercise_type)) return speakingCheckUserTurn(input);
  const spoken = input.input === 'spoken' || input.input === 'edited';
  return [
    input.focus ? `Lesson focus: ${input.focus}` : null,
    input.exercise_type === 'listen_translate'
      ? `The learner heard a Chinese sentence meaning: ${input.prompt_en}\nThey wrote down what they heard / understood, in Chinese.`
      : `English to say in Chinese: ${input.prompt_en}`,
    `Model answer: ${input.model_answer}${input.model_pinyin ? ` (${input.model_pinyin})` : ''}`,
    `Learner's answer${spoken ? input.input === 'edited' ? ' (spoken, then edited by hand)' : ' (SPOKEN — speech-recognition transcript)' : ' (typed)'}: ${input.answer}`,
  ].filter(Boolean).join('\n');
}

/** Pinyin the app's way (pinyin-pro by word + the 一 / 不 tone changes), never the model's. */
export function appPinyin(hanzi: string): string {
  if (!hanzi) return '';
  try {
    return applyYiBuToneChanges(hanzi, pinyinProLine(hanzi));
  } catch {
    return '';
  }
}

const SENTENCE_END: Record<string, string> = { '。': '.', '！': '!', '？': '?' };

/**
 * Pinyin of a longer spoken answer: clause by clause through `appPinyin`, sentence ends kept
 * ("…吧？ 欢迎…" → "… ba? huān yíng …") and words in Latin letters left as said (Annie).
 */
export function speechPinyin(text: string): string {
  const pieces = text.match(/[\p{Script=Han}，、；：]+|[^\p{Script=Han}，、；：]+/gu) ?? [];
  const out = pieces.map((p) => (/\p{Script=Han}/u.test(p) ? appPinyin(p) : p.replace(/[。！？]/g, (c) => SENTENCE_END[c] ?? c).replace(/[…]+/g, ' ')));
  return out.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
}

export function withPinyin(check: AnswerCheck): AnswerCheck {
  const line = check.cleaned ? speechPinyin : appPinyin;
  const out: AnswerCheck = { ...check, corrected_pinyin: check.corrected ? line(check.corrected) : '' };
  if (check.alternative) out.alternative = { ...check.alternative, pinyin: appPinyin(check.alternative.hanzi) };
  if (check.cleaned) out.cleaned_pinyin = speechPinyin(check.cleaned);
  if (check.tips.some((t) => t.fix)) out.tips = check.tips.map((t) => (t.fix ? { ...t, fix_pinyin: appPinyin(t.fix) } : t));
  return out;
}

/** The cache row's version for this exercise type. */
export function checkVersionFor(exerciseType: string): number {
  return isSpeakingCheckType(exerciseType) ? SPEAKING_CHECK_VERSION : ANSWER_CHECK_VERSION;
}

export async function answerCheckHash(input: AnswerCheckInput): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(answerCheckCacheText(input)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AnswerCheckDeps {
  apiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  onUsage?: (usage: { input_tokens: number; output_tokens: number }, model: string) => void;
}

/** One model call (no cache). */
export async function runAnswerCheck(input: AnswerCheckInput, deps: AnswerCheckDeps): Promise<AnswerCheck> {
  if (isSpeakingCheckType(input.exercise_type)) return runSpeakingCheck(input, deps);
  const check = await structuredCall({
    apiKey: deps.apiKey,
    model: ANSWER_CHECK_MODEL,
    fallbackModel: ANSWER_CHECK_FALLBACK_MODEL,
    system: ANSWER_CHECK_SYSTEM,
    user: answerCheckUserTurn(input),
    tool: TOOL,
    maxTokens: 700,
    attempts: 2,
    timeoutMs: 15_000,
    validate: (raw) => normalizeAnswerCheck(raw, input.answer),
    onUsage: deps.onUsage,
    client: deps.client,
  });
  return withPinyin(check);
}

/** A free-speaking answer: the longer judgement on the larger model, the smaller one as the last attempt. */
export async function runSpeakingCheck(input: AnswerCheckInput, deps: AnswerCheckDeps): Promise<AnswerCheck> {
  const check = await structuredCall({
    apiKey: deps.apiKey,
    model: ANSWER_CHECK_FALLBACK_MODEL,
    fallbackModel: ANSWER_CHECK_MODEL,
    system: SPEAKING_CHECK_SYSTEM,
    user: speakingCheckUserTurn(input),
    tool: SPEAKING_TOOL,
    maxTokens: 2000,
    attempts: 2,
    timeoutMs: 40_000,
    validate: (raw) => {
      const c = normalizeAnswerCheck(raw, input.answer);
      if (!c.cleaned) throw new Error('Speaking check without the cleaned text');
      return c;
    },
    onUsage: deps.onUsage,
    client: deps.client,
  });
  return withPinyin(check);
}

/** Cached for everyone; a cache miss asks the model and stores the result. */
export async function checkLessonAnswer(
  db: D1Database,
  input: AnswerCheckInput,
  deps: AnswerCheckDeps,
): Promise<{ check: AnswerCheck; cached: boolean }> {
  const hash = await answerCheckHash(input);
  try {
    const row = await db.prepare('SELECT check_json FROM lesson_answer_checks WHERE hash = ? AND version = ?')
      .bind(hash, checkVersionFor(input.exercise_type)).first<{ check_json: string }>();
    if (row) return { check: normalizeAnswerCheck(JSON.parse(row.check_json), input.answer), cached: true };
  } catch (error) {
    console.warn('[answer-check] cache read failed:', error instanceof Error ? error.message : error);
  }
  const check = await runAnswerCheck(input, deps);
  try {
    await db.prepare(
      'INSERT OR REPLACE INTO lesson_answer_checks (hash, version, exercise_type, verdict, check_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(hash, checkVersionFor(input.exercise_type), input.exercise_type, check.verdict, JSON.stringify(check), new Date().toISOString()).run();
  } catch (error) {
    console.warn('[answer-check] cache write failed:', error instanceof Error ? error.message : error);
  }
  return { check, cached: false };
}

// ============ 💬 Ask about this ============

export interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
}

const ASK_SYSTEM = `You are a friendly, precise Chinese tutor. The learner just answered a lesson exercise and got a short check of their answer; now they ask a follow-up question about it. Answer in English, in 1–4 short sentences (a short list only if they ask for options). Quote Chinese in characters (no pinyin unless asked). Be concrete about THEIR sentence. If their wording was fine, say so plainly. Answer with the reply tool.`;

const ASK_TOOL = {
  name: 'reply',
  description: 'Your reply to the learner.',
  input_schema: {
    type: 'object' as const,
    properties: { text: { type: 'string', description: '1–4 short sentences in English' } },
    required: ['text'],
  },
};

export function askContext(input: AnswerCheckInput, check: AnswerCheck | null): string {
  return [
    answerCheckUserTurn(input),
    check
      ? `The check said: ${check.verdict} — ${check.headline}${check.corrected ? `\nCorrected: ${check.corrected}` : ''}${check.tips.length ? `\nTips: ${check.tips.map((t) => t.text).join(' / ')}` : ''}${check.alternative ? `\nAlternative: ${check.alternative.hanzi}` : ''}`
      : null,
  ].filter(Boolean).join('\n');
}

export async function askAboutAnswer(
  input: AnswerCheckInput,
  check: AnswerCheck | null,
  history: AskTurn[],
  question: string,
  deps: AnswerCheckDeps,
): Promise<string> {
  const convo = history.slice(-8).map((t) => `${t.role === 'user' ? 'Learner' : 'Tutor'}: ${t.text}`).join('\n');
  const user = `${askContext(input, check)}${convo ? `\n\nConversation so far:\n${convo}` : ''}\n\nLearner's question: ${question}`;
  return structuredCall({
    apiKey: deps.apiKey,
    model: ANSWER_CHECK_MODEL,
    fallbackModel: ANSWER_CHECK_FALLBACK_MODEL,
    system: ASK_SYSTEM,
    user,
    tool: ASK_TOOL,
    maxTokens: 600,
    attempts: 2,
    timeoutMs: 20_000,
    validate: (raw) => {
      const text = typeof (raw as { text?: unknown })?.text === 'string' ? (raw as { text: string }).text.trim() : '';
      if (!text) throw new Error('Empty reply');
      return text.slice(0, 1500);
    },
    onUsage: deps.onUsage,
    client: deps.client,
  });
}
