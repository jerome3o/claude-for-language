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
  answerCheckCacheText, normalizeAnswerCheck, spokenAnswerCheck, isSpeakingCheckType, isMeaningCheck, isReadAloudCheck, isScrambleCheck, speakingTaskParts, suggestedFor,
  ANSWER_CHECK_VERSION, SPEAKING_CHECK_VERSION, SCRAMBLE_CHECK_VERSION,
  type AnswerCheck, type AnswerCheckInput,
} from '@shared/lesson/answerCheck';
import { forgiveUnheard } from '@shared/lesson/heardCheck';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { digitsToHanzi } from '@shared/text/numberHanzi';
import { scrubSpokenTranscript, spokenCheckAnswer } from '@shared/cards/answer';
import { structuredCall } from './structured-call';
import { pinyinProLine } from './pinyin-check';

export const ANSWER_CHECK_MODEL = 'claude-haiku-4-5';
export const ANSWER_CHECK_FALLBACK_MODEL = 'claude-sonnet-5';

export const ANSWER_CHECK_SYSTEM = `You check ONE answer a learner of Chinese gave in a lesson exercise: they were shown an English sentence and said or typed it in Chinese. A model answer is given, but it is only ONE way to say it.

Two different texts — never mix them up:
- <learner_answer>…</learner_answer> is what the LEARNER said or typed. It is the ONLY thing you judge, and every quote in a tip comes from it.
- <model_answer>…</model_answer> is a reference someone else wrote. It is NOT the learner's answer: never describe its wording or word order as theirs.
Before you write anything, read <learner_answer> again: never tell the learner to do something their answer already does, and never suggest a change that turns their text into itself.

Verdicts:
- "correct": grammatical, natural, means what the English says. Wording may differ freely from the model answer.
- "acceptable": right and understandable, a native speaker would accept it — just phrased differently, a little plainer or less idiomatic than the model. Never call different-but-valid wording wrong.
- "almost": the meaning is there but there is a real slip a teacher would correct: a wrong particle or negation (不 where a command needs 别 / 不要), a connector that can't join those words (和 between two verb phrases), a missing measure word, wrong word order, a clipped or unnatural ending.
- "wrong": it doesn't say what the English says, or it is ungrammatical enough to be misunderstood.

Rules:
- Judge THEIR sentence, not how close it is to the model answer. Optional words (很 inside a 即使 clause, 了, 的, a subject left out where Chinese drops it) never make an answer wrong.
- A different but natural word order or wording is right — "correct", with no "but" and no tip about it. E.g. a 因为 clause before the subject (因为这个问题，我睡不着觉) and after it (我因为这个问题睡不着觉) are both natural.
- Headline and tips agree with the verdict. For "correct" / "acceptable" the headline is plainly positive — no "but", "however" or "should" — unless there is a real, specific problem in the learner's own words, quoted from <learner_answer>. Tips on a right answer are optional extras, never criticism of what they did right.
- Never write a tip that compares a text with itself ("X reads better than X"), and never recommend the learner's own sentence back to them.
- State the ACTUAL rule, and keep every line consistent with your own correction: never tell the learner to avoid a word or a combination that your corrected sentence still uses, and never offer the learner's wrong form (or the part of it you are correcting) as an option, a fix or an alternative. E.g. for 三块多元 (two money units stacked): "块 and 元 are both units — use one: 三块多（钱） or 三元多." — NOT "use 钱 or 块 alone, not both" (三块多钱 uses both, and 块钱 is normal) and never "…or 块多元".
- Numbers: Arabic digits and Chinese numerals are the same (3 = 三, 10 = 十); never fault one for the other, and write numbers in your corrected sentence in Chinese numerals.
- If the answer was SPOKEN it is a speech-recognition transcript, not their writing — never fault the learner for the recogniser:
  - Its punctuation has already been removed: read it as ONE continuous utterance. When the learner pauses, the recogniser writes 。 or ， or starts a new sentence; a pause is nothing. Never call a spoken answer a fragment, incomplete, split, run-on or "two sentences", and never mention punctuation in the headline or tips.
  - Fillers (嗯, 那个, 就是), a restart or a repeated word are not mistakes; when a near-sound character makes no sense but the intended word is clear from context, read the intended word.
  - Read a wrong character that sounds like the right one (在/再, 他/她, 的/得, homophones) as the right one.
  - A single short unstressed word missing or doubled (是, 的, 了, 一, 个, 着, 吧, 呢, 啊) is almost always the recogniser's slip, not the learner's: when that is the only difference, the verdict is "correct" (at worst "acceptable") with no tip about it — never "almost" or "wrong" for it.
  - Still judge honestly what the recogniser can't explain: a wrong or missing content word, a wrong meaning, a negation, wrong word order.
- corrected: their OWN sentence with the smallest change that fixes it (keep their words and structure). Empty when the verdict is correct or acceptable.
- headline: one short line in English (≤ 12 words) saying what is right or what to change.
- tips: 0–3 short lines in English, each about one point. Quote the exact Chinese at fault in "quote", copied from <learner_answer>, and say what to use instead and why, e.g. "也不着急 is a statement (\\"you're not anxious\\"); a command needs 别 → 也别着急." or "和 links nouns, not two actions — use a comma or 然后." No tips when there is nothing useful to add; never pad.
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

// ============ Meaning (Hard mode's "Sentences by ear") ============

/**
 * What the ear can't tell (shared/lesson/heardCheck.ts, Jerome Nov 2026: 她责怪我 answered "He blames me" came back
 * "≈ Nearly · Wrong subject"): every check of an answer to Chinese the learner only HEARD (listen_translate — the
 * Sentence round's listen slot, a mini lesson's "Listen and translate"; answered in English or Chinese) carries it.
 * `forgiveUnheard` enforces it after the model.
 */
export const HEARD_ONLY_RULE = `- They only HEARD the Chinese — never count against them what the ear can't tell, and don't mention it (no tip, no "but"):
  - 他 / 她 / 它 (and 他们 / 她们 / 它们) all sound tā(men): he, she or it (him / her, his / her / its) are the SAME answer wherever the Chinese has one of them, and in Chinese 他 / 她 / 它 are interchangeable. E.g. heard 她责怪我 → "He blames me" is "correct"; 他责怪我 is "correct".
  - A tense or aspect the Chinese doesn't mark: with no 了 / 过 / 着 / 在 / 正在 / 会 / 将 / 要 / 没 / 已经 / 刚 or time word (昨天, 明天, 以前…) fixing it, "blames", "blamed", "is blaming" and "will blame" are all right. E.g. 她责怪我 → "She blamed me" = "She blames me".
  - Singular vs plural the Chinese doesn't mark (no number, 几 / 些 / 们): "a book" = "books".
  - Still count what the ear CAN tell: I / you / we vs he / she (我 / 你 / 我们 sound different), who did what to whom, a wrong verb or object, a missed or added negation, and a tense the Chinese DOES mark (她明天会责怪我 answered "She blamed me" is wrong on the time).`;

export const MEANING_CHECK_SYSTEM = `You check whether a learner of Chinese UNDERSTOOD a Chinese sentence they only HEARD (no text). They said or typed what it means in English. You get the Chinese sentence, its reference English translation (only ONE way to put it) and their English.

