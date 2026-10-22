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
  wordsMet,
  longTermActive,
  toHomeworkItems,
  sortHomeworkItems,
  type HomeworkAssignment,
  type HomeworkEvent,
  type LongTermHomework,
  type HomeLesson,
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
  const todo = sortHomeworkItems(toHomeworkItems(assignments, events, TODAY)).todo;
  const card = homeHomework(todo, longTerm, { limit, unreadFrom, lessons, sizes });
  return { assignments, events, longTerm, limit, unreadFrom, lessons, sizes, card, active: longTerm.map(longTermActive) };
});

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
