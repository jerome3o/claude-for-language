/**
 * Lessons (shared/calls/lessons.ts has the rule): the calls between the same
 * two people that follow each other within LESSON_GAP_MS are one lesson. This
 * file keeps `call_lessons` (migration 0089) and gathers a lesson's material.
 *
 * Processing is per lesson and INCREMENTAL: each call's pieces are transcribed
 * as before; whenever a call of the lesson has ended and all its pieces are
 * done, and no other call of the lesson is live or still transcribing, the
 * lesson report is (re)written over ALL its calls — at once, not 20 minutes
 * later, so the tutor can make homework right after the lesson. A call that
 * joins the lesson afterwards makes the report stale (`report_call_ids`), and
 * it is rewritten when that call is transcribed. (The alternative — wait until
 * the 20-minute window has passed — would make every report 20 minutes late
 * for a case that is rare.)
 */

import type { Env, CallProcessingMessage } from '../../types';
import { generateId } from '../cards';
import { continuesLesson, mergeTranscript, type BoardItem, type CallChatMessage, type CallDiagEntry } from '@shared/calls';
import type { CallRow, ProcessingStatus } from './store';
import { loadScopePages } from './pages';

export type LessonStatus = 'none' | 'waiting' | 'summarizing' | 'done' | 'failed';

export interface LessonRow {
  id: string;
  relationship_id: string | null;
  created_by: string;
  started_at: number;
  last_ended_at: number | null;
  processing_status: LessonStatus;
  processing_error: string | null;
  summary_json: string | null;
  report_call_ids: string | null;
  created_at: string;
}

const scopeWhere = `((relationship_id IS NOT NULL AND relationship_id = ?1) OR (relationship_id IS NULL AND ?1 IS NULL AND created_by = ?2))`;

export async function getLesson(db: D1Database, lessonId: string): Promise<LessonRow | null> {
  return db.prepare('SELECT * FROM call_lessons WHERE id = ?').bind(lessonId).first<LessonRow>();
}

export async function lessonCalls(db: D1Database, lessonId: string): Promise<CallRow[]> {
  const rows = await db.prepare('SELECT * FROM calls WHERE lesson_id = ? ORDER BY created_at, id').bind(lessonId).all<CallRow>();
  return rows.results ?? [];
}

/**
 * The lesson a new call between these people joins: the latest one whose last
 * call ended no more than LESSON_GAP_MS ago (or has a call still live) — else
 * a new lesson. Returns its id.
 */
export async function lessonForNewCall(db: D1Database, relationshipId: string | null, userId: string, now = Date.now()): Promise<string> {
  const latest = await db
    .prepare(`SELECT * FROM call_lessons WHERE ${scopeWhere} ORDER BY started_at DESC, created_at DESC LIMIT 1`)
    .bind(relationshipId, userId)
    .first<LessonRow>();
  if (latest) {
    const live = await db.prepare(`SELECT 1 AS x FROM calls WHERE lesson_id = ? AND status = 'live' LIMIT 1`).bind(latest.id).first();
    if (live || (latest.last_ended_at !== null && continuesLesson(latest.last_ended_at, now))) {
      // Open again: no end while a call is live.
      await db.prepare('UPDATE call_lessons SET last_ended_at = NULL WHERE id = ?').bind(latest.id).run();
      return latest.id;
    }
  }
  const id = generateId();
  await db
    .prepare('INSERT INTO call_lessons (id, relationship_id, created_by, started_at, last_ended_at) VALUES (?, ?, ?, ?, NULL)')
    .bind(id, relationshipId, userId, now)
    .run();
  return id;
}

