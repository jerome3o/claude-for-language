import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_CATALOGUE,
  activityPreview,
  activitySummary,
  firstName,
  orderPrepared,
  parseGeneratedActivity,
  preparedActivityId,
  preparedHeadline,
  preparedRowId,
  preparedSectionTitle,
  reduceActivity,
  startActivity,
  totalRounds,
  type ActivityAction,
  type ActivitySession,
} from './index';

const start = (spec: Parameters<typeof startActivity>[0]) =>
  startActivity(spec, { sessionId: 's1', starter: 'tutor', tutor: 'tutor', present: ['tutor', 'student'], names: { tutor: 'Minghui', student: 'Jerome' }, now: 1000 });

describe('prepared activities: ids and copy', () => {
  it('starts with prepared:<id> and reads it back; other ids are not prepared', () => {
    expect(preparedActivityId('job-1')).toBe('prepared:job-1');
    expect(preparedRowId('prepared:job-1')).toBe('job-1');
    expect(preparedRowId('dictation-everyday-1')).toBeNull();
    expect(preparedRowId('review-together')).toBeNull();
    expect(preparedRowId('prepared:')).toBeNull();
    expect(preparedRowId('prepared:a b')).toBeNull();
  });

  it('headline and section title', () => {
    expect(preparedHeadline(5)).toBe('Ready for next lesson: 5 activities');
    expect(preparedHeadline(1)).toBe('Ready for next lesson: 1 activity');
    expect(preparedHeadline(0)).toBe('No activities ready for the next lesson yet');
    expect(preparedSectionTitle('Jerome Swannack')).toBe('For Jerome · from last lesson');
    expect(preparedSectionTitle(null)).toBe('For your student · from last lesson');
    expect(firstName('  明慧 ')).toBe('明慧');
  });

  it('orders ready (newest batch, then position) before used (most recently used), dismissed out', () => {
    const row = (id: string, status: 'ready' | 'used' | 'dismissed', created_at: string, position: number, used_at: string | null = null) => ({ id, status, created_at, position, used_at });
    const list = [
      row('old-1', 'ready', '2026-10-01 10:00:00', 0),
      row('new-2', 'ready', '2026-10-05 10:00:00', 1),
      row('new-1', 'ready', '2026-10-05 10:00:00', 0),
      row('u-early', 'used', '2026-10-01 10:00:00', 1, '2026-10-02 09:00:00'),
      row('u-late', 'used', '2026-10-01 10:00:00', 2, '2026-10-04 09:00:00'),
      row('gone', 'dismissed', '2026-10-06 10:00:00', 0),
    ];
    expect(orderPrepared(list).map((r) => r.id)).toEqual(['new-1', 'new-2', 'old-1', 'u-late', 'u-early']);
  });

  it('previews every kind in a few lines', () => {
    for (const spec of ACTIVITY_CATALOGUE) {
      const lines = activityPreview(spec);
      expect(lines.length, spec.id).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(12);
    }
    const roleplay = ACTIVITY_CATALOGUE.find((s) => s.id === 'roleplay-restaurant-1')!;
    expect(activityPreview(roleplay)[0]).toBe('服务员: 你好！请问几位？');
    expect(activityPreview(roleplay, 4)).toHaveLength(4);
    expect(activityPreview(roleplay, 4)[3]).toBe('… and 10 more');
    const quiz = ACTIVITY_CATALOGUE.find((s) => s.id === 'quiz-tones-1')!;
    expect(activityPreview(quiz)[0]).toBe('🔊 买 → mǎi 买 (buy)');
  });
});