Verdicts:
- "correct": they got the meaning — every part that matters (who, what, when, negation, the key word) is there. Wording, word order, tense nuance, articles and synonyms never matter ("I'm going to the bank" = "I go to the bank").
- "acceptable": the meaning is clearly understood with a small slip that doesn't change it (a missed 也 / 都 / 就, a vaguer word for the same thing, a slightly wrong time word that doesn't matter).
- "almost": the gist is there but a part that matters is missing or wrong (missed the negation, the wrong person — I / you / we vs he / she, never he vs she —, the wrong place / time, the main verb misheard).
- "wrong": they didn't understand it — a different meaning, or only a word or two.

Rules:
- Judge the MEANING, never their English grammar or spelling. A spoken answer is a speech-recognition transcript: ignore punctuation, sentence breaks (a pause is nothing), dropped little words and obvious recognition slips.
${HEARD_ONLY_RULE}
- headline: one short line in English (≤ 12 words) saying what they got or missed.
- tips: 0–2 short lines in English about what they misheard or missed. Quote the exact Chinese words in "quote" (copied from the sentence) and say what they mean, e.g. "没 makes it negative — they did NOT go." No tips when the meaning is right; never pad.
- corrected: always empty.
- Answer with the check_answer tool.`;

/** The user turn of a meaning check (`isMeaningCheck`): the Chinese heard, the reference English, his English. */
export function meaningCheckUserTurn(input: AnswerCheckInput): string {
  const spoken = input.input === 'spoken' || input.input === 'edited';
  return [
    `Chinese sentence they heard: ${input.prompt_en}${input.model_pinyin ? ` (${input.model_pinyin})` : ''}`,
    `Reference English: ${input.model_answer}`,
    `What they said it means${spoken ? ' (SPOKEN — speech-recognition transcript)' : ' (typed)'}: ${input.answer}`,
  ].join('\n');
}

// ============ Read aloud (a read card's take, shared/study/readTakeCheck.ts) ============

export const READ_ALOUD_CHECK_SYSTEM = `You check ONE recording of a learner of Chinese READING a flashcard's Chinese ALOUD. You get the card's Chinese (what they were reading), what it means, and a speech-recognition TRANSCRIPT of their reading. The device already compared them by sound and found a difference it can't explain; decide what the difference means.

