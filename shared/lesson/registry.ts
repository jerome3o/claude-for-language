/**
 * The exercise-type registry: one entry per lesson exercise type with what a
 * person needs to know about it — name, icon, the skill it trains, a one-line
 * summary (editor type picker), a catalogue description, and how an answer
 * is checked.
 *
 * Every place that lists the types reads from here (the editor's picker,
 * the diff labels, the Mini Lessons page, the tutor catalogue, the MCP
 * lesson app), so adding a type means: its interface in types.ts, a case in
 * validate.ts, an entry here, a sample in samples.ts, the study component,
 * the editor form — and the TypeScript exhaustiveness checks point at the
 * rest.
 */

import type { ExerciseType } from './types';

export type ExerciseSkill = 'teaching' | 'reading' | 'listening' | 'speaking' | 'writing';

export interface ExerciseTypeInfo {
  type: ExerciseType;
  icon: string;
  /** Title case, e.g. "Word order". */
  name: string;
  /** Lower case, for running text ("adds a word order exercise"). */
  label: string;
  skill: ExerciseSkill;
  /** One line for the editor's type picker. */
  summary: string;
  /** A short paragraph for the tutor catalogue. */
  description: string;
  /** How an answer is marked. */
  checking: string;
  /** Needs a microphone / the writing pad — shown in the catalogue. */
  needs?: 'microphone' | 'handwriting';
}

export const SKILL_LABELS: Record<ExerciseSkill, { name: string; icon: string }> = {
  teaching: { name: 'Teaching', icon: '📖' },
  reading: { name: 'Reading & grammar', icon: '🧩' },
  listening: { name: 'Listening', icon: '👂' },
  speaking: { name: 'Speaking', icon: '🎤' },
  writing: { name: 'Writing', icon: '✍️' },
};

