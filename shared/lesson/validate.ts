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
    default:
      errors.push(
        `${where}: unknown exercise type "${String(ex.type)}" (valid: note, scramble, choice, translate, match, describe_image, speak, listen_choice, listen_translate)`
      );
  }
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