The transcript is the recogniser's, not their writing — never fault the learner for the recogniser:
- Ignore punctuation, quote marks, spacing and sentence breaks COMPLETELY (a pause is nothing). Never mention punctuation.
- A character that sounds like the card's (在/再, 他/她, 的/得, other homophones) is the card's character.
- A single short unstressed word missing or doubled (是, 的, 了, 一, 个, 着, 吧, 呢, 啊) is the recogniser's slip.
- Numbers written as digits are the same as in characters.

Verdicts:
- "correct": they read it as written — every difference is one of the recogniser's above.
- "almost": they read it nearly right: a word came out as a DIFFERENT WORD WITH THE SAME OR A VERY CLOSE MEANING (英语 for 英文, 这儿 for 这里, 觉得 for 认为 — a misread, or the recogniser's choice), or one word misread / left out / added while the rest is right. A same-meaning word is ALWAYS "almost" at worst, never "wrong".
- "wrong": they read something different — the meaning changes (a negation lost or added, a different content word with another meaning AND more besides), or much of it is missing or unrecognisable.

Fields:
- headline: ONE short line in English (≤ 14 words) naming the difference, quoting the Chinese: e.g. "You said 英语 — the card has 英文 (same meaning)." For "correct": "Read right — the recogniser just wrote it differently."
- tips: for "almost" / "wrong", at most 1 short line in English about the word to read again (quote the card's Chinese in "quote"); none for "correct".
- corrected: always empty (the card's Chinese is the answer).
- No alternative. Answer with the check_answer tool.`;

/** The user turn of a read-aloud check. */
export function readAloudCheckUserTurn(input: AnswerCheckInput): string {
  return [
    `The card's Chinese (what they READ ALOUD): ${input.model_answer}${input.model_pinyin ? ` (${input.model_pinyin})` : ''}`,
    `It means: ${input.prompt_en}`,
    `Transcript of their reading (speech recognition, punctuation removed — read it as one continuous utterance; little words are the recogniser's): ${scrubSpokenTranscript(input.answer)}`,
  ].join('\n');
}

/** A read-aloud verdict is right, close or a miss: "acceptable" (also right) reads as close; nothing to correct. */
export function readAloudVerdict(check: AnswerCheck): AnswerCheck {
  const verdict = check.verdict === 'acceptable' ? 'almost' : check.verdict;
  const out: AnswerCheck = { ...check, verdict, corrected: '', corrected_pinyin: '', suggested: suggestedFor(verdict) };
  delete out.alternative;
  if (verdict === 'correct') out.tips = [];
  return out;
}

// ============ Word order (a scramble built in an order the lesson didn't list) ============

export const SCRAMBLE_CHECK_SYSTEM = `You check ONE word-order exercise from a Chinese lesson. The learner was shown an English sentence and a set of Chinese tiles, and arranged ALL the tiles into a sentence. The lesson's expected order is ONE right order, often not the only one. The learner's order is different from it. Decide whether THEIR order is also right.

Two different orders — never mix them up:
- <expected_order>…</expected_order> is the lesson's order, a reference written by someone else.
- <learner_order>…</learner_order> is the order the LEARNER built. It is the ONLY thing you judge; every quote comes from it.
Both use exactly the same tiles; the tiles can't be changed, only moved.

Verdicts:
- "correct": their order is natural, grammatical Chinese a native speaker would say, and it means what the English says. Examples of orders that are BOTH right:
  - 一…就 with the subject before 一 or only in the second clause, before 就: 孩子一看见蛋糕就高兴起来了 and 一看见蛋糕孩子就高兴起来了 (like 一到家，我就睡觉了).
  - A time or place phrase before or after the subject: 我明天去北京 and 明天我去北京.
  - A 因为 / 虽然 / 如果 clause before or after the subject: 因为下雨，我没去 and 我因为下雨没去.
- "acceptable": grammatical with the same meaning; a native speaker would accept it, just a little less usual or with a slightly different emphasis.
- "almost": possible but stilted or unnatural — a native speaker would understand it but wouldn't say it that way.
- "wrong": ungrammatical, or the order changes the meaning (who does what to whom, what is negated, what a word describes).

Rules:
- Never call an order wrong only because it differs from the expected order. Missing or moved punctuation never matters.
- headline: ONE short line in English (≤ 16 words). If right: why their order also works ("With 一…就 the subject can come after the first clause."). If not: the one reason, quoting the Chinese at fault from <learner_order> ("就 must come right before the verb: 就高兴起来了.").
- tips: at most 1 short line, only when it adds something; quote the Chinese from <learner_order>. None for a right order unless it teaches something.
- corrected: always empty (the tiles are fixed — the expected order is shown already). No alternative.
- Answer with the check_answer tool.`;

/** The user turn of a word-order check: the English, the expected order and his order, each with its tiles. */
export function scrambleCheckUserTurn(input: AnswerCheckInput): string {
  const sentence = (order: string) => order.replace(/\s+/g, '');
  const tiles = (order: string) => order.split(/\s+/).filter(Boolean).join(' / ');
  return [
    input.focus ? `Lesson focus: ${input.focus}` : null,
    `English: ${input.prompt_en}`,
    `Expected order (the lesson's — a reference, NOT the learner's): <expected_order>${sentence(input.model_answer)}</expected_order>`,
    `Expected order tiles: ${tiles(input.model_answer)}`,
    `The learner's order — the only one you judge: <learner_order>${sentence(input.answer)}</learner_order>`,
    `Learner order tiles: ${tiles(input.answer)}`,
  ].filter(Boolean).join('\n');
}

/** A word order: the tiles are fixed, so nothing to correct and no alternative; at most one tip. */
export function scrambleVerdict(check: AnswerCheck): AnswerCheck {
  const out: AnswerCheck = { ...check, corrected: '', corrected_pinyin: '', tips: check.tips.slice(0, 1) };
  delete out.alternative;
  return out;
}

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
    `Transcript of their recording (speech recognition, punctuation removed — pauses are not sentence breaks): ${scrubSpokenTranscript(input.answer)}`,
  ].filter(Boolean).join('\n');
}

