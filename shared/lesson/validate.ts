/**
 * Structural validation for agent-authored lesson specs.
 *
 * Returns a list of human/agent-readable problems (empty = valid). Agents get
 * the full list back so they can repair the spec in one round.
 */

import { CustomLessonSpec, LessonExercise, LessonSentence } from './types';

const MAX_SECTIONS = 20;
const MAX_EXERCISES = 50;
const MAX_TILES = 14;
const MAX_MATCH_PAIRS = 8;
const MAX_TARGET_WORDS = 4;
const MAX_HINTS = 8;
const MAX_HANDWRITING_CHARS = 12;
const MAX_HANDWRITTEN_DICTATION_CHARS = 16;
const MAX_CONVERSATION_LINES = 24;
const MAX_CONVERSATION_QUESTIONS = 6;

/** Every exercise type the validator accepts, in catalogue order. */
export const EXERCISE_TYPE_IDS = [
  'note', 'scramble', 'choice', 'translate', 'match', 'describe_image', 'speak',
  'listen_choice', 'listen_translate', 'sentence_making', 'write_typed', 'write_handwriting',
  'dictation', 'oral_expression', 'conversation',
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkSentence(v: unknown, where: string, errors: string[]): void {
  if (!isRecord(v) || !nonEmptyString(v.hanzi)) {
    errors.push(`${where}: expected a sentence object with non-empty "hanzi"`);
  }
}

/** Tiles must be exactly a permutation of the order they're meant to form. */
function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of b) {
    const n = counts.get(t);
    if (!n) return false;
    counts.set(t, n - 1);
  }
  return true;
}

