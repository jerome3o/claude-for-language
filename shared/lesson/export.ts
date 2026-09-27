/**
 * Export formatters for a lesson spec — pure functions so the worker can
 * serve downloads and the frontend can build the same files offline for a
 * student's own lesson.
 *
 * - Markdown: teaching notes + numbered exercises, answer key at the end
 * - JSON: the spec itself, re-importable (server-filled image keys stripped)
 * - CSV: Quizlet-style term / definition / example rows
 */

import { CustomLessonSpec, LessonExercise, LessonSentence } from './types';

// ============ Markdown ============

function sentenceLine(s: LessonSentence): string {
  const parts = [s.hanzi];
  if (s.pinyin) parts.push(`*${s.pinyin}*`);
  if (s.english) parts.push(`— ${s.english}`);
  return parts.join(' ');
}

interface Numbered {
  n: number;
  section: string | null;
  exercise: LessonExercise;
}

function numberExercises(spec: CustomLessonSpec): Numbered[] {
  const out: Numbered[] = [];
  let n = 0;
  for (const section of spec.sections) {
    for (const exercise of section.exercises) {
      if (exercise.type === 'note') {
        out.push({ n: 0, section: section.title ?? null, exercise });
      } else {
        n++;
        out.push({ n, section: section.title ?? null, exercise });
      }
    }
  }
  return out;
}