/** The user turn the model sees. */
export function answerCheckUserTurn(input: AnswerCheckInput): string {
  if (isSpeakingCheckType(input.exercise_type)) return speakingCheckUserTurn(input);
  if (isReadAloudCheck(input.exercise_type)) return readAloudCheckUserTurn(input);
  if (isScrambleCheck(input.exercise_type)) return scrambleCheckUserTurn(input);
  if (isMeaningCheck(input)) return meaningCheckUserTurn(input);
  const spoken = input.input === 'spoken' || input.input === 'edited';
  // A pause is never grammar: a spoken answer reaches Claude without the recogniser's punctuation (scrubSpokenTranscript).
  const answer = spokenCheckAnswer(input.answer, input.input);
  return [
    input.focus ? `Lesson focus: ${input.focus}` : null,
    input.exercise_type === 'listen_translate'
      ? `The learner heard a Chinese sentence meaning: ${input.prompt_en}\nThey ${spoken ? 'said back' : 'wrote down'} what they heard / understood, in Chinese.\n${HEARD_ONLY_RULE}`
      : `English to say in Chinese: ${input.prompt_en}`,
    `Model answer (a reference written by someone else — NOT the learner's answer):\n<model_answer>${input.model_answer}</model_answer>${input.model_pinyin ? `\nModel answer pinyin: ${input.model_pinyin}` : ''}`,
    `The learner's answer${spoken ? input.input === 'edited' ? ' (spoken, then edited by hand)' : ' (SPOKEN — speech-recognition transcript with the recogniser\'s punctuation removed: one continuous utterance; pauses and little words are the recogniser\'s, not the learner\'s)' : ' (typed)'} — the only text you judge:\n<learner_answer>${answer}</learner_answer>`,
  ].filter(Boolean).join('\n');
}

