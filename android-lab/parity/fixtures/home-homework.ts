/**
 * Golden vectors: the student Home's compact homework card (shared/homework/home.ts) — which
 * rows, their order, labels, progress, and the route a tap opens. Writes home-homework.json;
 * checked by core/…/HomeHomeworkParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  addDays,
  dueLabel,
  compactDue,
  homeHomework,
  homeHomeworkRows,
  isLessonRow,
  wordsMet,
  longTermActive,
  toHomeworkItems,
  sortHomeworkItems,
  type HomeworkAssignment,
  type HomeworkEvent,
  type LongTermHomework,
  type HomeLesson,
  type RetryBar,
  retryBar,
} from '../../../shared/homework';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260929);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const TODAY = '2026-09-29';
const TUTORS = ['明慧老师', 'Mandarin Home 明慧老师', '王老师', ''] as const;

function assignment(i: number): HomeworkAssignment {
  const kind = pick(['deck', 'deck', 'lesson', 'reader', 'link'] as const);
  const partCount = kind === 'deck' ? pick([1, 1, 2]) : 1;
  const partIndex = int(0, partCount - 1);
  const noteIds = kind === 'deck' ? Array.from({ length: int(0, 12) }, (_, k) => `a${i}n${k}`) : null;
  const status = pick(['active', 'active', 'active', 'done', 'cancelled'] as const);
  return {
    id: `a${i}`,
    relationship_id: 'rel',
    tutor_id: 't',
    student_id: 's',
    batch_id: null,
    kind,
    target_id: kind === 'deck' ? `deck${int(0, 4)}` : `${kind}${int(0, 3)}`,
    source_id: null,
    title: pick(['餐厅点菜', '把 sentences', 'Week 3 · day 1 of 2', '天气']),
    mode: pick(['one_off', 'one_off', 'both', 'fsrs'] as const),
    due_date: r() < 0.15 ? null : addDays(TODAY, int(-3, 6)),
    item_ids: noteIds,
    item_count: noteIds?.length ?? 1,
    part_index: partIndex,
    part_count: partCount,
    status,
    done_count: 0,
    completed_at: null,
    created_at: `2026-09-${String(int(10, 28)).padStart(2, '0')}T0${int(0, 9)}:00:00.000Z`,
    updated_at: '2026-09-28T10:00:00.000Z',
    tutor_name: r() < 0.85 ? pick(TUTORS) : null,
  };
}

const cases = Array.from({ length: 150 }, () => {
  const assignments = Array.from({ length: int(0, 7) }, (_, i) => assignment(i));
  const events: HomeworkEvent[] = [];
  for (const a of assignments) {
    const ids = a.kind === 'deck' ? a.item_ids ?? [] : [a.target_id];
    for (const id of ids) {
      for (let j = int(0, 2); j > 0; j--) {
        events.push({ id: `e${events.length}`, assignment_id: a.id, item_id: id, result: a.kind === 'deck' ? pick(['right', 'wrong'] as const) : 'done', created_at: `2026-09-28T1${int(0, 9)}:00:00.000Z` });
      }
    }
    // "Skip this homework" (docs/HOMEWORK.md §3d): a skipped one is not a row; an Undo brings it back.
    if (r() < 0.15) {
      const sid = `e${events.length}`;
      events.push({ id: sid, assignment_id: a.id, item_id: a.target_id, result: 'skip', created_at: '2026-09-28T20:00:00.000Z' });
      if (r() < 0.3) events.push({ id: `e${events.length}`, assignment_id: a.id, item_id: a.target_id, result: 'undo', undoes: sid, created_at: '2026-09-28T20:01:00.000Z' });
    }
  }
  const longTerm: LongTermHomework[] = Array.from({ length: int(0, 4) }, () => {
    const kind = pick(['deck', 'deck', 'lesson'] as const);
    const total = r() < 0.2 ? null : int(0, 15);
    return {
      kind,
      target_id: kind === 'deck' ? `deck${int(0, 6)}` : `lesson${int(0, 4)}`,
      title: pick(['HSK 3 词汇', '了 lesson', 'Food']),
      tutor_name: r() < 0.8 ? pick(TUTORS) : null,
      sent_at: `2026-09-${String(int(10, 28)).padStart(2, '0')}T${String(int(0, 23)).padStart(2, '0')}:00:00.000Z`,
      met: total === null ? null : int(0, total),
      total,
      assignment_id: r() < 0.6 ? `lt${int(0, 9)}` : null,
    };
  });
  const limit = pick([4, 4, 2, 6]);
  const unreadFrom = r() < 0.3 ? pick(TUTORS) : null;
  // Mini lessons on the device (revisions due, new ones, done / locked ones) and sizes by target id.
  const lessons: HomeLesson[] = Array.from({ length: int(0, 5) }, (_, k) => {
    const status = pick(['new', 'new', 'revision', 'revision', 'done'] as const);
    return {
      id: r() < 0.3 ? `lesson${int(0, 4)}` : `own${k}`,
      title: pick(['把 sentences', '了 lesson', 'China trip 1']),
      created_at: `2026-09-${String(int(10, 28)).padStart(2, '0')}T0${int(0, 9)}:00:00.000Z`,
      status,
      locked: r() < 0.15,
      revision_due: status === 'revision' && r() < 0.7,
      revision: status === 'revision' ? int(0, 3) : 0,
      due_ms: status === 'revision' ? 1_790_000_000_000 + int(0, 10) * 86_400_000 : null,
      size: pick(['18 exercises · ~12 min', '5 questions · ~4 min', '']),
      tutor_name: r() < 0.5 ? pick(TUTORS) : null,
    };
  });
  const sizes: Record<string, string> = {};
  for (const a of assignments) if (r() < 0.6) sizes[a.target_id] = pick(['9 exercises · ~6 min', '6 pages', '3 questions · ~2 min']);
  // Runs in progress on the device (`savedRunBar`): a bar, a run with nothing answered (no bar), or none.
  const runBars: Record<string, RetryBar | null> = {};
  for (const id of [...lessons.map((l) => l.id), ...assignments.filter((a) => a.kind === 'lesson').map((a) => a.target_id)]) {
    if (r() < 0.4) {
      const pos = int(0, 6);
      runBars[id] = r() < 0.15 ? null : retryBar({ answered: pos + int(0, 2), fresh: int(0, 8), retries: int(0, 2), itemsDone: pos, items: pos + int(0, 8) });
    }
  }
  return caseOf(assignments, events, longTerm, limit, unreadFrom, lessons, sizes, runBars);
});

function caseOf(
  assignments: HomeworkAssignment[],
  events: HomeworkEvent[],
  longTerm: LongTermHomework[],
  limit: number,
  unreadFrom: string | null,
  lessons: HomeLesson[],
  sizes: Record<string, string>,
  runBars: Record<string, RetryBar | null> = {},
) {
  const todo = sortHomeworkItems(toHomeworkItems(assignments, events, TODAY)).todo;
  const card = homeHomework(todo, longTerm, { limit, unreadFrom, lessons, sizes, runBars });
  // Every row before the limit + which are lesson rows (/homework's "Mini lessons", what "+N more" counts).
  const all = homeHomeworkRows(todo, longTerm, { lessons, sizes, runBars });
  return {
    assignments, events, longTerm, limit, unreadFrom, lessons, sizes, runBars, card,
    allKeys: all.map((x) => x.key),
    lessonKeys: all.filter(isLessonRow).map((x) => x.key),
    active: longTerm.map(longTermActive),
  };
}

// Hand-written: Jerome's Home (Oct 2026) — open one-offs, revisions due (his own and the tutor's),
// a lesson whose assignment the tutor CANCELLED, his own / companion lessons never started, and a
// lesson the tutor sent for long-term review. Only the first, second and last kinds are rows.
{
  const base = assignment(900);
  const oneOff = (id: string, target: string, due: string, kind: HomeworkAssignment['kind'] = 'lesson'): HomeworkAssignment => ({
    ...base, id, kind, target_id: target, title: id, mode: 'one_off', due_date: due, status: 'active',
    item_ids: kind === 'deck' ? ['n1', 'n2'] : null, item_count: kind === 'deck' ? 2 : 1, part_index: 0, part_count: 1, tutor_name: '明慧老师',
  });
  const assignments: HomeworkAssignment[] = [
    oneOff('hw-deck', 'deck-a', addDays(TODAY, 1), 'deck'),
    oneOff('hw-lesson', 'l-open', addDays(TODAY, -1)),
    { ...oneOff('hw-cancelled', 'l-cancelled', addDays(TODAY, 2)), status: 'cancelled' },
    { ...oneOff('hw-cancelled-2', 'l-cancelled-2', addDays(TODAY, 3)), status: 'cancelled', mode: 'both' },
    { ...oneOff('hw-lt', 'l-longterm', TODAY), mode: 'fsrs', due_date: null },
  ];
  const l = (id: string, status: HomeLesson['status'], over: Partial<HomeLesson> = {}): HomeLesson => ({
    id, title: id, created_at: '2026-09-20T00:00:00.000Z', status, locked: false, revision_due: status === 'revision',
    revision: status === 'revision' ? 1 : 0, due_ms: status === 'revision' ? 1_790_000_000_000 : null, size: '9 exercises · ~6 min', tutor_name: null, ...over,
  });
  const lessons: HomeLesson[] = [
    l('l-open', 'new', { tutor_name: '明慧老师' }),
    l('l-cancelled', 'new', { tutor_name: '明慧老师' }),
    l('l-cancelled-2', 'new', { tutor_name: '明慧老师' }),
    l('china-5', 'new', { created_at: '2026-10-05T00:00:00.000Z' }),
    l('china-6', 'new', { created_at: '2026-10-06T00:00:00.000Z' }),
    l('companion', 'new', { created_at: '2026-10-07T00:00:00.000Z' }),
    l('rev-own', 'revision', { due_ms: 1_790_000_000_000 }),
    l('rev-tutor', 'revision', { tutor_name: '明慧老师', due_ms: 1_790_000_100_000 }),
    l('rev-later', 'revision', { revision_due: false }),
    l('l-longterm', 'new', { created_at: '2026-09-25T00:00:00.000Z' }),
  ];
  const longTerm: LongTermHomework[] = [
    { kind: 'lesson', target_id: 'l-longterm', title: 'l-longterm', tutor_name: '明慧老师', sent_at: '2026-09-25T00:00:00.000Z', met: null, total: null },
  ];
  for (const limit of [4, 2, 10]) cases.push(caseOf(assignments, [], longTerm, limit, null, lessons, {}));
  // Only tutor rows (no own revision) → "From 明慧老师".
  cases.push(caseOf(assignments, [], longTerm, 4, null, lessons.filter((x) => x.id !== 'rev-own'), {}));
  // Only his own lessons, never started: no rows at all.
  cases.push(caseOf([], [], [], 4, null, lessons.filter((x) => x.id.startsWith('china') || x.id === 'companion'), {}));
}

const due = Array.from({ length: 30 }, () => {
  const d = r() < 0.1 ? null : addDays(TODAY, int(-5, 10));
  return { date: d, text: compactDue(dueLabel(d, TODAY)) };
});

const met = Array.from({ length: 60 }, () => {
  const noteIds = Array.from({ length: int(0, 6) }, (_, i) => `n${i}`);
  const cards = Array.from({ length: int(0, 14) }, () => ({ note_id: r() < 0.9 ? `n${int(0, 7)}` : 'stranger', queue: int(0, 3) }));
  return { noteIds, cards, result: wordsMet(cards, noteIds) };
});

writeFileSync(join(OUT, 'home-homework.json'), JSON.stringify({ today: TODAY, cases, due, met }));