export const EXERCISE_TYPE_INFO: Record<ExerciseType, ExerciseTypeInfo> = {
  note: {
    type: 'note', icon: '📖', name: 'Note', label: 'note', skill: 'teaching',
    summary: 'Teaching text with example sentences (has audio). Not scored.',
    description: 'Explains a point in a few short paragraphs, with example sentences the learner can tap to hear. Open a lesson with one, or put one before each new idea.',
    checking: 'Not scored — the learner reads and continues.',
  },
  scramble: {
    type: 'scramble', icon: '🧩', name: 'Word order', label: 'word order', skill: 'reading',
    summary: 'Arrange tiles into the correct sentence.',
    description: 'The sentence is cut into tiles (words or phrases) in a shuffled order; the learner taps them into the right order. The English is hidden until asked for, so the Chinese does the work.',
    checking: 'Automatic — the tile order must match (alternative orders can be accepted).',
  },
  choice: {
    type: 'choice', icon: '🔘', name: 'Multiple choice', label: 'multiple choice', skill: 'reading',
    summary: 'Pick the sentence or word that fits (2–5 options).',
    description: 'A situation or question with 2–5 Chinese options. Pinyin and English appear only after answering, with your explanation.',
    checking: 'Automatic.',
  },
  translate: {
    type: 'translate', icon: '✍️', name: 'Translate', label: 'translate', skill: 'writing',
    summary: 'English → Chinese, self-checked against a reference.',
    description: 'The learner translates an English sentence into Chinese (typed, or in their head), then compares with your reference answer.',
    checking: 'Self-assessed — an exact match is highlighted, other wordings can still be right.',
  },
  match: {
    type: 'match', icon: '🔗', name: 'Match pairs', label: 'match pairs', skill: 'reading',
    summary: 'Connect Chinese words with their meanings (2–8 pairs).',
    description: 'Two shuffled columns — Chinese and English — to connect. Quick vocabulary warm-up.',
    checking: 'Automatic — correct when every pair is matched without a wrong tap.',
  },
  describe_image: {
    type: 'describe_image', icon: '🖼', name: 'Describe picture', label: 'describe picture', skill: 'speaking',
    summary: 'An illustration is generated; the learner describes it aloud.',
    description: 'An illustration is generated from your scene description; the learner describes it out loud, then sees your reference description.',
    checking: 'Self-assessed against the reference.',
  },
  speak: {
    type: 'speak', icon: '🎤', name: 'Speak', label: 'speak', skill: 'speaking',
    summary: 'Say your own sentence out loud, self-assessed.',
    description: 'A quick speaking prompt ("Order two coffees, one iced."). Nothing is recorded — use Oral expression when you want to hear the answer.',
    checking: 'Self-assessed, optionally against an example answer.',
  },
  listen_choice: {
    type: 'listen_choice', icon: '👂', name: 'Listen & pick', label: 'listen & pick', skill: 'listening',
    summary: 'Audio plays with text hidden; pick what you heard (tones, minimal pairs).',
    description: 'A sentence is played with the text hidden; the learner picks what they heard. Built for tones and minimal pairs (有 yǒu vs 又 yòu).',
    checking: 'Automatic.',
  },
  listen_translate: {
    type: 'listen_translate', icon: '👂', name: 'Listen & translate', label: 'listen & translate', skill: 'listening',
    summary: 'Audio plays hidden; translate what you heard.',
    description: 'A sentence is played with the text hidden; the learner says or types what it means, then sees the transcript and translation.',
    checking: 'Self-assessed.',
  },
  sentence_making: {
    type: 'sentence_making', icon: '🛠', name: 'Sentence making', label: 'sentence making', skill: 'writing',
    summary: 'Make your own sentence with the target words — typed or handwritten.',
    description: 'The learner writes their OWN sentence using 1–4 target words, optionally in a situation you set. Choose typed or handwritten input. Online, Claude checks the sentence and suggests a correction; offline the learner compares with your example.',
    checking: 'Claude feedback when online (grammar, naturalness, were the words used); self-assessed offline.',
  },
  write_typed: {
    type: 'write_typed', icon: '⌨️', name: 'Writing — typed', label: 'typed writing', skill: 'writing',
    summary: 'Type the characters from the meaning / pinyin (choosing the right characters).',
    description: 'Shows the English and/or pinyin (or plays it) and the learner types the characters with their keyboard — practising picking the right characters for the sounds.',
    checking: 'Automatic — punctuation and spaces ignored; wrong characters are highlighted.',
  },
  write_handwriting: {
    type: 'write_handwriting', icon: '🖌', name: 'Writing — handwriting', label: 'handwriting', skill: 'writing',
    summary: 'Write the characters by hand on the writing pad (≤ 12 characters).',
    description: 'Shows the English and/or pinyin and the learner writes the characters by hand from memory, one character per square, on the stroke-order writing pad. Keep it to a word or short phrase.',
    checking: 'The writing pad checks every stroke — order, direction, shape — and hints after misses; right when written from memory. You see each stroke they drew. (Self-assessed if the stroke data isn’t on the device yet.)',
    needs: 'handwriting',
  },
  dictation: {
    type: 'dictation', icon: '📝', name: 'Dictation', label: 'dictation', skill: 'listening',
    summary: 'Hear a sentence and write down what you heard — typed or handwritten.',
    description: 'A sentence is played with the text hidden; the learner writes down exactly what they heard. Choose typed input (checked character by character) or handwriting.',
    checking: 'Typed: automatic, character by character. Handwritten: the writing pad checks every stroke (characters hidden).',
  },
  oral_expression: {
    type: 'oral_expression', icon: '🗣', name: 'Oral expression', label: 'oral expression', skill: 'speaking',
    summary: 'Answer a prompt out loud — the answer is recorded for you to hear.',
    description: 'A speaking prompt (optionally a question played in Chinese, with useful words). The learner records their answer, can play it back, then compares with your model answer. You can listen to the recording afterwards; it is transcribed when online.',
    checking: 'Self-assessed; you review the recording.',
    needs: 'microphone',
  },
  conversation: {
    type: 'conversation', icon: '💬', name: 'Conversation', label: 'conversation', skill: 'listening',
    summary: 'A dialogue in two voices; listen, then answer comprehension questions.',
    description: 'A dialogue between two people in a situation (booking a hotel, ordering food, at the doctor…) played with a different voice for each speaker and the text hidden. The learner listens (and replays) the whole conversation, then answers questions about what happened. The transcript with pinyin and English is revealed at the end.',
    checking: 'Multiple-choice questions automatic; free answers self-assessed. One point per question.',
  },
};

/** Registry entries in catalogue order. */
export const EXERCISE_TYPE_LIST: ExerciseTypeInfo[] = Object.values(EXERCISE_TYPE_INFO);

export function exerciseTypeInfo(type: string): ExerciseTypeInfo | undefined {
  return (EXERCISE_TYPE_INFO as Record<string, ExerciseTypeInfo>)[type];
}
