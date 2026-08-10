import { describe, it, expect } from 'vitest';
import {
  getTodaysGrammarLesson,
  completeGrammarLesson,
  GRAMMAR_KNOWN_THRESHOLD,
} from './grammar-study';
import { db, LocalGrammarLesson } from '../db/database';

function makeLesson(overrides: Partial<LocalGrammarLesson> = {}): LocalGrammarLesson {
  const id = overrides.grammar_point_id ?? `gp-${Math.random().toString(36).slice(2, 8)}`;
  return {
    grammar_point_id: id,
    level: 'A2',
    title: 'Expressing experience with 过',
    pattern: 'Subj. + Verb + 过',
    explanation: '过 marks that something has been experienced at least once.',
    cgw_url: null,
    seed_examples: [
      { hanzi: '我去过中国。', pinyin: 'wǒ qù guo zhōng guó.', english: 'I have been to China.' },
    ],
    order_index: 1,
    position: 0,
    status: 'new',
    correct_count: 0,
    exercises: {
      flood: [
        { hanzi: '我吃过北京烤鸭。', pinyin: 'wǒ chī guo běi jīng kǎo yā.', english: 'I have eaten Peking duck.' },
      ],
      scrambles: [{ english: 'I have been to China.', tiles: ['过', '我', '去', '中国'], correct_order: ['我', '去', '过', '中国'] }],
      contrasts: [],
      translates: [{ english: 'I have seen this movie.', reference_hanzi: '我看过这个电影。', reference_pinyin: 'wǒ kàn guo zhè ge diàn yǐng.' }],
    },
    _synced_at: null,
    ...overrides,
  };
}

describe('getTodaysGrammarLesson', () => {
  it('returns the first upcoming lesson with exercises', async () => {
    await db.grammarLessons.bulkPut([
      makeLesson({ grammar_point_id: 'gp-pending', position: 0, exercises: null }),
      makeLesson({ grammar_point_id: 'gp-ready', position: 1 }),
      makeLesson({ grammar_point_id: 'gp-later', position: 2 }),
    ]);

    const lesson = await getTodaysGrammarLesson();
    expect(lesson?.grammar_point_id).toBe('gp-ready');
  });

  it('skips known lessons', async () => {
    await db.grammarLessons.bulkPut([
      makeLesson({ grammar_point_id: 'gp-known', position: 0, status: 'known' }),
      makeLesson({ grammar_point_id: 'gp-learning', position: 1, status: 'learning' }),
    ]);

    const lesson = await getTodaysGrammarLesson();
    expect(lesson?.grammar_point_id).toBe('gp-learning');
  });

  it('returns null once a lesson was completed today (one per day)', async () => {
    const lesson = makeLesson({ grammar_point_id: 'gp-a' });
    await db.grammarLessons.bulkPut([lesson, makeLesson({ grammar_point_id: 'gp-b', position: 1 })]);

    await completeGrammarLesson('gp-a', 5, 8);

    expect(await getTodaysGrammarLesson()).toBeNull();
  });

  it('returns null when nothing is cached', async () => {
    expect(await getTodaysGrammarLesson()).toBeNull();
  });
});

describe('completeGrammarLesson', () => {
  it('records an unsynced event and bumps local progress', async () => {
    await db.grammarLessons.put(makeLesson({ grammar_point_id: 'gp-1' }));

    const event = await completeGrammarLesson('gp-1', 6, 9);

    expect(event._synced).toBe(0);
    expect(event.correct).toBe(6);

    const lesson = await db.grammarLessons.get('gp-1');
    expect(lesson?.correct_count).toBe(6);
    expect(lesson?.status).toBe('learning');
  });

  it('graduates to known at the threshold', async () => {
    await db.grammarLessons.put(
      makeLesson({ grammar_point_id: 'gp-2', status: 'learning', correct_count: GRAMMAR_KNOWN_THRESHOLD - 2 })
    );

    await completeGrammarLesson('gp-2', 2, 5);

    const lesson = await db.grammarLessons.get('gp-2');
    expect(lesson?.status).toBe('known');
  });
});
