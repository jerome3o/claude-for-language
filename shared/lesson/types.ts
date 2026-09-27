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

/** Listening comprehension: audio plays with the text HIDDEN; pick the option
 * that matches what you heard. Built for minimal pairs and tone discrimination
 * (有 yǒu vs 又 yòu): options show their hanzi only until answered, then the
 * played sentence and each option's pinyin/english are revealed. */
export interface ListenChoiceExerciseSpec {
  type: 'listen_choice';
  /** What is PLAYED (hanzi → TTS). Not shown until after answering. */
  audio: LessonSentence;
  /** Optional instruction, e.g. "Which word did you hear?" */
  question?: string;
  options: LessonSentence[];
  /** Index into options. */
  correct: number;
  explanation?: string;
}

/** Listening comprehension: audio plays with the text HIDDEN; translate what
 * you heard into English, self-assessed against the sentence's translation. */
export interface ListenTranslateExerciseSpec {
  type: 'listen_translate';
  /** What is PLAYED. Requires english (the answer); hanzi/pinyin/english are
   * revealed on check. */
  audio: LessonSentence;
  /** Optional guidance shown with the answer. */
  note?: string;
}

export type LessonExercise =
  | NoteExercise
  | ScrambleExerciseSpec
  | ChoiceExerciseSpec
  | TranslateExerciseSpec
  | MatchExerciseSpec
  | DescribeImageExerciseSpec
  | SpeakExerciseSpec
  | ListenChoiceExerciseSpec
  | ListenTranslateExerciseSpec
  | SentenceMakingExerciseSpec
  | WriteTypedExerciseSpec
  | WriteHandwritingExerciseSpec
  | DictationExerciseSpec
  | OralExpressionExerciseSpec
  | ConversationExerciseSpec;

export type ExerciseType = LessonExercise['type'];

// ============ Production: sentence making, writing, speaking ============

/** How the learner produces written Chinese. Typing (a pinyin keyboard →
 * choosing the right characters) and handwriting (recalling the characters
 * stroke by stroke) train different skills, so an exercise that asks for
 * written Chinese always says which one it wants. */
export type WritingInput = 'type' | 'handwrite';

/** A target word for sentence making / a hint for oral expression. */
export interface LessonWord {
  hanzi: string;
  pinyin?: string;
  english?: string;
}

/** Sentence making: write your OWN sentence that uses the target words.
 * Claude checks it when online (grammar, naturalness, were the words used);
 * offline the learner compares with the example and self-assesses. */
export interface SentenceMakingExerciseSpec {
  type: 'sentence_making';
  /** 1-4 words the sentence must use. */
  words: LessonWord[];
  /** Situation / instruction, e.g. "Say what you did last weekend." */
  task?: string;
  /** 'type' (default) or 'handwrite'. */
  input?: WritingInput;
  /** One possible answer, shown afterwards. */
  example?: LessonSentence;
}

/** What a writing exercise shows as the cue for the characters to write. */
export type WritingCue = 'english' | 'pinyin' | 'audio';

/** Writing (typed): produce the characters with the keyboard — choosing the
 * right characters for the sounds. Checked automatically against the answer
 * (punctuation and spaces ignored; alternatives accepted). */
export interface WriteTypedExerciseSpec {
  type: 'write_typed';
  /** What to write: hanzi is the answer; english / pinyin serve as cues. */
  answer: LessonSentence;
  /** Optional instruction, e.g. "Write the name of the dish." */
  prompt?: string;
  /** Cues shown (default english + pinyin). */
  cues?: WritingCue[];
  /** Other accepted spellings of the answer. */
  alternatives?: string[];
}

/** Writing (handwriting): write the characters by hand on the writing pad.
 * Kept short (≤ 12 characters) — handwriting is character recall, not
 * composition. Checked by the pad's stroke checker when one is available,
 * otherwise self-assessed against the model characters. Only writing FROM
 * MEMORY counts as correct: switching to Trace counts as needing help
 * (`writtenFromMemory` in shared/strokes; docs/STROKE_ORDER.md). */
export interface WriteHandwritingExerciseSpec {
  type: 'write_handwriting';
  answer: LessonSentence;
  prompt?: string;
  /** Cues shown (default english + pinyin). */
  cues?: WritingCue[];
}

/** Dictation: hear a sentence (text hidden) and write down what you heard —
 * typed (checked automatically, character by character) or handwritten. */
export interface DictationExerciseSpec {
  type: 'dictation';
  /** What is PLAYED; hanzi is the answer. */
  audio: LessonSentence;
  /** 'type' (default) or 'handwrite'. */
  input?: WritingInput;
  /** Other accepted spellings (typed). */
  alternatives?: string[];
  note?: string;
}

/** Oral expression: answer a prompt out loud. The answer is RECORDED so the
 * learner can play it back and the tutor can listen to it (transcribed when
 * online). Self-assessed against an optional model answer. */
