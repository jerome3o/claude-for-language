/**
 * Homework assignments (docs/HOMEWORK.md): copy each item into the student's
 * account through the usual share / assign paths, then write one assignment
 * row per item (a deck split over days = one row per day). Completion comes
 * from the student's pass events; progress is recomputed from them with the
 * same pure function the app uses (`passProgress`).
 */

import type { Env } from '../types';
import {
  assignmentRowsFor,
  computeHomeworkLoad,
  dedupeWords,
  hasFsrs,
  isDateString,
  isHomeworkMode,
  passItemIds,
  passProgress,
  type HomeworkAssignment,
  type HomeworkEvent,
  type HomeworkLoad,
  type HomeworkMode,
} from '@shared/homework';
import { DEFAULT_STUDY_BUDGET } from '@shared/decks';
import type { CustomLessonSpec } from '@shared/lesson';
import * as hw from '../db/homework-queries';
import * as lib from '../db/lesson-library-queries';
import * as content from './content';
import { shareDeck } from './conversations';
import { shareReader } from './shared-readers';
import { queueLessonImages } from './custom-lesson';
import { getLink } from '../db/homework-links-queries';
import { cleanLinkNote } from '@shared/homework';

export class HomeworkError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

export interface AssignRequestItem {
  kind: string;
  /** The tutor's deck / lesson_library item / reader. */
  source_id: string;
  mode: HomeworkMode;
  /** First due date for one_off / both ('YYYY-MM-DD'); default: in two days. */
  due_date?: string | null;
  /** Deck only: spread the one-off pass over this many days. */
  split_days?: number;
  /** Deck only: where the copy lands in the student's queue (fsrs / both). */
  priority?: 'core' | 'non_urgent';
  /** Deck only: leave out words the student already has (normalised hanzi). Default true. */
  skip_known?: boolean;
  /** Deck only: hanzi to send even though the student has them. */
  include_known?: string[];
  /** Optional display title (defaults to the source's name). */
  title?: string;
}

export interface AssignInput {
  relationshipId: string;
  tutorId: string;
  studentId: string;
  items: AssignRequestItem[];
  /** Groups the items (a draft's job id); a new id when omitted. */
  batchId?: string | null;
  /** The tutor's today ('YYYY-MM-DD') for default due dates. */
  today: string;
}

export interface AssignResult {
  assignments: HomeworkAssignment[];
  /** Per item: words left out because the student has them. */
  skipped: Array<{ source_id: string; hanzi: string[] }>;
  errors: Array<{ source_id: string; error: string }>;
  /** Per item that went out: the student's copy (and the share record for decks / readers). */
  copies: Array<{ kind: string; source_id: string; target_id: string; target_name: string; share_id: string | null }>;
}

/** Validate the request body's items; throws HomeworkError(400). */
export function parseAssignItems(raw: unknown): AssignRequestItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HomeworkError(400, 'items is required');
  if (raw.length > 20) throw new HomeworkError(400, 'At most 20 items at once');
  return raw.map((r, i) => {
    const it = (r ?? {}) as Record<string, unknown>;
    const kind = typeof it.kind === 'string' ? it.kind : '';
    if (!['deck', 'lesson', 'reader', 'link'].includes(kind)) throw new HomeworkError(400, `items[${i}].kind must be deck, lesson, reader or link`);
    if (typeof it.source_id !== 'string' || !it.source_id) throw new HomeworkError(400, `items[${i}].source_id is required`);
    // A link is a single one-off item; its due date is optional (null = none).
    const mode = kind === 'link' ? 'one_off' : isHomeworkMode(it.mode) ? it.mode : null;
    if (!mode) throw new HomeworkError(400, `items[${i}].mode must be one_off, fsrs or both`);
    if (it.due_date != null && !isDateString(it.due_date)) throw new HomeworkError(400, `items[${i}].due_date must be YYYY-MM-DD`);
    return {
      kind,
      source_id: it.source_id,
      mode,
      due_date: (it.due_date as string | null | undefined) ?? null,
      split_days: typeof it.split_days === 'number' ? it.split_days : 1,
      priority: it.priority === 'non_urgent' ? 'non_urgent' : 'core',
      skip_known: it.skip_known !== false,
      include_known: Array.isArray(it.include_known) ? it.include_known.filter((h): h is string => typeof h === 'string') : [],
      title: typeof it.title === 'string' && it.title.trim() ? it.title.trim().slice(0, 160) : undefined,
    };
  });
}

