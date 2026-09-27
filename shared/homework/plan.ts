/**
 * Turning "assign this, this way" into assignment rows, and the draft plan a
 * tutor (or the draft agent) edits before assigning a lesson's homework.
 */

import { addDays, isDateString } from './due';
import { clampSplitDays, splitIntoDays } from './split';
import { hasOneOff, isHomeworkMode, type HomeworkKind, type HomeworkMode } from './types';
import type { LoadAssignmentInput } from './load';

/** Days from today a draft's items are due by default. */
export const DEFAULT_DUE_IN_DAYS = 2;

// ============ Rows for one assigned item ============

export interface AssignItemInput {
  kind: HomeworkKind;
  mode: HomeworkMode;
  title: string;
  /** First due date (one_off / both). Ignored for fsrs. */
  due_date: string | null;
  split_days?: number;
}

export interface AssignmentRowPlan {
  title: string;
  due_date: string | null;
  item_ids: string[] | null;
  item_count: number;
  part_index: number;
  part_count: number;
}

/**
 * The rows for one item once its copy exists in the student's account.
 * A deck (`noteIds` = the copy's notes in order) may be split over days when it
 * has a one-off pass; everything else is one row.
 */
export function assignmentRowsFor(item: AssignItemInput, noteIds: readonly string[] | null, today: string): AssignmentRowPlan[] {
  const oneOff = hasOneOff(item.mode);
  const due = oneOff ? (item.due_date && isDateString(item.due_date) ? item.due_date : addDays(today, DEFAULT_DUE_IN_DAYS)) : null;
  if (item.kind !== 'deck') {
    return [{ title: item.title, due_date: due, item_ids: null, item_count: 1, part_index: 0, part_count: 1 }];
  }
  const ids = [...(noteIds ?? [])];
  if (!oneOff || !due) {
    return [{ title: item.title, due_date: null, item_ids: ids, item_count: ids.length, part_index: 0, part_count: 1 }];
  }
  const parts = splitIntoDays(ids, clampSplitDays(item.split_days ?? 1, ids.length), due);
  if (parts.length <= 1) {
    return [{ title: item.title, due_date: due, item_ids: ids, item_count: ids.length, part_index: 0, part_count: 1 }];
  }
  return parts.map((p) => ({
    title: `${item.title} · day ${p.index + 1} of ${parts.length}`,
    due_date: p.due_date,
    item_ids: p.items,
    item_count: p.items.length,
    part_index: p.index,
    part_count: parts.length,
  }));
}

// ============ The draft plan ============

export interface DraftContents {
  deck?: { id: string; title: string; word_count: number } | null;
  lessons: Array<{ id: string; title: string }>;
  reader?: { id: string; title: string } | null;
}

export interface DraftPlanItem {
  /** 'deck', 'lesson:<library item id>', 'reader'. */
  key: string;
  kind: HomeworkKind;
  source_id: string;
  title: string;
  include: boolean;
  mode: HomeworkMode;
  /** For the words: the first day's due date when split. */
  due_date: string | null;
}

export interface DraftPlan {
  /** Spread the words over this many days (1 = no split). */
  split_days: number;
  /** Where the long-term copy lands in the student's queue. */
  priority: 'core' | 'non_urgent';
  /** Hanzi the student already has that the tutor wants sent anyway. */
  include_known: string[];
  items: DraftPlanItem[];
}

const DEFAULT_MODE: Record<string, HomeworkMode> = { deck: 'both', lesson: 'one_off', reader: 'one_off' };

function draftItems(contents: DraftContents): Array<Omit<DraftPlanItem, 'include' | 'mode' | 'due_date'>> {
  const out: Array<Omit<DraftPlanItem, 'include' | 'mode' | 'due_date'>> = [];
  if (contents.deck) out.push({ key: 'deck', kind: 'deck', source_id: contents.deck.id, title: contents.deck.title });
  for (const l of contents.lessons) out.push({ key: `lesson:${l.id}`, kind: 'lesson', source_id: l.id, title: l.title });
  if (contents.reader) out.push({ key: 'reader', kind: 'reader', source_id: contents.reader.id, title: contents.reader.title });
  return out;
}

export function defaultDraftPlan(contents: DraftContents, today: string): DraftPlan {
  const due = addDays(today, DEFAULT_DUE_IN_DAYS);
  return {
    split_days: 1,
    priority: 'core',
    include_known: [],
    items: draftItems(contents).map((i) => ({ ...i, include: true, mode: DEFAULT_MODE[i.kind] ?? 'one_off', due_date: due })),
  };
}

/**
 * Validate a plan against what the draft actually contains: unknown items are
 * dropped, new items get defaults, bad values fall back. Safe on any input.
 */
export function normalizeDraftPlan(raw: unknown, contents: DraftContents, today: string): DraftPlan {
  const base = defaultDraftPlan(contents, today);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DraftPlan> & { items?: unknown };
  const given = new Map<string, Partial<DraftPlanItem>>();
  if (Array.isArray(r.items)) {
    for (const it of r.items) {
      if (it && typeof it === 'object' && typeof (it as DraftPlanItem).key === 'string') given.set((it as DraftPlanItem).key, it as Partial<DraftPlanItem>);
    }
  }
  const items = base.items.map((d) => {
    const g = given.get(d.key);
    if (!g) return d;
    const mode = isHomeworkMode(g.mode) ? g.mode : d.mode;
    const due = g.due_date === null ? null : isDateString(g.due_date) ? g.due_date : d.due_date;
    return {
      ...d,
      include: typeof g.include === 'boolean' ? g.include : d.include,
      mode,
      due_date: hasOneOff(mode) ? due ?? d.due_date ?? addDays(today, DEFAULT_DUE_IN_DAYS) : due,
    };
  });
  const wordCount = contents.deck?.word_count ?? 0;
  return {
    split_days: clampSplitDays(typeof r.split_days === 'number' ? r.split_days : 1, Math.max(1, wordCount)),
    priority: r.priority === 'non_urgent' ? 'non_urgent' : 'core',
    include_known: Array.isArray(r.include_known) ? r.include_known.filter((h): h is string => typeof h === 'string').slice(0, 500) : [],
    items,
  };
}

/** What the plan would add, in load-gauge terms: planned one-off rows + words entering long-term review. */
export function plannedLoad(plan: DraftPlan, keptWordCount: number, today: string): { assignments: LoadAssignmentInput[]; fsrsWords: number } {
  const assignments: LoadAssignmentInput[] = [];
  let fsrsWords = 0;
  for (const item of plan.items) {
    if (!item.include) continue;
    if (item.kind === 'deck') {
      if (keptWordCount === 0) continue;
      if (item.mode !== 'one_off') fsrsWords += keptWordCount;
      if (!hasOneOff(item.mode)) continue;
      const ids = Array.from({ length: keptWordCount }, (_, i) => String(i));
      for (const row of assignmentRowsFor({ ...item, split_days: plan.split_days }, ids, today)) {
        assignments.push({ kind: 'deck', mode: item.mode, status: 'active', due_date: row.due_date, item_count: row.item_count, done_count: 0 });
      }
    } else if (hasOneOff(item.mode)) {
      assignments.push({ kind: item.kind, mode: item.mode, status: 'active', due_date: item.due_date, item_count: 1, done_count: 0 });
    }
  }
  return { assignments, fsrsWords };
}