/** A call of the lesson ended (or was deleted): the lesson's end follows its calls. */
export async function refreshLessonEnd(db: D1Database, lessonId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE call_lessons SET last_ended_at = (
         SELECT CASE WHEN SUM(CASE WHEN c.status = 'live' THEN 1 ELSE 0 END) > 0 THEN NULL ELSE MAX(c.ended_at) END
           FROM calls c WHERE c.lesson_id = call_lessons.id)
        WHERE id = ?`,
    )
    .bind(lessonId)
    .run();
}

/** After a call is deleted: a lesson left with no calls goes too; otherwise its end / report follow. */
export async function afterCallDeleted(db: D1Database, lessonId: string | null | undefined): Promise<void> {
  if (!lessonId) return;
  const left = await db.prepare('SELECT COUNT(*) AS n FROM calls WHERE lesson_id = ?').bind(lessonId).first<{ n: number }>();
  if (!left || left.n === 0) {
    await db.prepare('DELETE FROM call_lessons WHERE id = ?').bind(lessonId).run();
    return;
  }
  await refreshLessonEnd(db, lessonId);
  await db.prepare(`UPDATE call_lessons SET processing_status = 'none' WHERE id = ? AND processing_status IN ('done', 'failed')`).bind(lessonId).run();
}

const BUSY: ProcessingStatus[] = ['waiting_uploads', 'transcribing'];

/** The lesson's processing as one status for the review page (calls still transcribing count first). */
export function lessonProcessingStatus(lesson: LessonRow, calls: Pick<CallRow, 'status' | 'processing_status'>[]): ProcessingStatus {
  const waiting = calls.find((c) => c.status === 'ended' && BUSY.includes(c.processing_status));
  if (waiting) return waiting.processing_status;
  if (lesson.processing_status === 'summarizing') return 'summarizing';
  if (lesson.processing_status === 'done') return 'done';
  if (lesson.processing_status === 'failed') return 'failed';
  return calls.every((c) => c.status === 'live') ? 'none' : calls.some((c) => c.processing_status === 'failed') ? 'failed' : 'none';
}

/** The call ids a report should cover: every ended call of the lesson. */
function reportIds(calls: CallRow[]): string[] {
  return calls.filter((c) => c.status === 'ended').map((c) => c.id).sort();
}

export function reportIsCurrent(lesson: Pick<LessonRow, 'report_call_ids' | 'processing_status'>, calls: CallRow[]): boolean {
  if (lesson.processing_status !== 'done') return false;
  try {
    const had = (JSON.parse(lesson.report_call_ids ?? '[]') as string[]).slice().sort();
    return JSON.stringify(had) === JSON.stringify(reportIds(calls));
  } catch {
    return false;
  }
}

/**
 * Called whenever a call of the lesson finished transcribing (or "Process
 * now"): queue the lesson report when every ended call is transcribed, none is
 * live, and the report doesn't already cover exactly these calls.
 */
export async function advanceLessonProcessing(env: Env, lessonId: string, opts: { force?: boolean } = {}): Promise<void> {
  const lesson = await getLesson(env.DB, lessonId);
  if (!lesson) return;
  const calls = await lessonCalls(env.DB, lessonId);
  if (calls.length === 0) return;
  if (calls.some((c) => c.status === 'live')) return;
  if (calls.some((c) => BUSY.includes(c.processing_status) || c.processing_status === 'summarizing')) {
    await env.DB.prepare(`UPDATE call_lessons SET processing_status = 'waiting' WHERE id = ? AND processing_status IN ('none', 'done', 'failed')`).bind(lessonId).run();
    return;
  }
  if (!opts.force && reportIsCurrent(lesson, calls)) return;
  if (!opts.force && lesson.processing_status === 'failed' && lesson.report_call_ids && reportIsCurrent({ ...lesson, processing_status: 'done' }, calls)) return;
  const res = await env.DB
    .prepare(`UPDATE call_lessons SET processing_status = 'summarizing', processing_error = NULL WHERE id = ? AND processing_status <> 'summarizing'`)
    .bind(lessonId)
    .run();
  if ((res.meta?.changes ?? 0) > 0) await env.CALL_QUEUE.send({ kind: 'lesson_report', lessonId } satisfies CallProcessingMessage);
}

export interface LessonPageItem {
  page_id: string;
  number: number | null;
  title: string | null;
  text: string;
  edited: boolean;
}

/** Everything the lesson's calls left behind, combined (review page, report, homework). */
export interface LessonMaterial {
  lesson: LessonRow;
  pages: LessonPageItem[];
  calls: CallRow[];
  segments: { id: string; call_id: string; piece_id: string; user_id: string; start_ms: number; end_ms: number; text: string; language: string | null; pinyin: string | null; translation: string | null }[];
  board: BoardItem[];
  chat: CallChatMessage[];
  diagnostics: CallDiagEntry[];
  /** The text-board pages written in the lesson ("— Page 3 —" headed when several), the latest text of each. */
  boardText: string;
  startedAt: number | null;
  title: string | null;
}

export async function lessonMaterial(db: D1Database, lessonId: string): Promise<LessonMaterial | null> {
  const lesson = await getLesson(db, lessonId);
  if (!lesson) return null;
  const calls = await lessonCalls(db, lessonId);
  const ids = calls.map((c) => c.id);
  const marks = ids.map(() => '?').join(',') || "''";
  const [segs, links] = await Promise.all([
    db
      .prepare(`SELECT id, call_id, piece_id, user_id, start_ms, end_ms, text, language, pinyin, translation FROM call_transcript_segments WHERE call_id IN (${marks}) ORDER BY start_ms`)
      .bind(...ids)
      .all<LessonMaterial['segments'][number]>(),
    db
      .prepare(
        `SELECT l.call_id, l.page_id, l.text, l.edited, l.opened_at, p.title, p.position
           FROM call_board_pages l LEFT JOIN board_pages p ON p.id = l.page_id
          WHERE l.call_id IN (${marks})`,
      )
      .bind(...ids)
      .all<{ call_id: string; page_id: string; text: string; edited: number; opened_at: number; title: string | null; position: number | null }>(),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  const scopePages = await loadScopePages(db, { relationshipId: lesson.relationship_id, userId: lesson.created_by });
  const pages = lessonPages(links.results ?? [], order, new Map(scopePages.map((p, i) => [p.id, i + 1])));
  const edited = pages.filter((p) => p.edited && p.text.trim());
  const boardText = edited.length > 0
    ? edited.length === 1
      ? edited[0].text
      : edited.map((p) => `— ${p.title || (p.number ? `Page ${p.number}` : 'A deleted page')} —\n${p.text}`).join('\n\n')
    : calls.map((c) => (c.board_text ?? '').trim()).filter(Boolean).join('\n\n');
  const parse = <T,>(s: string | null | undefined): T[] => {
    try {
      return s ? (JSON.parse(s) as T[]) : [];
    } catch {
      return [];
    }
  };
  const chat = calls.flatMap((c) => parse<CallChatMessage>(c.chat_json));
  const seen = new Set<string>();
  return {
    lesson,
    pages,
    calls,
    segments: (segs.results ?? []),
    board: calls.flatMap((c) => parse<BoardItem>(c.board_json)),
    chat: chat.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))),
    diagnostics: calls.flatMap((c) => parse<CallDiagEntry>(c.diagnostics_json)).sort((a, b) => a.t - b.t),
    boardText,
    startedAt: calls.map((c) => c.started_at).find((s) => s !== null) ?? lesson.started_at,
    title: calls.map((c) => c.title).find(Boolean) ?? null,
  };
}

/** The pages a lesson's calls opened / wrote on: each page once, with the text of the LAST call that touched it. */
export function lessonPages(
  links: { call_id: string; page_id: string; text: string; edited: number; opened_at: number; title: string | null; position: number | null }[],
  callOrder: Map<string, number>,
  /** Page id → its number on the board today (absent = deleted since). */
  numberOf: Map<string, number> = new Map(),
): LessonPageItem[] {
  const byPage = new Map<string, (typeof links)[number] & { anyEdited: boolean }>();
  for (const l of links) {
    const cur = byPage.get(l.page_id);
    const later = !cur || (callOrder.get(l.call_id) ?? 0) >= (callOrder.get(cur.call_id) ?? 0);
    const anyEdited = Boolean(l.edited) || (cur?.anyEdited ?? false);
    byPage.set(l.page_id, later ? { ...l, anyEdited } : { ...cur!, anyEdited });
  }
  const list = [...byPage.values()].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.opened_at - b.opened_at);
  return list.map((l) => ({ page_id: l.page_id, number: numberOf.get(l.page_id) ?? null, title: l.title, text: l.text ?? '', edited: l.anyEdited }));
}

/** Merged transcript of the whole lesson (the review page). */
export function lessonTranscript(m: LessonMaterial) {
  return mergeTranscript(m.segments);
}