/** The learner-facing part of an exercise (no answers). */
function exerciseBody(ex: LessonExercise): string[] {
  switch (ex.type) {
    case 'note': {
      const lines: string[] = [];
      if (ex.title) lines.push(`**${ex.title}**`, '');
      if (ex.body) lines.push(ex.body, '');
      for (const s of ex.sentences ?? []) lines.push(`- ${sentenceLine(s)}`);
      return lines;
    }
    case 'scramble':
      return [
        `**Word order.** Arrange the tiles into a sentence meaning: *${ex.english}*`,
        '',
        `Tiles: ${ex.tiles.map(t => `\`${t}\``).join(' ')}`,
      ];
    case 'choice':
      return [
        `**Multiple choice.** ${ex.question}`,
        '',
        ...ex.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.hanzi}${o.pinyin ? ` (*${o.pinyin}*)` : ''}`),
      ];
    case 'translate':
      return [`**Translate into Chinese.** ${ex.english}`, ...(ex.note ? ['', `_${ex.note}_`] : [])];
    case 'match': {
      const shuffledEnglish = [...ex.pairs.map(p => p.english)].sort();
      return [
        '**Match each word with its meaning.**',
        '',
        '| Chinese | Meaning |',
        '|---|---|',
        ...ex.pairs.map((p, i) => `| ${p.hanzi} | ${shuffledEnglish[i]} |`),
      ];
    }
    case 'describe_image':
      return [
        `**Describe the picture.** ${ex.task || 'Describe what you see, in Chinese.'}`,
        '',
        `_Scene: ${ex.image_prompt}_`,
      ];
    case 'speak':
      return [`**Say it out loud.** ${ex.prompt}`];
    case 'listen_choice':
      return [
        `**Listening.** ${ex.question || 'Which one did you hear?'} (the teacher reads the sentence aloud)`,
        '',
        ...ex.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.hanzi}`),
      ];
    case 'listen_translate':
      return ['**Listening.** Translate what you hear into English. (the teacher reads the sentence aloud)'];
    case 'sentence_making':
      return [
        `**Make a sentence${ex.input === 'handwrite' ? ' (write it by hand)' : ''}.** ${ex.task || 'Write your own sentence using these words.'}`,
        '',
        `Words: ${ex.words.map(w => `${w.hanzi}${w.pinyin ? ` (*${w.pinyin}*)` : ''}${w.english ? ` ${w.english}` : ''}`).join(' · ')}`,
      ];
    case 'write_typed':
    case 'write_handwriting': {
      const cues = ex.cues ?? ['english', 'pinyin'];
      const shown: string[] = [];
      if (cues.includes('english') && ex.answer.english) shown.push(ex.answer.english);
      if (cues.includes('pinyin') && ex.answer.pinyin) shown.push(`*${ex.answer.pinyin}*`);
      if (cues.includes('audio')) shown.push('(the teacher reads it aloud)');
      return [
        `**Write it in characters${ex.type === 'write_handwriting' ? ' by hand' : ''}.** ${ex.prompt ?? ''}`.trim(),
        '',
        shown.join(' — '),
      ];
    }
    case 'dictation':
      return [`**Dictation.** Write down what you hear${ex.input === 'handwrite' ? ', by hand' : ''}. (the teacher reads the sentence aloud)`];
    case 'oral_expression':
      return [
        `**Speak.** ${ex.prompt}${ex.question_audio ? ` — ${ex.question_audio.hanzi}` : ''}`,
        ...(ex.hints?.length ? ['', `Useful words: ${ex.hints.map(w => `${w.hanzi}${w.pinyin ? ` (*${w.pinyin}*)` : ''}`).join(' · ')}`] : []),
      ];
    case 'conversation':
      return [
        `**Conversation — ${ex.situation}.** Listen to the conversation (the teacher reads it aloud), then answer:`,
        '',
        ...ex.questions.flatMap((q, i) => [
          `${i + 1}) ${q.question}`,
          ...(q.options ?? []).map((o, j) => `   ${String.fromCharCode(65 + j)}. ${o}`),
        ]),
      ];
    default:
      return [];
  }
}

/** The answer key entry for an exercise, or null when it has no answer. */
function exerciseAnswer(ex: LessonExercise): string | null {
  switch (ex.type) {
    case 'scramble': {
      const alt = ex.alt_orders?.length ? ` (also: ${ex.alt_orders.map(a => a.join('')).join(' / ')})` : '';
      return `${ex.correct_order.join('')}${alt}`;
    }
    case 'choice': {
      const o = ex.options[ex.correct];
      return `${String.fromCharCode(65 + ex.correct)}. ${o?.hanzi ?? ''}${o?.english ? ` — ${o.english}` : ''}${ex.explanation ? ` (${ex.explanation})` : ''}`;
    }
    case 'translate':
      return `${ex.reference_hanzi}${ex.reference_pinyin ? ` (${ex.reference_pinyin})` : ''}`;
    case 'match':
      return ex.pairs.map(p => `${p.hanzi} = ${p.english}`).join('; ');
    case 'describe_image':
      return `${ex.reference_hanzi}${ex.reference_pinyin ? ` (${ex.reference_pinyin})` : ''}${ex.reference_english ? ` — ${ex.reference_english}` : ''}`;
    case 'speak':
      return ex.example ? `e.g. ${sentenceLine(ex.example).replace(/\*/g, '')}` : null;
    case 'listen_choice': {
      const o = ex.options[ex.correct];
      return `Read aloud: ${ex.audio.hanzi}${ex.audio.pinyin ? ` (${ex.audio.pinyin})` : ''}. Answer: ${String.fromCharCode(65 + ex.correct)}. ${o?.hanzi ?? ''}${ex.explanation ? ` (${ex.explanation})` : ''}`;
    }
    case 'listen_translate':
      return `Read aloud: ${ex.audio.hanzi}${ex.audio.pinyin ? ` (${ex.audio.pinyin})` : ''}. Answer: ${ex.audio.english ?? ''}`;
    case 'sentence_making':
      return ex.example ? `e.g. ${sentenceLine(ex.example).replace(/\*/g, '')}` : 'Any correct sentence using the words.';
    case 'write_typed':
    case 'write_handwriting':
      return `${ex.answer.hanzi}${ex.answer.pinyin ? ` (${ex.answer.pinyin})` : ''}`;
    case 'dictation':
      return `Read aloud: ${ex.audio.hanzi}${ex.audio.pinyin ? ` (${ex.audio.pinyin})` : ''}${ex.audio.english ? ` — ${ex.audio.english}` : ''}`;
    case 'oral_expression':
      return ex.example ? `e.g. ${sentenceLine(ex.example).replace(/\*/g, '')}` : null;
    case 'conversation': {
      const script = ex.lines.map(l => `${ex.speakers[l.speaker]?.name ?? '?'}: ${l.hanzi}`).join(' / ');
      const answers = ex.questions.map((q, i) =>
        `${i + 1}) ${q.options && typeof q.correct === 'number' ? `${String.fromCharCode(65 + q.correct)}. ${q.options[q.correct] ?? ''}` : q.answer ?? ''}`,
      ).join('; ');
      return `Read aloud: ${script}. Answers: ${answers}`;
    }
    default:
      return null;
  }
}

export function lessonToMarkdown(spec: CustomLessonSpec): string {
  const lines: string[] = [];
  lines.push(`# ${spec.icon ? `${spec.icon} ` : ''}${spec.title}`);
  if (spec.description) lines.push('', spec.description);

  const numbered = numberExercises(spec);
  let currentSection: string | null | undefined;
  for (const item of numbered) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      if (item.section) lines.push('', `## ${item.section}`);
    }
    lines.push('');
    if (item.n > 0) lines.push(`### ${item.n}.`, '');
    lines.push(...exerciseBody(item.exercise));
  }

  const answers = numbered.filter(i => i.n > 0).map(i => ({ n: i.n, answer: exerciseAnswer(i.exercise) })).filter(a => a.answer);
  if (answers.length > 0) {
    lines.push('', '---', '', '## Answer key', '');
    for (const a of answers) lines.push(`${a.n}. ${a.answer}`);
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// ============ JSON ============

/** The spec with server-filled fields removed, so it imports cleanly for
 * anyone (an R2 image key from another account is meaningless). */
export function lessonToExportSpec(spec: CustomLessonSpec): CustomLessonSpec {
  return {
    ...spec,
    sections: spec.sections.map(section => ({
      ...section,
      exercises: section.exercises.map(ex => {
        if (ex.type === 'describe_image') {
          const { image_url: _drop, ...rest } = ex;
          return rest as LessonExercise;
        }
        return ex;
      }),
    })),
  };
}

export function lessonToJson(spec: CustomLessonSpec): string {
  return `${JSON.stringify(lessonToExportSpec(spec), null, 2)}\n`;
}

// ============ CSV (Quizlet-style) ============

export interface VocabRow {
  term: string;
  definition: string;
  example: string;
}

/** Vocabulary rows harvested from a lesson, deduplicated by term. */
export function lessonVocabRows(spec: CustomLessonSpec): VocabRow[] {
  const rows: VocabRow[] = [];
  const seen = new Set<string>();
  const add = (term: string | undefined, definition: string | undefined | null, example?: string | null) => {
    const t = (term ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    rows.push({ term: t, definition: (definition ?? '').trim(), example: (example ?? '').trim() });
  };
  const addSentence = (s: LessonSentence | undefined | null) => {
    if (s) add(s.hanzi, s.english, s.pinyin);
  };
  for (const section of spec.sections) {
    for (const ex of section.exercises) {
      switch (ex.type) {
        case 'match':
          for (const p of ex.pairs) add(p.hanzi, p.english, p.pinyin);
          break;
        case 'note':
          for (const s of ex.sentences ?? []) addSentence(s);
          break;
        case 'translate':
          add(ex.reference_hanzi, ex.english, ex.reference_pinyin);
          break;
        case 'choice':
          addSentence(ex.options[ex.correct]);
          break;
        case 'scramble':
          add(ex.correct_order.join(''), ex.english);
          break;
        case 'describe_image':
          add(ex.reference_hanzi, ex.reference_english, ex.reference_pinyin);
          break;
        case 'speak':
          addSentence(ex.example);
          break;
        case 'listen_choice':
          addSentence(ex.audio);
          break;
        case 'listen_translate':
          addSentence(ex.audio);
          break;
        case 'sentence_making':
          for (const w of ex.words) add(w.hanzi, w.english, w.pinyin);
          addSentence(ex.example);
          break;
        case 'write_typed':
        case 'write_handwriting':
          addSentence(ex.answer);
          break;
        case 'dictation':
          addSentence(ex.audio);
          break;
        case 'oral_expression':
          for (const w of ex.hints ?? []) add(w.hanzi, w.english, w.pinyin);
          addSentence(ex.example);
          break;
        case 'conversation':
          for (const l of ex.lines) add(l.hanzi, l.english, l.pinyin);
          break;
      }
    }
  }
  return rows;
}

export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function lessonToCsv(spec: CustomLessonSpec): string {
  const lines = ['term,definition,example'];
  for (const row of lessonVocabRows(spec)) {
    lines.push([row.term, row.definition, row.example].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// ============ Filenames ============

export function lessonExportFilename(spec: CustomLessonSpec, ext: 'md' | 'json' | 'csv'): string {
  const base = spec.title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'lesson';
  return `${base}.${ext}`;
}
