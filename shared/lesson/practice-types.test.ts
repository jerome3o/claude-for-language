import { describe, it, expect } from 'vitest';
import { validateLessonSpec, EXERCISE_TYPE_IDS } from './validate';
import { CustomLessonSpec, LessonExercise, lessonTtsClips, exercisePoints, countScoreable } from './types';
import { EXERCISE_TYPE_INFO } from './registry';
import { SAMPLE_LESSONS } from './samples';
import { resolveConversationVoices, LESSON_VOICE_IDS, LESSON_VOICE_POOLS } from './voices';
import { diffHanzi, isHanziAnswerCorrect, normalizeHanziAnswer, sentenceUsesWord } from './answer-check';
import { sanitizeAttemptData, sectionTimes, formatDuration } from './attempt';
import { lessonToMarkdown, lessonVocabRows } from './export';
import { diffLessonSpecs, exercisePrimaryText } from './diff';
import { LESSON_SPEC_DOC } from './doc';

function lesson(...exercises: LessonExercise[]): CustomLessonSpec {
  return { title: 'Test', sections: [{ exercises }] };
}

const conversation = SAMPLE_LESSONS.find(s => s.id === 'conversation')!.spec;
const hotel = conversation.sections[1].exercises[0];

describe('the registry, samples and docs cover every type', () => {
  it('has registry info, a sample and a doc line for every validated type', () => {
    for (const type of EXERCISE_TYPE_IDS) {
      expect(EXERCISE_TYPE_INFO[type]?.type).toBe(type);
      expect(SAMPLE_LESSONS.some(s => s.type === type)).toBe(true);
      expect(LESSON_SPEC_DOC).toContain(`type:"${type}"`);
    }
    expect(Object.keys(EXERCISE_TYPE_INFO).sort()).toEqual([...EXERCISE_TYPE_IDS].sort());
  });

  it('every sample lesson is valid', () => {
    for (const sample of SAMPLE_LESSONS) {
      expect({ id: sample.id, problems: validateLessonSpec(sample.spec) }).toEqual({ id: sample.id, problems: [] });
      expect(sample.spec.sections.some(s => s.exercises.some(e => e.type === sample.type))).toBe(true);
    }
  });

  it('every type has a primary text and exports without crashing', () => {
    for (const sample of SAMPLE_LESSONS) {
      for (const ex of sample.spec.sections.flatMap(s => s.exercises)) {
        expect(exercisePrimaryText(ex).length).toBeGreaterThan(0);
      }
      expect(lessonToMarkdown(sample.spec)).toContain(sample.spec.title);
    }
  });
});

describe('validateLessonSpec — sentence making', () => {
  it('accepts target words with typed or handwritten input', () => {
    expect(validateLessonSpec(lesson({ type: 'sentence_making', words: [{ hanzi: '因为' }], input: 'handwrite' }))).toEqual([]);
  });
  it('rejects no words, too many words and a bad input mode', () => {
    expect(validateLessonSpec(lesson({ type: 'sentence_making', words: [] }))[0]).toMatch(/1-4 target words/);
    const five = Array.from({ length: 5 }, (_, i) => ({ hanzi: `词${i}` }));
    expect(validateLessonSpec(lesson({ type: 'sentence_making', words: five }))[0]).toMatch(/1-4/);
    expect(validateLessonSpec(lesson({ type: 'sentence_making', words: [{ hanzi: '好' }], input: 'voice' } as never))[0]).toMatch(/"input"/);
  });
});

describe('validateLessonSpec — writing', () => {
  it('needs a cue the learner can see', () => {
    expect(validateLessonSpec(lesson({ type: 'write_typed', answer: { hanzi: '图书馆' } }))[0]).toMatch(/nothing to go on/);
    expect(validateLessonSpec(lesson({ type: 'write_typed', answer: { hanzi: '图书馆' }, cues: ['audio'] }))).toEqual([]);
    expect(validateLessonSpec(lesson({ type: 'write_typed', answer: { hanzi: '图书馆', english: 'library' } }))).toEqual([]);
  });
  it('rejects unknown cues', () => {
    expect(validateLessonSpec(lesson({ type: 'write_typed', answer: { hanzi: '图', english: 'map' }, cues: ['smell'] } as never))[0]).toMatch(/"cues"/);
  });
  it('keeps handwriting to a word or short phrase', () => {
    expect(validateLessonSpec(lesson({ type: 'write_handwriting', answer: { hanzi: '你好', english: 'hello' } }))).toEqual([]);
    const long = { type: 'write_handwriting' as const, answer: { hanzi: '我明天早上要去北京的图书馆借书。', english: 'x' } };
    expect(validateLessonSpec(lesson(long))[0]).toMatch(/12 characters/);
  });
});

