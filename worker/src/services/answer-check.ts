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
 * `askAboutAnswer` is the follow-up ("💬 Ask about this"): a short reply in English about this
 * exercise, the answer and the check, with the conversation so far.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  answerCheckCacheText, normalizeAnswerCheck, ANSWER_CHECK_VERSION,
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

/** The user turn the model sees. */
export function answerCheckUserTurn(input: AnswerCheckInput): string {
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

export function withPinyin(check: AnswerCheck): AnswerCheck {
  const out: AnswerCheck = { ...check, corrected_pinyin: check.corrected ? appPinyin(check.corrected) : '' };
  if (check.alternative) out.alternative = { ...check.alternative, pinyin: appPinyin(check.alternative.hanzi) };
  return out;
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

/** Cached for everyone; a cache miss asks the model and stores the result. */
export async function checkLessonAnswer(
  db: D1Database,
  input: AnswerCheckInput,
  deps: AnswerCheckDeps,
): Promise<{ check: AnswerCheck; cached: boolean }> {
  const hash = await answerCheckHash(input);
  try {
    const row = await db.prepare('SELECT check_json FROM lesson_answer_checks WHERE hash = ? AND version = ?')
      .bind(hash, ANSWER_CHECK_VERSION).first<{ check_json: string }>();
    if (row) return { check: normalizeAnswerCheck(JSON.parse(row.check_json), input.answer), cached: true };
  } catch (error) {
    console.warn('[answer-check] cache read failed:', error instanceof Error ? error.message : error);
  }
  const check = await runAnswerCheck(input, deps);
  try {
    await db.prepare(
      'INSERT OR REPLACE INTO lesson_answer_checks (hash, version, exercise_type, verdict, check_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(hash, ANSWER_CHECK_VERSION, input.exercise_type, check.verdict, JSON.stringify(check), new Date().toISOString()).run();
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
