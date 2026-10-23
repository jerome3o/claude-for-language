import { describe, expect, it } from 'vitest';
import {
  distinctLessonClips,
  exerciseAudioClips,
  lessonAudioClips,
  lessonClipId,
  lessonsToPrefetch,
  orderClipsForPrefetch,
  type LessonAudioClip,
} from './audioClips';
import { SAMPLE_LESSONS } from './samples';
import { EXERCISE_TYPE_IDS } from './validate';
import type { CustomLessonSpec, LessonExercise } from './types';

const resolve = () => ({ voices: ['v-a', 'v-b', 'v-c'], speed: 0.85, delivery: 'natural' as const });

function only(ex: LessonExercise): LessonAudioClip[] {
  return exerciseAudioClips(ex, 0, resolve);
}

describe('exerciseAudioClips — every exercise type', () => {
  const s = (hanzi: string) => ({ hanzi, pinyin: 'p', english: 'e' });

  it('covers each type with what its view speaks', () => {
    const cases: Array<[LessonExercise, string[]]> = [
      [{ type: 'note', body: 'b', sentences: [s('我是学生。'), s('他是老师。')] }, ['我是学生。', '他是老师。']],
      [{ type: 'scramble', english: 'e', tiles: ['即使', '他', '很忙，', '也', '每天', '复习中文。'], correct_order: ['即使', '他', '很忙，', '也', '每天', '复习中文。'] }, ['即使他很忙，也每天复习中文。']],
      [{ type: 'choice', question: 'q', options: [s('有'), s('又')], correct: 0 }, ['有', '又']],
      [{ type: 'translate', english: 'e', reference_hanzi: '你好。' }, ['你好。']],
      [{ type: 'match', pairs: [{ hanzi: '猫', english: 'cat' }, { hanzi: '狗', english: 'dog' }] }, ['猫', '狗']],
      [{ type: 'describe_image', image_prompt: 'p', reference_hanzi: '一只猫。' }, ['一只猫。']],
      [{ type: 'speak', prompt: 'p', example: s('我喜欢茶。') }, ['我喜欢茶。']],
      [{ type: 'listen_choice', audio: s('有'), question: 'q', options: [s('有'), s('又')], correct: 0 }, ['有', '有', '又']],
      [{ type: 'listen_translate', audio: s('我饿了。') }, ['我饿了。']],
      [{ type: 'sentence_making', words: [s('虽然'), s('但是')], example: s('虽然累，但是开心。') }, ['虽然', '但是', '虽然累，但是开心。']],
      [{ type: 'write_typed', answer: s('谢谢') }, ['谢谢']],
      [{ type: 'write_handwriting', answer: s('人') }, ['人']],
      [{ type: 'dictation', audio: s('今天很冷。') }, ['今天很冷。']],
      [{ type: 'oral_expression', prompt: 'p', question_audio: s('你周末做什么？'), hints: [s('周末')], example: s('我周末看书。') }, ['你周末做什么？', '周末', '我周末看书。']],
      // judge: a right sentence as written, a wrong one only as its correction (never the mistake).
      [{ type: 'judge', sentences: [{ hanzi: '我吃了饭。', correct: true }, { hanzi: '我了吃饭。', correct: false, correction: s('我吃饭了。'), explanation: 'x' }, { hanzi: '他来了。', correct: true }] }, ['我吃了饭。', '我吃饭了。', '他来了。']],
      // gap_choice: the full sentence with the answer in the gap — the "___" is never spoken.
      [{ type: 'gap_choice', options: ['刚', '刚才'], items: [{ sentence: '他___走。', answer: '刚' }, { sentence: '___你说什么？', answer: '刚才' }] }, ['他刚走。', '刚才你说什么？']],
    ] as unknown as Array<[LessonExercise, string[]]>;
    for (const [ex, texts] of cases) {
      const clips = only(ex);
      expect(clips.map((c) => c.text), ex.type).toEqual(texts);
      expect(clips.every((c) => c.kind === 'tts' && c.voice === undefined && c.speed === undefined)).toBe(true);
    }
    // Every validated type is covered above or by the conversation test below.
    expect(new Set([...cases.map(([ex]) => ex.type), 'conversation'])).toEqual(new Set(EXERCISE_TYPE_IDS));
  });

  it('a conversation speaks each line in its speaker voice, speed and delivery', () => {
    const ex = {
      type: 'conversation',
      situation: 's',
      speakers: [{ name: 'A' }, { name: 'B' }],
      lines: [{ speaker: 0, hanzi: '你好！' }, { speaker: 1, hanzi: '你好，请坐。' }, { speaker: 0, hanzi: '  ' }],
      questions: [],
    } as unknown as LessonExercise;
    expect(only(ex)).toEqual([
      { kind: 'conversation', text: '你好！', voice: 'v-a', speed: 0.85, delivery: 'natural', exercise: 0 },
      { kind: 'conversation', text: '你好，请坐。', voice: 'v-b', speed: 0.85, delivery: 'natural', exercise: 0 },
    ]);
    // No resolver (no account context): the lines are left out.
    expect(exerciseAudioClips(ex, 0)).toEqual([]);
  });

  it('skips blank texts', () => {
    expect(only({ type: 'translate', english: 'e', reference_hanzi: ' ' } as LessonExercise)).toEqual([]);
  });
});