/** Pinyin the app's way (pinyin-pro by word + the 一 / 不 tone changes), never the model's. */
export function appPinyin(hanzi: string): string {
  if (!hanzi) return '';
  // Digits are read as numerals (这个牛角包3块多钱 → … sān kuài …): pinyin-pro leaves a digit out.
  const text = digitsToHanzi(hanzi);
  try {
    return applyYiBuToneChanges(text, pinyinProLine(text));
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
  if (isScrambleCheck(exerciseType)) return SCRAMBLE_CHECK_VERSION;
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
    system: isReadAloudCheck(input.exercise_type) ? READ_ALOUD_CHECK_SYSTEM
      : isScrambleCheck(input.exercise_type) ? SCRAMBLE_CHECK_SYSTEM
        : isMeaningCheck(input) ? MEANING_CHECK_SYSTEM : ANSWER_CHECK_SYSTEM,
    user: answerCheckUserTurn(input),
    tool: TOOL,
    maxTokens: 700,
    attempts: 2,
    timeoutMs: 15_000,
    validate: (raw) => normalizeAnswerCheck(raw, input.answer, input.model_answer, spokenAnswerCheck(input)),
    onUsage: deps.onUsage,
    client: deps.client,
  });
  if (isScrambleCheck(input.exercise_type)) return withPinyin(scrambleVerdict(check));
  if (isReadAloudCheck(input.exercise_type)) return withPinyin(readAloudVerdict(check));
  // Heard only (listen_translate): he / she / it, an unmarked tense or number are never faults by ear.
  return withPinyin(forgiveUnheard(check, input));
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
      const c = normalizeAnswerCheck(raw, input.answer, input.model_answer, spokenAnswerCheck(input));
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
    if (row) return { check: forgiveUnheard(normalizeAnswerCheck(JSON.parse(row.check_json), input.answer, input.model_answer, spokenAnswerCheck(input)), input), cached: true };
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
    // The Chinese-answer turn carries it already; a meaning check's lives in its system prompt.
    isMeaningCheck(input) ? HEARD_ONLY_RULE : null,
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