function checkExercise(ex: unknown, where: string, errors: string[]): void {
  if (!isRecord(ex)) {
    errors.push(`${where}: expected an exercise object`);
    return;
  }
  switch (ex.type) {
    case 'note': {
      const sentences = ex.sentences as unknown;
      const hasBody = nonEmptyString(ex.body);
      const hasSentences = Array.isArray(sentences) && sentences.length > 0;
      if (!hasBody && !hasSentences) {
        errors.push(`${where}: note needs "body" text and/or "sentences"`);
      }
      if (Array.isArray(sentences)) {
        sentences.forEach((s, i) => checkSentence(s, `${where}.sentences[${i}]`, errors));
      }
      break;
    }
    case 'scramble': {
      if (!nonEmptyString(ex.english)) errors.push(`${where}: scramble needs "english"`);
      const tiles = ex.tiles as unknown;
      const order = ex.correct_order as unknown;
      if (!Array.isArray(tiles) || tiles.length < 2 || tiles.length > MAX_TILES || !tiles.every(nonEmptyString)) {
        errors.push(`${where}: "tiles" must be 2-${MAX_TILES} non-empty strings`);
      } else if (!Array.isArray(order) || !order.every(nonEmptyString) || !sameMultiset(tiles as string[], order as string[])) {
        errors.push(`${where}: "correct_order" must use exactly the tiles in "tiles" (same multiset)`);
      } else if (Array.isArray(ex.alt_orders)) {
        (ex.alt_orders as unknown[]).forEach((alt, i) => {
          if (!Array.isArray(alt) || !alt.every(nonEmptyString) || !sameMultiset(tiles as string[], alt as string[])) {
            errors.push(`${where}: alt_orders[${i}] must use exactly the tiles in "tiles"`);
          }
        });
      }
      break;
    }
    case 'choice': {
      if (!nonEmptyString(ex.question)) errors.push(`${where}: choice needs "question"`);
      const options = ex.options as unknown;
      if (!Array.isArray(options) || options.length < 2 || options.length > 5) {
        errors.push(`${where}: "options" must be 2-5 sentences`);
      } else {
        options.forEach((o, i) => checkSentence(o, `${where}.options[${i}]`, errors));
        const correct = ex.correct;
        if (typeof correct !== 'number' || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          errors.push(`${where}: "correct" must be an option index (0-${options.length - 1})`);
        }
      }
      break;
    }
    case 'translate': {
      if (!nonEmptyString(ex.english)) errors.push(`${where}: translate needs "english"`);
      if (!nonEmptyString(ex.reference_hanzi)) errors.push(`${where}: translate needs "reference_hanzi"`);
      break;
    }
    case 'match': {
      const pairs = ex.pairs as unknown;
      if (!Array.isArray(pairs) || pairs.length < 2 || pairs.length > MAX_MATCH_PAIRS) {
        errors.push(`${where}: "pairs" must be 2-${MAX_MATCH_PAIRS} items`);
        break;
      }
      const hanzi = new Set<string>();
      const english = new Set<string>();
      pairs.forEach((p, i) => {
        if (!isRecord(p) || !nonEmptyString(p.hanzi) || !nonEmptyString(p.english)) {
          errors.push(`${where}.pairs[${i}]: needs non-empty "hanzi" and "english"`);
          return;
        }
        if (hanzi.has(p.hanzi as string) || english.has(p.english as string)) {
          errors.push(`${where}.pairs[${i}]: duplicate hanzi/english make matching ambiguous`);
        }
        hanzi.add(p.hanzi as string);
        english.add(p.english as string);
      });
      break;
    }
    case 'describe_image': {
      if (!nonEmptyString(ex.image_prompt)) errors.push(`${where}: describe_image needs "image_prompt"`);
      if (!nonEmptyString(ex.reference_hanzi)) errors.push(`${where}: describe_image needs "reference_hanzi"`);
      break;
    }
    case 'speak': {
      if (!nonEmptyString(ex.prompt)) errors.push(`${where}: speak needs "prompt"`);
      if (ex.example !== undefined) checkSentence(ex.example, `${where}.example`, errors);
      break;
    }
    case 'listen_choice': {
      checkSentence(ex.audio, `${where}.audio`, errors);
      const options = ex.options as unknown;
      if (!Array.isArray(options) || options.length < 2 || options.length > 5) {
        errors.push(`${where}: "options" must be 2-5 sentences`);
      } else {
        options.forEach((o, i) => checkSentence(o, `${where}.options[${i}]`, errors));
        const correct = ex.correct;
        if (typeof correct !== 'number' || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          errors.push(`${where}: "correct" must be an option index (0-${options.length - 1})`);
        }
      }
      break;
    }
    case 'listen_translate': {
      checkSentence(ex.audio, `${where}.audio`, errors);
      if (isRecord(ex.audio) && !nonEmptyString(ex.audio.english)) {
        errors.push(`${where}: listen_translate "audio" needs "english" (the translation to check against)`);
      }
      break;
    }
    case 'sentence_making': {
      const words = ex.words as unknown;
      if (!Array.isArray(words) || words.length < 1 || words.length > MAX_TARGET_WORDS) {
        errors.push(`${where}: sentence_making needs "words": 1-${MAX_TARGET_WORDS} target words ({hanzi, pinyin?, english?})`);
      } else {
        words.forEach((w, i) => checkWord(w, `${where}.words[${i}]`, errors));
      }
      checkInput(ex.input, where, errors);
      if (ex.task !== undefined && typeof ex.task !== 'string') errors.push(`${where}: "task" must be a string`);
      if (ex.example !== undefined) checkSentence(ex.example, `${where}.example`, errors);
      break;
    }
    case 'write_typed':
    case 'write_handwriting': {
      checkSentence(ex.answer, `${where}.answer`, errors);
      const cues = checkCues(ex.cues, where, errors);
      if (isRecord(ex.answer) && nonEmptyString(ex.answer.hanzi)) {
        const answer = ex.answer as Record<string, unknown>;
        const shown = cues.filter(c => c === 'audio' || nonEmptyString(answer[c]));
        if (shown.length === 0) {
          errors.push(`${where}: nothing to go on — give "answer.english" and/or "answer.pinyin", or add "audio" to "cues" (shown: ${cues.join(', ')})`);
        }
        if (ex.type === 'write_handwriting' && hanCount(answer.hanzi as string) > MAX_HANDWRITING_CHARS) {
          errors.push(`${where}: handwriting answers are character recall — keep "answer.hanzi" to ${MAX_HANDWRITING_CHARS} characters or fewer (use write_typed or sentence_making for longer text)`);
        }
      }
      if (ex.type === 'write_typed') checkAlternatives(ex.alternatives, where, errors);
      break;
    }
    case 'dictation': {
      checkSentence(ex.audio, `${where}.audio`, errors);
      checkInput(ex.input, where, errors);
      checkAlternatives(ex.alternatives, where, errors);
      if (ex.input === 'handwrite' && isRecord(ex.audio) && nonEmptyString(ex.audio.hanzi) && hanCount(ex.audio.hanzi) > MAX_HANDWRITTEN_DICTATION_CHARS) {
        errors.push(`${where}: handwritten dictation should be short — ${MAX_HANDWRITTEN_DICTATION_CHARS} characters or fewer`);
      }
      break;
    }
    case 'oral_expression': {
      if (!nonEmptyString(ex.prompt)) errors.push(`${where}: oral_expression needs "prompt" (what to talk about)`);
      if (ex.question_audio !== undefined) checkSentence(ex.question_audio, `${where}.question_audio`, errors);
      if (ex.example !== undefined) checkSentence(ex.example, `${where}.example`, errors);
      if (ex.hints !== undefined) {
        if (!Array.isArray(ex.hints) || ex.hints.length > MAX_HINTS) {
          errors.push(`${where}: "hints" must be a list of up to ${MAX_HINTS} words`);
        } else {
          (ex.hints as unknown[]).forEach((w, i) => checkWord(w, `${where}.hints[${i}]`, errors));
        }
      }
      if (ex.target_seconds !== undefined) {
        const s = ex.target_seconds;
        if (typeof s !== 'number' || !Number.isFinite(s) || s < 5 || s > 180) {
          errors.push(`${where}: "target_seconds" must be 5-180`);
        }
      }
      break;
    }
    case 'conversation':
      checkConversation(ex, where, errors);
      break;
    default:
      errors.push(
        `${where}: unknown exercise type "${String(ex.type)}" (valid: ${EXERCISE_TYPE_IDS.join(', ')})`
      );
  }
}