/**
 * Copy every item to the student and write the assignment rows. Items fail
 * independently (the error is reported, the rest still go out).
 */
export async function assignHomework(env: Env, input: AssignInput): Promise<AssignResult> {
  const db = env.DB;
  const batchId = input.batchId ?? crypto.randomUUID();
  const rows: hw.NewAssignment[] = [];
  const skipped: AssignResult['skipped'] = [];
  const errors: AssignResult['errors'] = [];
  const copies: AssignResult['copies'] = [];
  let studentHanzi: string[] | null = null;

  for (const item of input.items) {
    try {
      const base = {
        relationship_id: input.relationshipId,
        tutor_id: input.tutorId,
        student_id: input.studentId,
        batch_id: batchId,
        kind: item.kind,
        source_id: item.source_id,
        mode: item.mode,
      };
      if (item.kind === 'deck') {
        const sourceNotes = await hw.listDeckNotes(db, item.source_id);
        const deck = await db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?').bind(item.source_id, input.tutorId).first<{ id: string; name: string }>();
        if (!deck) throw new HomeworkError(404, 'Deck not found in your account');
        let exclude = new Set<string>();
        if (item.skip_known !== false) {
          studentHanzi ??= await hw.listStudentHanzi(db, input.studentId);
          const { skipped: known } = dedupeWords(sourceNotes, studentHanzi, item.include_known ?? []);
          exclude = new Set(known.map((s) => s.word.id));
          if (known.length > 0) skipped.push({ source_id: item.source_id, hanzi: known.map((s) => s.word.hanzi) });
        }
        if (sourceNotes.length - exclude.size === 0) throw new HomeworkError(400, 'Every word in this deck is one the student already has');
        const share = await shareDeck(db, input.relationshipId, input.tutorId, item.source_id, item.priority ?? 'core', { excludeNoteIds: exclude });
        if (!hasFsrs(item.mode)) {
          // One-off only: the copy never enters the daily new-card budget.
          await content.updateDeckSettings(db, input.studentId, share.target_deck_id, { new_cards_per_day: 0, secondary_cards_per_day: 0 });
        }
        for (const r of assignmentRowsFor({ kind: 'deck', mode: item.mode, title: item.title ?? deck.name, due_date: item.due_date ?? null, split_days: item.split_days }, share.note_ids, input.today)) {
          rows.push({ ...base, target_id: share.target_deck_id, ...r });
        }
        copies.push({ kind: 'deck', source_id: item.source_id, target_id: share.target_deck_id, target_name: share.target_deck_name, share_id: share.id });
      } else if (item.kind === 'lesson') {
        const libItem = await lib.getLibraryItem(db, item.source_id, input.tutorId);
        if (!libItem) throw new HomeworkError(404, 'Lesson not found in your library');
        const spec = JSON.parse(libItem.spec) as CustomLessonSpec;
        const existing = await lib.findAssignedCopy(db, libItem.id, input.studentId);
        let targetId = existing?.id;
        if (!targetId) {
          const copy = await lib.createAssignedLesson(db, input.studentId, {
            title: spec.title,
            description: spec.description ?? null,
            icon: spec.icon ?? null,
            spec: libItem.spec,
            library_item_id: libItem.id,
            assigned_by: input.tutorId,
            assigned_relationship_id: input.relationshipId,
          });
          await queueLessonImages(env, copy.id, spec);
          targetId = copy.id;
        }
        for (const r of assignmentRowsFor({ kind: 'lesson', mode: item.mode, title: item.title ?? spec.title, due_date: item.due_date ?? null }, null, input.today)) {
          rows.push({ ...base, target_id: targetId, ...r });
        }
        copies.push({ kind: 'lesson', source_id: item.source_id, target_id: targetId, target_name: spec.title, share_id: null });
      } else if (item.kind === 'link') {
        const link = await getLink(db, item.source_id, input.tutorId);
        if (!link) throw new HomeworkError(404, 'Link not found in your account');
        rows.push({
          ...base,
          mode: 'one_off',
          target_id: link.id,
          title: item.title ?? link.title,
          due_date: item.due_date ?? null,
          item_ids: null,
          item_count: 1,
          part_index: 0,
          part_count: 1,
          details: { url: link.url, instructions: link.instructions, thumbnail_url: link.thumbnail_url },
        });
        copies.push({ kind: 'link', source_id: link.id, target_id: link.id, target_name: link.title, share_id: null });
      } else if (item.kind === 'reader') {
        const { share, reader } = await shareReader(db, input.relationshipId, input.tutorId, item.source_id);
        const title = item.title ?? reader.title_english ?? reader.title_chinese ?? 'Reader';
        for (const r of assignmentRowsFor({ kind: 'reader', mode: item.mode, title, due_date: item.due_date ?? null }, null, input.today)) {
          rows.push({ ...base, target_id: reader.id, ...r });
        }
        copies.push({ kind: 'reader', source_id: item.source_id, target_id: reader.id, target_name: title, share_id: share.id });
      }
    } catch (error) {
      errors.push({ source_id: item.source_id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const assignments = await hw.insertAssignments(db, rows);
  return { assignments, skipped, errors, copies };
}

/** Upload of the student's pass events: store (idempotent), then recompute each touched assignment. */
export async function recordEvents(db: D1Database, studentId: string, raw: unknown): Promise<{ accepted: number; assignments: HomeworkAssignment[] }> {
  if (!Array.isArray(raw)) throw new HomeworkError(400, 'events must be an array');
  if (raw.length > 1000) throw new HomeworkError(400, 'At most 1000 events at once');
  const events: HomeworkEvent[] = [];
  for (const r of raw) {
    const e = (r ?? {}) as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.assignment_id !== 'string' || typeof e.item_id !== 'string') continue;
    if (e.result !== 'right' && e.result !== 'wrong' && e.result !== 'done') continue;
    const createdAt = typeof e.created_at === 'string' && !isNaN(Date.parse(e.created_at)) ? new Date(e.created_at).toISOString() : new Date().toISOString();
    events.push({ id: e.id.slice(0, 64), assignment_id: e.assignment_id, item_id: e.item_id, result: e.result, created_at: createdAt, note: e.result === 'done' ? cleanLinkNote(e.note) : null });
  }
  const ids = Array.from(new Set(events.map((e) => e.assignment_id)));
  const owned = (await hw.getAssignmentsByIds(db, ids)).filter((a) => a.student_id === studentId);
  const ownedIds = new Set(owned.map((a) => a.id));
  const accepted = await hw.insertEvents(db, studentId, events.filter((e) => ownedIds.has(e.assignment_id)));
  const updated = await recomputeProgress(db, owned);
  return { accepted, assignments: updated };
}

/** done_count / status from the stored events. A cancelled assignment stays cancelled. */
export async function recomputeProgress(db: D1Database, assignments: HomeworkAssignment[]): Promise<HomeworkAssignment[]> {
  if (assignments.length === 0) return [];
  const events = await hw.listEvents(db, assignments.map((a) => a.id));
  const byAssignment = new Map<string, HomeworkEvent[]>();
  for (const e of events) {
    const list = byAssignment.get(e.assignment_id) ?? [];
    list.push(e);
    byAssignment.set(e.assignment_id, list);
  }
  const out: HomeworkAssignment[] = [];
  for (const a of assignments) {
    const list = byAssignment.get(a.id) ?? [];
    const progress = passProgress(passItemIds(a), list);
    const status = a.status === 'cancelled' ? 'cancelled' : progress.complete ? 'done' : 'active';
    const completedAt = status === 'done' ? a.completed_at ?? list[list.length - 1]?.created_at ?? new Date().toISOString() : null;
    if (progress.done !== a.done_count || status !== a.status || completedAt !== a.completed_at) {
      await hw.setProgress(db, a.id, progress.done, status, completedAt);
    }
    out.push({ ...a, done_count: progress.done, status, completed_at: completedAt });
  }
  return out;
}

/** What the load gauge is computed from (so a draft can project "after this"). */
export async function studentLoadInputs(db: D1Database, studentId: string): Promise<{ active: HomeworkAssignment[]; fsrsWordsToGo: number; newPerDay: number }> {
  const [active, toGo, budget] = await Promise.all([
    hw.listActiveForStudent(db, studentId),
    hw.countFsrsWordsToGo(db, studentId),
    hw.getStudentBudget(db, studentId),
  ]);
  return { active, fsrsWordsToGo: toGo, newPerDay: budget ?? DEFAULT_STUDY_BUDGET.new_cards_per_day };
}

/** The load gauge for one student. */
export async function studentLoad(db: D1Database, studentId: string, today: string): Promise<HomeworkLoad> {
  const i = await studentLoadInputs(db, studentId);
  return computeHomeworkLoad({ assignments: i.active, today, fsrsWordsToGo: i.fsrsWordsToGo, newPerDay: i.newPerDay });
}