describe('parseGeneratedActivity', () => {
  it('every catalogue sample, as a model would write it, parses back to a valid spec', () => {
    for (const spec of ACTIVITY_CATALOGUE) {
      const { id: _id, ...raw } = JSON.parse(JSON.stringify(spec));
      const parsed = parseGeneratedActivity({ ...raw, why: 'Last lesson: practise these' }, 'gen-1');
      expect(parsed.problems, spec.id).toEqual([]);
      expect(parsed.spec!.id).toBe('gen-1');
      expect(parsed.spec!.kind).toBe(spec.kind);
      expect(totalRounds(parsed.spec!)).toBe(totalRounds(spec));
    }
  });

  it('refuses what the engine could not play, with problems a repair round can act on', () => {
    expect(parseGeneratedActivity(null, 'x').problems).toEqual(['not an object']);
    expect(parseGeneratedActivity({ kind: 'review', title: 't', why: 'w', summary: 's' }, 'x').problems[0]).toMatch(/kind must be one of/);
    const quiz = parseGeneratedActivity(
      { kind: 'quiz', title: 'Q', summary: 's', why: 'w', questions: [{ prompt: 'a', options: ['x', 'x'], answer: 3 }] },
      'x',
    );
    expect(quiz.spec).toBeNull();
    expect(quiz.problems).toEqual(expect.arrayContaining(['a quiz needs at least 3 questions', 'question 1: options must differ', 'question 1: answer out of range']));
    const gap = parseGeneratedActivity(
      {
        kind: 'info_gap', title: 'G', summary: 's', why: 'w', prompt: 'Ask',
        columns: ['小明'], rows: [{ label: '一', cells: [{ value: '头疼', owner: 'a' }] }, { label: '二', cells: [{ value: '发烧', owner: 'a' }] }],
        choices: [{ hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' }],
      },
      'x',
    );
    expect(gap.problems).toEqual(expect.arrayContaining(['info_gap: each person must own some cells (owner a AND b)', '"发烧" is not among the choices']));
    expect(parseGeneratedActivity({ kind: 'dictation', title: 'D', summary: 's', items: [{ hanzi: '头疼' }, { hanzi: '发烧' }, { hanzi: '感冒' }] }, 'x').problems).toEqual([
      'why is required (one line: what from the last lessons this practises)',
    ]);
  });

  it('fixes small slips instead of refusing: hints without a glossary entry, missing roles, caps', () => {
    const items = ['头疼', '发烧', '感冒', '咳嗽', '医生'].map((h, i) => ({ emoji: '🤒', hanzi: h, pinyin: 'p', english: 'e', hints: ['很难受', `不在词表${i}`] }));
    const parsed = parseGeneratedActivity(
      { kind: 'describe', title: 'D', summary: 's', why: 'w', items, glossary: [{ hanzi: '很难受', pinyin: 'hěn nánshòu', english: 'feels awful' }], distractors: [{ hanzi: '头疼', pinyin: '', english: '' }, { hanzi: '牙疼', pinyin: 'yáténg', english: 'toothache' }] },
      'x',
    );
    expect(parsed.problems).toEqual([]);
    const spec = parsed.spec!;
    if (spec.kind !== 'describe') throw new Error('kind');
    expect(spec.items[0].hints).toEqual(['很难受']);
    expect(spec.distractors!.map((d) => d.hanzi)).toEqual(['牙疼']); // never an item twice
    expect(spec.role_names).toEqual({ a: 'Describer', b: 'Guesser' });
    expect(spec.tutor_role).toBe('b'); // the student describes
    const long = parseGeneratedActivity({ kind: 'dictation', title: 'D', summary: 's', why: 'w'.repeat(500), items: Array.from({ length: 30 }, (_, i) => ({ hanzi: `字${i}`, pinyin: 'zì', english: 'char' })) }, 'x');
    expect(long.why.length).toBeLessThanOrEqual(140);
    if (long.spec?.kind !== 'dictation') throw new Error('kind');
    expect(long.spec.items).toHaveLength(10);
  });

  it('a generated spec plays in the engine like a catalogue one (start → actions → summary)', () => {
    const parsed = parseGeneratedActivity(
      {
        kind: 'build', title: 'Build the corrected sentences', summary: 's', why: 'Last lesson: 把 — 3 corrections',
        items: [
          { tiles: ['我', '把', '药', '吃', '了'], pinyin: 'Wǒ bǎ yào chī le.', english: 'I took the medicine.' },
          { tiles: ['我', '头', '很', '疼'], pinyin: 'Wǒ tóu hěn téng.', english: 'My head hurts a lot.' },
        ],
      },
      'prepared:job-1',
    );
    let s: ActivitySession = start(parsed.spec!);
    const act = (a: ActivityAction, by = 'student') => {
      const next = reduceActivity(s, a, by, 2000);
      expect(next, JSON.stringify(a)).not.toBeNull();
      s = next!;
    };
    for (let i = 0; i < 5; i++) act({ type: 'place', tile: i });
    act({ type: 'reveal' }, 'tutor');
    act({ type: 'next' }, 'tutor');
    expect(s.round).toBe(1);
    const summary = activitySummary(s);
    expect(summary.activity_id).toBe('prepared:job-1');
    expect(summary.played).toBe(1);
    expect(summary.correct).toBe(1);
  });
});