function checkWord(v: unknown, where: string, errors: string[]): void {
  if (!isRecord(v) || !nonEmptyString(v.hanzi)) {
    errors.push(`${where}: expected a word object with non-empty "hanzi"`);
  }
}

function checkInput(v: unknown, where: string, errors: string[]): void {
  if (v !== undefined && v !== 'type' && v !== 'handwrite') {
    errors.push(`${where}: "input" must be "type" or "handwrite"`);
  }
}

const CUES = ['english', 'pinyin', 'audio'] as const;

/** Returns the effective cue list (default english + pinyin). */
function checkCues(v: unknown, where: string, errors: string[]): string[] {
  if (v === undefined) return ['english', 'pinyin'];
  if (!Array.isArray(v) || v.length === 0 || !v.every(c => (CUES as readonly unknown[]).includes(c))) {
    errors.push(`${where}: "cues" must be a non-empty list of ${CUES.map(c => `"${c}"`).join(' / ')}`);
    return [];
  }
  return v as string[];
}

function checkAlternatives(v: unknown, where: string, errors: string[]): void {
  if (v !== undefined && (!Array.isArray(v) || !v.every(nonEmptyString))) {
    errors.push(`${where}: "alternatives" must be a list of non-empty strings`);
  }
}

/** Number of Han characters (punctuation and latin don't count). */
function hanCount(s: string): number {
  return (s.match(/\p{Script=Han}/gu) ?? []).length;
}

