/**
 * Custom mini lessons — the generalized, schema-driven successor to the
 * fixed-phase grammar lesson.
 *
 * A lesson is a list of sections, each holding any number of exercises of any
 * type in any order. The spec is authored by agents (MCP tools, the in-app
 * chat) and validated with validateLessonSpec before it is stored; the
 * frontend renders it fully offline inside the study session.
 */

/** A Chinese sentence with optional pinyin and translation. */
export interface LessonSentence {
  hanzi: string;
  pinyin?: string;
  english?: string;
}

/** Teaching content: a text card, optionally with example sentences (each
 * gets a TTS play button). Not scored. */
export interface NoteExercise {
  type: 'note';
  title?: string;
  /** Explanation / teaching text. Plain text with blank-line paragraphs. */
  body?: string;
  sentences?: LessonSentence[];
}

/** Arrange the tiles into the correct sentence. English starts hidden and is
 * revealed only as a deliberate hint. */
export interface ScrambleExerciseSpec {
  type: 'scramble';
  english: string;
  /** Tiles must be exactly a permutation of correct_order. */
  tiles: string[];
  correct_order: string[];
  /** Other acceptable orderings of the same tiles. */
  alt_orders?: string[][];
}

/** Multiple choice: pick the sentence/word that fits. */
export interface ChoiceExerciseSpec {
  type: 'choice';
  /** The situation or question, e.g. "Your friend looks tired. What do you say?" */
  question: string;
  options: LessonSentence[];
  /** Index into options. */
  correct: number;
  explanation?: string;
}

/** Translate the English into Chinese — self-assessed against a reference. */
export interface TranslateExerciseSpec {
  type: 'translate';
  english: string;
  reference_hanzi: string;
  reference_pinyin?: string;
  /** Optional guidance shown with the reference ("Different wording is fine"). */
  note?: string;
}

/** Connect the Chinese words with their English meanings. */
export interface MatchExerciseSpec {
  type: 'match';
  pairs: Array<{ hanzi: string; pinyin?: string; english: string }>;
}

/** Describe a generated illustration out loud — self-assessed against a
 * reference description. */
export interface DescribeImageExerciseSpec {
  type: 'describe_image';
  /** Prompt for the illustration generator (English, detailed, no text in image). */
  image_prompt: string;
  /** R2 key of the generated illustration; filled in by the server. */
  image_url?: string | null;
  /** What to do, e.g. "Describe what the woman is doing." Default: describe the scene. */
  task?: string;
  reference_hanzi: string;
  reference_pinyin?: string;
  reference_english?: string;
}

/** Say your own sentence out loud — self-assessed, optionally against an example. */
export interface SpeakExerciseSpec {
  type: 'speak';
  /** What to say, e.g. "Order two coffees, one iced." */
  prompt: string;
  example?: LessonSentence;
}

export type LessonExercise =
  | NoteExercise
  | ScrambleExerciseSpec
  | ChoiceExerciseSpec
  | TranslateExerciseSpec
  | MatchExerciseSpec
  | DescribeImageExerciseSpec
  | SpeakExerciseSpec;

export interface LessonSection {
  title?: string;
  exercises: LessonExercise[];
}

export interface CustomLessonSpec {
  title: string;
  /** Emoji shown next to the title (default 🎓). */
  icon?: string;
  description?: string;
  sections: LessonSection[];
}

/** Exercise types that contribute to the lesson score. */
const SCOREABLE = new Set(['scramble', 'choice', 'translate', 'match', 'describe_image', 'speak']);

export function isScoreable(exercise: LessonExercise): boolean {
  return SCOREABLE.has(exercise.type);
}

export function countScoreable(spec: CustomLessonSpec): number {
  return spec.sections.reduce(
    (sum, s) => sum + s.exercises.filter(isScoreable).length,
    0,
  );
}

/** All Chinese text in a lesson that should get TTS prefetched for offline use. */
export function lessonTtsTexts(spec: CustomLessonSpec): string[] {
  const texts: string[] = [];
  for (const section of spec.sections) {
    for (const ex of section.exercises) {
      switch (ex.type) {
        case 'note':
          for (const s of ex.sentences ?? []) texts.push(s.hanzi);
          break;
        case 'scramble':
          texts.push(ex.correct_order.join(''));
          break;
        case 'choice':
          for (const o of ex.options) texts.push(o.hanzi);
          break;
        case 'translate':
          texts.push(ex.reference_hanzi);
          break;
        case 'match':
          for (const p of ex.pairs) texts.push(p.hanzi);
          break;
        case 'describe_image':
          texts.push(ex.reference_hanzi);
          break;
        case 'speak':
          if (ex.example) texts.push(ex.example.hanzi);
          break;
      }
    }
  }
  return texts;
}