export interface OralExpressionExerciseSpec {
  type: 'oral_expression';
  /** What to talk about, e.g. "Describe your favourite restaurant." */
  prompt: string;
  /** Optional question played in Chinese (e.g. 你周末做了什么？). */
  question_audio?: LessonSentence;
  /** Useful words shown with the prompt. */
  hints?: LessonWord[];
  /** A model answer shown after recording. */
  example?: LessonSentence;
  /** Suggested length in seconds (default 30). */
  target_seconds?: number;
}

// ============ Listening: conversation ============

/** A voice for a conversation speaker. Each speaker gets a distinct TTS
 * voice (voices.ts); the gender picks the pool it comes from. */
export type LessonVoice = 'female' | 'male';

export interface ConversationSpeaker {
  /** Shown after listening, e.g. "前台 Receptionist". */
  name: string;
  voice?: LessonVoice;
}

export interface ConversationLine {
  /** Index into speakers. */
  speaker: number;
  hanzi: string;
  pinyin?: string;
  english?: string;
}

/** A comprehension question: multiple choice when "options" is given (then
 * "correct" is required), otherwise a free answer self-assessed against
 * "answer". */
export interface ConversationQuestion {
  question: string;
  options?: string[];
  correct?: number;
  answer?: string;
  explanation?: string;
}

/** A dialogue between two (or three) speakers in a situation, played with a
 * different voice per speaker and the transcript hidden. The learner listens
 * to the whole conversation (replays allowed), then answers comprehension
 * questions; the transcript with pinyin and English is revealed at the end.
 * Each question scores one point. */
export interface ConversationExerciseSpec {
  type: 'conversation';
  /** Shown before listening, e.g. "Checking in at a hotel". */
  situation: string;
  speakers: ConversationSpeaker[];
  lines: ConversationLine[];
  questions: ConversationQuestion[];
}

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
const SCOREABLE = new Set<string>([
  'scramble', 'choice', 'translate', 'match', 'describe_image', 'speak', 'listen_choice', 'listen_translate',
  'sentence_making', 'write_typed', 'write_handwriting', 'dictation', 'oral_expression', 'conversation',
]);

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
        case 'listen_choice':
          // The played audio is the exercise; option hanzi are speakable after
          // answering, so cache those too.
          texts.push(ex.audio.hanzi);
          for (const o of ex.options) texts.push(o.hanzi);
          break;
        case 'listen_translate':
          texts.push(ex.audio.hanzi);
          break;
        case 'sentence_making':
          for (const w of ex.words) texts.push(w.hanzi);
          if (ex.example) texts.push(ex.example.hanzi);
          break;
        case 'write_typed':
        case 'write_handwriting':
          texts.push(ex.answer.hanzi);
          break;
        case 'dictation':
          texts.push(ex.audio.hanzi);
          break;
        case 'oral_expression':
          if (ex.question_audio) texts.push(ex.question_audio.hanzi);
          for (const w of ex.hints ?? []) texts.push(w.hanzi);
          if (ex.example) texts.push(ex.example.hanzi);
          break;
        case 'conversation':
          // Lines are spoken in per-speaker voices — see lessonTtsClips.
          break;
      }
    }
  }
  return texts;
}

/** One clip to speak: the text and, for a conversation line, the speaker's
 * TTS voice id and the conversation speaking rate (undefined = the app's
 * default voice / speed). */
export interface LessonTtsClip {
  text: string;
  voice?: string;
  speed?: number;
}

/** Every clip a lesson plays, for offline prefetch: the default-voice texts
 * plus each conversation line in its speaker's voice (`resolveVoices`, e.g.
 * conversationVoicesFor with the account's enabled voices) at
 * `conversationSpeed` (CONVERSATION_TTS_SPEED). */
export function lessonTtsClips(
  spec: CustomLessonSpec,
  resolveVoices: (exercise: ConversationExerciseSpec) => string[],
  conversationSpeed?: number,
): LessonTtsClip[] {
  const clips: LessonTtsClip[] = lessonTtsTexts(spec).map(text => ({ text }));
  for (const section of spec.sections) {
    for (const ex of section.exercises) {
      if (ex.type !== 'conversation') continue;
      const voices = resolveVoices(ex);
      for (const line of ex.lines) {
        const clip: LessonTtsClip = { text: line.hanzi, voice: voices[line.speaker] };
        if (conversationSpeed !== undefined) clip.speed = conversationSpeed;
        clips.push(clip);
      }
    }
  }
  return clips;
}

/** Points an exercise is worth in the lesson score: a conversation scores
 * one per question, every other scoreable exercise one. */
export function exercisePoints(exercise: LessonExercise): number {
  if (!isScoreable(exercise)) return 0;
  return exercise.type === 'conversation' ? Math.max(1, exercise.questions.length) : 1;
}
