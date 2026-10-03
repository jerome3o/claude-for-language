/**
 * Package E golden vectors: the student's homework rules (shared/homework — due labels,
 * the one-off pass, the screens' items / order / row lines, one-off-only targets).
 * Writes homework.json; checked by core/…/HomeworkParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  addDays,
  daysBetween,
  dueLabel,
  isDateString,
  shortDay,
  passProgress,
  passSummary,
  toHomeworkItems,
  sortHomeworkItems,
  titleParts,
  homeworkRowDetail,
  oneOffOnlyTargets,
  itemStatus,
  KIND_ICON,
  type HomeworkAssignment,
  type HomeworkEvent,
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
const r = rng(20260927);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const TODAY = '2026-09-27';

// ---- dates ----
const dates = ['2026-09-27', '2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-05', '2025-12-31', '2024-02-29', '2026-02-29', '2026-13-01', 'abc', '', '2026-9-27', '2026-09-27T00:00:00Z', '2027-01-01', '2026-03-29', '2026-10-25'];
for (let i = 0; i < 40; i++) dates.push(addDays(TODAY, int(-400, 400)));
const due = dates.map((d) => ({ date: d, valid: isDateString(d), label: dueLabel(d, TODAY), short: shortDay(d) }));
due.push({ date: null as unknown as string, valid: false, label: dueLabel(null, TODAY), short: '' });
const arithmetic = Array.from({ length: 60 }, () => {
  const from = addDays(TODAY, int(-900, 900));
  const days = int(-500, 500);
  const to = addDays(TODAY, int(-900, 900));
  return { from, days, add: addDays(from, days), to, between: daysBetween(from, to) };
});

// ---- pass progress ----
const passes = Array.from({ length: 300 }, () => {
  const n = int(0, 12);
  const itemIds = Array.from({ length: n }, (_, i) => `n${i}`);
  if (n > 2 && r() < 0.2) itemIds.push(itemIds[0]); // duplicate id
  const events: { item_id: string; result: 'right' | 'wrong' | 'done'; created_at: string }[] = [];
  const m = int(0, 30);
  for (let i = 0; i < m; i++) {
    const item = r() < 0.1 ? 'stranger' : `n${int(0, Math.max(0, n - 1))}`;
    const minute = int(0, 59);
    events.push({ item_id: item, result: pick(['right', 'wrong', 'wrong', 'done'] as const), created_at: `2026-09-27T10:${String(minute).padStart(2, '0')}:00.000Z` });
  }
  const p = passProgress(itemIds, events);
  return { item_ids: itemIds, events, progress: p, summary_deck: passSummary(p, 'deck'), summary_lesson: passSummary(p, 'lesson') };
});

// ---- screens: items, order, rows ----
function assignment(i: number): HomeworkAssignment {
  const kind = pick(['deck', 'deck', 'lesson', 'reader', 'link'] as const);
  const partCount = kind === 'deck' ? pick([1, 1, 2, 3]) : 1;
  const partIndex = int(0, partCount - 1);
  const base = pick(['餐厅 Restaurant', '天气', 'Week 3 homework', '第三周作业：天气']);
  const title = partCount > 1 && r() < 0.8 ? `${base} · day ${partIndex + 1} of ${partCount}` : base;
  const noteIds = kind === 'deck' ? Array.from({ length: int(0, 6) }, (_, k) => `a${i}n${k}`) : null;
  const created = `2026-09-${String(int(10, 27)).padStart(2, '0')}T0${int(0, 9)}:00:00.000Z`;
  const status = pick(['active', 'active', 'active', 'done', 'cancelled'] as const);
  return {
    id: `a${i}`,
    relationship_id: 'rel',
    tutor_id: 't',
    student_id: 's',
    batch_id: null,
    kind,
    target_id: kind === 'deck' ? `deck${int(0, 3)}` : `${kind}${int(0, 3)}`,
    source_id: null,
    title,
    mode: pick(['one_off', 'one_off', 'both', 'fsrs'] as const),
    due_date: r() < 0.15 ? null : addDays(TODAY, int(-4, 8)),
    item_ids: noteIds,
    item_count: noteIds?.length ?? 1,
    part_index: partIndex,
    part_count: partCount,
    status,
    done_count: 0,
    completed_at: status === 'done' && r() < 0.7 ? `2026-09-2${int(0, 7)}T12:00:00.000Z` : null,
    created_at: created,
    updated_at: `2026-09-2${int(0, 7)}T1${int(0, 9)}:00:00.000Z`,
    tutor_name: r() < 0.7 ? pick(['王老师', 'Minghui']) : null,
  };
}
const screens = Array.from({ length: 80 }, () => {
  const assignments = Array.from({ length: int(0, 8) }, (_, i) => assignment(i));
  const events: HomeworkEvent[] = [];
  for (const a of assignments) {
    const ids = a.kind === 'deck' ? a.item_ids ?? [] : [a.target_id];
    for (const id of ids) {
      const k = int(0, 3);
      for (let j = 0; j < k; j++) events.push({ id: `e${events.length}`, assignment_id: a.id, item_id: id, result: a.kind === 'deck' ? pick(['right', 'wrong'] as const) : 'done', created_at: `2026-09-27T1${int(0, 9)}:00:00.000Z` });
    }
  }
  const items = toHomeworkItems(assignments, events, TODAY);
  const sorted = sortHomeworkItems(items);
  return {
    assignments,
    events,
    items: items.map((it) => ({
      id: it.assignment.id,
      done: it.done,
      progress: it.progress,
      due: it.due,
      title: titleParts(it.assignment),
      detail: homeworkRowDetail(it, false),
      detail_tutor: homeworkRowDetail(it, true),
      status: itemStatus(it, TODAY),
      icon: KIND_ICON[it.assignment.kind] ?? null,
    })),
    todo: sorted.todo.map((i) => i.assignment.id),
    done: sorted.done.map((i) => i.assignment.id),
    one_off_only: [...oneOffOnlyTargets(assignments)].sort(),
  };
});

writeFileSync(join(OUT, 'homework.json'), JSON.stringify({ today: TODAY, due, arithmetic, passes, screens }));

// ---- Home: the "From <tutor>" card (frontend/src/components/home/homework.ts) ----
import { pickHomework, summarizeHomeworkDeck, describeDeckProgress, stripFromTutorSuffix } from '../../../frontend/src/components/home/homework';

const tutorPicks = Array.from({ length: 150 }, () => {
  const tutors = Array.from({ length: int(0, 3) }, (_, i) => ({ relationshipId: `rel${i}`, tutorId: `t${i}`, tutorName: pick(['王老师', 'Minghui', 'Your tutor']) }));
  const ts = () => `2026-09-${String(int(10, 27)).padStart(2, '0')}T${String(int(0, 23)).padStart(2, '0')}:00:00.000Z`;
  const localDecks: [string, string][] = Array.from({ length: int(0, 4) }, (_, i) => [`d${i}`, pick(['天气 (from tutor)', 'Food', '第三周作业：天气 (From Tutor) ', ' (from tutor)'])]);
  const sharedDecks = Array.from({ length: int(0, 4) }, () => ({ relationshipId: `rel${int(0, 3)}`, targetDeckId: `d${int(0, 5)}`, sharedAt: ts() }));
  const lessons = Array.from({ length: int(0, 3) }, (_, i) => ({
    id: `l${i}`,
    title: pick(['把字句', 'Restaurant role-play']),
    assignedBy: r() < 0.5 ? `t${int(0, 3)}` : null,
    assignedRelationshipId: r() < 0.5 ? `rel${int(0, 3)}` : null,
    createdAt: ts(),
    status: pick(['active', 'done'] as const),
  }));
  const unreadMessages = Array.from({ length: int(0, 3) }, () => ({ conversationId: `c${int(0, 9)}`, relationshipId: r() < 0.9 ? `rel${int(0, 3)}` : null, text: r() < 0.8 ? '明天见！' : null, createdAt: ts() }));
  const input = { tutors, sharedDecks, lessons, unreadMessages, localDecks: new Map(localDecks) };
  return { input: { ...input, localDecks }, pick: pickHomework(input) };
});

const deckSummaries = Array.from({ length: 80 }, () => {
  const notes = Array.from({ length: int(0, 6) }, (_, i) => ({ id: `n${i}`, hanzi: pick(['刮风', '晴天', '下雨', '雪']) + i }));
  const cards = notes.flatMap((n) => Array.from({ length: int(1, 3) }, (_, k) => ({ id: `${n.id}c${k}`, note_id: n.id, queue: int(0, 3) })));
  const events = Array.from({ length: int(0, 20) }, () => ({ card_id: cards.length && r() < 0.95 ? pick(cards).id : 'x', rating: int(0, 3) }));
  const summary = summarizeHomeworkDeck(cards, notes, events);
  return { cards, notes, events, summary, text: describeDeckProgress(summary) };
});
const strip = ['天气 (from tutor)', 'Food', '第三周作业：天气 (From Tutor) ', ' (from tutor)', '(from tutor) x'].map((s) => ({ in: s, out: stripFromTutorSuffix(s) }));

writeFileSync(join(OUT, 'homework-tutor-card.json'), JSON.stringify({ picks: tutorPicks, summaries: deckSummaries, strip }));

// ---- A one-off-only deck copy (caps 0 + 0) never takes the daily new-card budget ----
import { allocateNewCards } from '../../../shared/decks/budget';

const budgetExclusion = Array.from({ length: 60 }, (_, c) => {
  const pools = Array.from({ length: int(1, 4) }, (_, i) => {
    const oneOff = i === 0 || r() < 0.3;
    return {
      deckId: `${oneOff ? 'oneoff' : 'deck'}${i}`,
      priority: int(0, 3),
      createdAt: `2026-09-${String(int(10, 27)).padStart(2, '0')} 10:00:00`,
      totalNew: int(0, 20),
      totalSecondaryNew: int(0, 10),
      capPrimary: oneOff ? 0 : pick([3, 5, 10]),
      capSecondary: oneOff ? 0 : pick([0, 6, 10]),
      studiedPrimary: int(0, 2),
      studiedSecondary: int(0, 2),
    };
  });
  const budget = { new_cards_per_day: int(0, 10), secondary_cards_per_day: int(0, 10) };
  const bonus = c % 3 === 0 ? 10 : 0;
  const alloc = allocateNewCards(pools, budget, bonus);
  return { pools, budget, bonus, alloc: Object.fromEntries(alloc) };
});
writeFileSync(join(OUT, 'homework-budget.json'), JSON.stringify({ cases: budgetExclusion }));