describe('validateLessonSpec — dictation and oral expression', () => {
  it('validates dictation', () => {
    expect(validateLessonSpec(lesson({ type: 'dictation', audio: { hanzi: '我喜欢喝茶。' } }))).toEqual([]);
    expect(validateLessonSpec(lesson({ type: 'dictation', audio: { hanzi: '' } }))[0]).toMatch(/audio/);
    expect(validateLessonSpec(lesson({ type: 'dictation', input: 'handwrite', audio: { hanzi: '他每天早上七点起床，然后坐地铁去公司上班。' } }))[0]).toMatch(/16 characters/);
  });
  it('validates oral expression', () => {
    expect(validateLessonSpec(lesson({ type: 'oral_expression', prompt: 'Talk about your weekend.' }))).toEqual([]);
    expect(validateLessonSpec(lesson({ type: 'oral_expression', prompt: '' }))[0]).toMatch(/prompt/);
    expect(validateLessonSpec(lesson({ type: 'oral_expression', prompt: 'x', target_seconds: 900 }))[0]).toMatch(/target_seconds/);
  });
});

describe('validateLessonSpec — conversation', () => {
  it('accepts the hotel sample', () => {
    expect(validateLessonSpec(lesson(hotel))).toEqual([]);
  });
  it('needs 2-3 speakers who each speak', () => {
    if (hotel.type !== 'conversation') throw new Error('sample changed');
    const one = { ...hotel, speakers: [hotel.speakers[0]] };
    expect(validateLessonSpec(lesson(one)).join('\n')).toMatch(/2-3 speakers/);
    const silent = { ...hotel, lines: hotel.lines.map(l => ({ ...l, speaker: 0 })) };
    expect(validateLessonSpec(lesson(silent))).toContain('sections[0].exercises[0]: every speaker needs at least one line');
  });
  it('checks line speaker indexes and question shapes', () => {
    if (hotel.type !== 'conversation') throw new Error('sample changed');
    const badLine = { ...hotel, lines: [...hotel.lines, { speaker: 5, hanzi: '好' }] };
    expect(validateLessonSpec(lesson(badLine)).join('\n')).toMatch(/speaker index/);
    const badQ = { ...hotel, questions: [{ question: 'Who?' }] };
    expect(validateLessonSpec(lesson(badQ)).join('\n')).toMatch(/options.*or "answer"/);
    const badCorrect = { ...hotel, questions: [{ question: 'Who?', options: ['A', 'B'], correct: 2 }] };
    expect(validateLessonSpec(lesson(badCorrect)).join('\n')).toMatch(/"correct"/);
  });
  it('scores one point per question', () => {
    expect(exercisePoints(hotel)).toBe(4);
    expect(countScoreable(conversation)).toBe(2);
  });
});

describe('conversation voices', () => {
  it('gives each speaker a distinct allowed voice, deterministically', () => {
    const voices = resolveConversationVoices([{ name: 'A', voice: 'female' }, { name: 'B', voice: 'female' }, { name: 'C' }]);
    expect(new Set(voices).size).toBe(3);
    for (const v of voices) expect(LESSON_VOICE_IDS.has(v)).toBe(true);
    expect(resolveConversationVoices([{ name: 'A' }, { name: 'B' }])).toEqual([LESSON_VOICE_POOLS.female[0], LESSON_VOICE_POOLS.male[0]]);
  });
  it('prefetches each line in its speaker voice', () => {
    const clips = lessonTtsClips(conversation, resolveConversationVoices);
    const lineClips = clips.filter(c => c.voice);
    if (hotel.type !== 'conversation') throw new Error('sample changed');
    expect(lineClips).toHaveLength(hotel.lines.length);
    expect(new Set(lineClips.map(c => c.voice)).size).toBe(2);
    expect(clips.some(c => !c.voice && c.text === '请问有预订吗？')).toBe(true);
  });
});