describe('lessonAudioClips / orderClipsForPrefetch', () => {
  const spec: CustomLessonSpec = {
    title: 't',
    sections: [
      { exercises: [{ type: 'translate', english: 'a', reference_hanzi: '一' }, { type: 'translate', english: 'b', reference_hanzi: '二' }] },
      { title: 's2', exercises: [{ type: 'translate', english: 'c', reference_hanzi: '三' }, { type: 'translate', english: 'd', reference_hanzi: '一' }] },
    ],
  } as unknown as CustomLessonSpec;

  it('numbers exercises across sections', () => {
    expect(lessonAudioClips(spec).map((c) => [c.exercise, c.text])).toEqual([[0, '一'], [1, '二'], [2, '三'], [3, '一']]);
  });

  it('current exercise first, then the rest in order, then the earlier ones — each clip once', () => {
    const clips = lessonAudioClips(spec);
    expect(orderClipsForPrefetch(clips, 0).map((c) => c.text)).toEqual(['一', '二', '三']);
    expect(orderClipsForPrefetch(clips, 2).map((c) => [c.exercise, c.text])).toEqual([[2, '三'], [3, '一'], [1, '二']]);
    expect(orderClipsForPrefetch(clips, 9).map((c) => c.text)).toEqual(['一', '二', '三']);
    expect(distinctLessonClips(spec).length).toBe(3);
  });

  it('clip ids tell voice / speed / delivery apart', () => {
    const a = lessonClipId({ kind: 'tts', text: '好' });
    expect(a).toBe('tts||||好');
    expect(lessonClipId({ kind: 'conversation', text: '好', voice: 'v', speed: 0.85, delivery: 'calm' })).toBe('conversation|v|0.85|calm|好');
    expect(lessonClipId({ kind: 'conversation', text: '好', voice: 'v', speed: 0.9, delivery: 'calm' })).not.toBe(lessonClipId({ kind: 'conversation', text: '好', voice: 'v', speed: 0.85, delivery: 'calm' }));
  });

  it('every sample lesson yields its clips', () => {
    for (const sample of SAMPLE_LESSONS) {
      const clips = lessonAudioClips(sample.spec, resolve);
      expect(clips.length, sample.id).toBeGreaterThan(0);
    }
  });
});

describe('lessonsToPrefetch', () => {
  const row = (id: string, o: Partial<{ created_at: string; finishes: number; retired: boolean; lock: 'none' | 'locked' | 'unlocked' }> = {}) => ({
    id, created_at: o.created_at ?? '2026-10-01T00:00:00Z', finishes: o.finishes ?? 0, retired: o.retired ?? false, lock: o.lock ?? 'none',
  });

  it("today's, open homework, lockables, then the next new lessons — once each", () => {
    const lessons = [
      row('today'), row('hw', { finishes: 1 }), row('hw-done', { finishes: 1 }), row('locked', { lock: 'locked' }),
      row('retired-locked', { lock: 'locked', retired: true }), row('new3', { created_at: '2026-10-03T00:00:00Z' }),
      row('new1', { created_at: '2026-10-01T00:00:00Z' }), row('new2', { created_at: '2026-10-02T00:00:00Z' }),
      row('new4', { created_at: '2026-10-04T00:00:00Z' }), row('old', { finishes: 2 }),
    ];
    const homework = [
      { kind: 'lesson', target_id: 'hw', status: 'active' },
      { kind: 'lesson', target_id: 'hw-done', status: 'done' },
      { kind: 'reader', target_id: 'new4', status: 'active' },
      { kind: 'lesson', target_id: 'missing', status: 'active' },
      { kind: 'lesson', target_id: 'today', status: 'active' },
    ];
    expect(lessonsToPrefetch({ todays: ['today', 'gone'], homework, lessons })).toEqual(['today', 'hw', 'locked', 'new1', 'new2', 'new3']);
    expect(lessonsToPrefetch({ todays: [], homework: [], lessons, upcomingNew: 0 })).toEqual(['locked']);
  });
});