function checkConversation(ex: Record<string, unknown>, where: string, errors: string[]): void {
  if (!nonEmptyString(ex.situation)) errors.push(`${where}: conversation needs "situation" (e.g. "Checking in at a hotel")`);

  const speakers = ex.speakers as unknown;
  let speakerCount = 0;
  if (!Array.isArray(speakers) || speakers.length < 2 || speakers.length > 3) {
    errors.push(`${where}: "speakers" must be 2-3 speakers ({name, voice?: "female"|"male"})`);
  } else {
    speakerCount = speakers.length;
    speakers.forEach((s, i) => {
      if (!isRecord(s) || !nonEmptyString(s.name)) {
        errors.push(`${where}.speakers[${i}]: needs a non-empty "name"`);
      } else if (s.voice !== undefined && s.voice !== 'female' && s.voice !== 'male') {
        errors.push(`${where}.speakers[${i}]: "voice" must be "female" or "male"`);
      }
    });
  }

  const lines = ex.lines as unknown;
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > MAX_CONVERSATION_LINES) {
    errors.push(`${where}: "lines" must be 2-${MAX_CONVERSATION_LINES} lines ({speaker, hanzi, pinyin?, english?})`);
  } else {
    const spoke = new Set<number>();
    lines.forEach((line, i) => {
      if (!isRecord(line) || !nonEmptyString(line.hanzi)) {
        errors.push(`${where}.lines[${i}]: needs non-empty "hanzi"`);
        return;
      }
      const sp = line.speaker;
      if (typeof sp !== 'number' || !Number.isInteger(sp) || sp < 0 || (speakerCount > 0 && sp >= speakerCount)) {
        errors.push(`${where}.lines[${i}]: "speaker" must be a speaker index (0-${Math.max(speakerCount - 1, 0)})`);
      } else {
        spoke.add(sp);
      }
    });
    if (speakerCount > 0 && spoke.size > 0 && spoke.size < speakerCount) {
      errors.push(`${where}: every speaker needs at least one line`);
    }
  }

  const questions = ex.questions as unknown;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_CONVERSATION_QUESTIONS) {
    errors.push(`${where}: "questions" must be 1-${MAX_CONVERSATION_QUESTIONS} comprehension questions`);
    return;
  }
  questions.forEach((q, i) => {
    const qWhere = `${where}.questions[${i}]`;
    if (!isRecord(q) || !nonEmptyString(q.question)) {
      errors.push(`${qWhere}: needs non-empty "question"`);
      return;
    }
    if (q.options !== undefined) {
      const options = q.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 5 || !options.every(nonEmptyString)) {
        errors.push(`${qWhere}: "options" must be 2-5 non-empty strings`);
        return;
      }
      const correct = q.correct;
      if (typeof correct !== 'number' || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        errors.push(`${qWhere}: "correct" must be an option index (0-${options.length - 1})`);
      }
    } else if (!nonEmptyString(q.answer)) {
      errors.push(`${qWhere}: give "options" + "correct" (multiple choice) or "answer" (free answer, self-assessed)`);
    }
  });
}

/**
 * Validate an untrusted lesson spec. Returns [] when valid; otherwise a list
 * of problems. On success the value can be treated as a CustomLessonSpec.
 */
export function validateLessonSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(spec)) return ['spec must be an object'];

  if (!nonEmptyString(spec.title)) errors.push('lesson needs a non-empty "title"');
  else if ((spec.title as string).length > 200) errors.push('"title" too long (max 200 chars)');
  if (spec.icon !== undefined && (typeof spec.icon !== 'string' || spec.icon.length > 8)) {
    errors.push('"icon" must be a short emoji string (max 8 chars)');
  }

  const sections = spec.sections as unknown;
  if (!Array.isArray(sections) || sections.length === 0) {
    errors.push('lesson needs at least one section');
    return errors;
  }
  if (sections.length > MAX_SECTIONS) errors.push(`too many sections (max ${MAX_SECTIONS})`);

  let exerciseCount = 0;
  sections.forEach((section, si) => {
    if (!isRecord(section) || !Array.isArray(section.exercises) || section.exercises.length === 0) {
      errors.push(`sections[${si}]: needs a non-empty "exercises" array`);
      return;
    }
    (section.exercises as unknown[]).forEach((ex, ei) => {
      exerciseCount++;
      checkExercise(ex, `sections[${si}].exercises[${ei}]`, errors);
    });
  });
  if (exerciseCount > MAX_EXERCISES) errors.push(`too many exercises (max ${MAX_EXERCISES})`);

  return errors;
}

export function assertValidLessonSpec(spec: unknown): asserts spec is CustomLessonSpec {
  const errors = validateLessonSpec(spec);
  if (errors.length > 0) {
    throw new Error(`Invalid lesson spec:\n- ${errors.join('\n- ')}`);
  }
}

export type { CustomLessonSpec, LessonExercise, LessonSentence };
