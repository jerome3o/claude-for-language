/**
 * A blank exercise of each type — what "+ Add exercise" inserts in the web
 * editor and the MCP lesson app. Blank on purpose: the validator lists what
 * still needs filling in.
 */

import type { ExerciseType, LessonExercise } from './types';

export function defaultExercise(type: ExerciseType): LessonExercise {
  switch (type) {
    case 'note':
      return { type, title: '', body: '', sentences: [{ hanzi: '' }] };
    case 'scramble':
      return { type, english: '', tiles: [], correct_order: [] };
    case 'choice':
      return { type, question: '', options: [{ hanzi: '' }, { hanzi: '' }], correct: 0 };
    case 'translate':
      return { type, english: '', reference_hanzi: '' };
    case 'match':
      return { type, pairs: [{ hanzi: '', english: '' }, { hanzi: '', english: '' }] };
    case 'describe_image':
      return { type, image_prompt: '', reference_hanzi: '' };
    case 'speak':
      return { type, prompt: '' };
    case 'listen_choice':
      return { type, audio: { hanzi: '' }, options: [{ hanzi: '' }, { hanzi: '' }], correct: 0 };
    case 'listen_translate':
      return { type, audio: { hanzi: '', english: '' } };
    case 'sentence_making':
      return { type, words: [{ hanzi: '' }], task: '', input: 'type' };
    case 'write_typed':
      return { type, answer: { hanzi: '', english: '' } };
    case 'write_handwriting':
      return { type, answer: { hanzi: '', english: '' } };
    case 'dictation':
      return { type, audio: { hanzi: '' }, input: 'type' };
    case 'oral_expression':
      return { type, prompt: '' };
    case 'conversation':
      return {
        type,
        situation: '',
        speakers: [{ name: '', voice: 'female' }, { name: '', voice: 'male' }],
        lines: [{ speaker: 0, hanzi: '' }, { speaker: 1, hanzi: '' }],
        questions: [{ question: '', options: ['', ''], correct: 0 }],
      };
  }
}