describe('answer checking', () => {
  it('ignores punctuation and spaces, accepts alternatives', () => {
    expect(normalizeHanziAnswer(' 我 喜欢 喝茶。')).toBe('我喜欢喝茶');
    expect(isHanziAnswerCorrect('我喜欢喝茶', '我喜欢喝茶。')).toBe(true);
    expect(isHanziAnswerCorrect('我爱喝茶', '我喜欢喝茶。', ['我爱喝茶。'])).toBe(true);
    expect(isHanziAnswerCorrect('', '我')).toBe(false);
  });
  it('marks which characters were right and wrong', () => {
    const d = diffHanzi('他每天早上七点气床', '他每天早上七点起床。');
    expect(d.correct).toBe(false);
    expect(d.expected.filter(m => !m.hit).map(m => m.ch)).toEqual(['起']);
    expect(d.typed.filter(m => !m.hit).map(m => m.ch)).toEqual(['气']);
    expect(d.accuracy).toBeCloseTo(8 / 9);
  });
  it('checks that a sentence uses a word', () => {
    expect(sentenceUsesWord('因为下雨，所以我没去。', '所以')).toBe(true);
    expect(sentenceUsesWord('我没去。', '所以')).toBe(false);
  });
});

describe('attempt data', () => {
  it('keeps the known shape and caps sizes', () => {
    const clean = sanitizeAttemptData({
      started_at: '2026-09-27T10:00:00Z',
      duration_ms: 90_000,
      evil: 'x',
      exercises: [
        { section: 0, index: 0, type: 'dictation', correct: false, points: 0, max_points: 1, duration_ms: 20_000, answer: { text: '我喜欢和茶', plays: 3, junk: 1 } },
        { section: 0, index: 1, type: 'oral_expression', correct: true, points: 5, max_points: 1, duration_ms: 40_000, answer: { recording: { media_key: 's0e1', duration_ms: 12_000 } } },
        { section: 1, index: 0, type: 'write_handwriting', correct: null, points: 0, max_points: 1, duration_ms: 30_000, answer: { handwriting: { strokes: { width: 300, height: 300, strokes: [[1, 2, 3, 4, 5]] } } } },
        { nope: true },
      ],
    });
    expect(clean).not.toBeNull();
    expect(clean!.exercises).toHaveLength(3);
    expect(clean!.exercises[0].answer).toEqual({ text: '我喜欢和茶', plays: 3 });
    expect(clean!.exercises[1].points).toBe(1);
    expect(clean!.exercises[2].answer!.handwriting!.strokes!.strokes[0]).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(clean)).not.toContain('evil');
  });
  it('rejects a bad recording key', () => {
    const clean = sanitizeAttemptData({ exercises: [{ section: 0, index: 0, type: 'x', answer: { recording: { media_key: '../../etc' } } }] });
    expect(clean!.exercises[0].answer!.recording).toBeUndefined();
  });
  it('sums time per section', () => {
    const clean = sanitizeAttemptData({
      exercises: [
        { section: 0, index: 0, type: 'note', correct: null, duration_ms: 5000 },
        { section: 0, index: 1, type: 'choice', correct: true, max_points: 1, points: 1, duration_ms: 7000 },
        { section: 1, index: 0, type: 'choice', correct: false, max_points: 1, duration_ms: 3000 },
      ],
    })!;
    expect(sectionTimes(clean)).toEqual([
      { section: 0, duration_ms: 12000, exercises: 2, correct: 1, scored: 1 },
      { section: 1, duration_ms: 3000, exercises: 1, correct: 0, scored: 1 },
    ]);
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(12_000)).toBe('12 s');
  });
});

describe('diff and export of the new types', () => {
  it('pairs an edited conversation as a change, not add + remove', () => {
    if (hotel.type !== 'conversation') throw new Error('sample changed');
    const edited = { ...hotel, questions: hotel.questions.slice(0, 2) };
    const diff = diffLessonSpecs(lesson(hotel), lesson(edited));
    expect(diff.exercises.map(e => e.kind)).toEqual(['changed']);
  });
  it('harvests vocabulary from the new types', () => {
    const rows = lessonVocabRows(SAMPLE_LESSONS.find(s => s.id === 'sentence_making')!.spec);
    expect(rows.map(r => r.term)).toContain('因为');
  });
});
