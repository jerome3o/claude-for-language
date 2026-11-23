/**
 * Everything a recap of one video lesson needs (GET /api/calls/:id/recap; the MCP tool
 * `get_lesson_for_recap`, docs/AUDIO_LESSONS.md "Composed lessons"): the lesson (all its calls,
 * shared/calls/lessons.ts), the merged transcript speaker by speaker with each line's offset from
 * the start, the board text, the in-call chat, the lesson report, and — for the learner — the
 * notes the tutor left (the learner's own `lesson_notes`: a logged lesson's notes are copied there)
 * and the homework sent from it.
 *
 * Access: a member of the call only (requireCall: 404 for anyone else). Only the CALLER's own rows
 * are read beyond the call itself (their lesson notes, their assignments, their deck copies) — never
 * the tutor's private student profile, the tutor's session-notes jobs or anyone's e-mail.
 */
import { mergeTranscript, formatOffset, type CallChatMessage } from '@shared/calls';
import { getParticipants, requireCall, type CallRow } from './store';
import { getLesson, lessonMaterial } from './lessons';
import type { CallReport } from './report';

/** Homework created this long after the lesson still counts as "around" it (unless the next lesson came first). */
export const RECAP_HOMEWORK_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** …and from a little before it (a tutor sending the deck while the call starts). */
export const RECAP_HOMEWORK_LEAD_MS = 60 * 60 * 1000;
/** Words listed per deck assignment. */
export const RECAP_MAX_WORDS = 80;
/** Transcript lines returned (a long lesson keeps its first ones and says so). */
export const RECAP_MAX_SEGMENTS = 2000;

export interface RecapPerson {
  id: string;
  name: string;
  role: 'tutor' | 'student' | 'me';
  is_me: boolean;
}

export interface RecapTranscriptLine {
  /** Offset from the start of the lesson, "4:05". */
  at: string;
  ms: number;
  speaker: string;
  /** The speaker is the caller. */
  me: boolean;
  text: string;
  pinyin: string | null;
  english: string | null;
}

export interface RecapHomework {
  id: string;
  kind: string;
  title: string;
  mode: string;
  due_date: string | null;
  status: string;
  created_at: string;
  /** Linked to this lesson by the tutor's "Make homework from this lesson" (else: sent around it). */
  from_this_lesson: boolean;
  /** A deck: its words (the student's copy; the assignment's part when split). */
  words?: Array<{ hanzi: string; pinyin: string; english: string }>;
  word_count?: number;
}

export interface LessonRecapMaterial {
  call_id: string;
  lesson_id: string | null;
  title: string | null;
  /** Epoch ms. */
  started_at: number | null;
  ended_at: number | null;
  duration_minutes: number | null;
  /** The caller's side of the lesson. */
  my_role: 'student' | 'tutor' | 'solo';
  people: RecapPerson[];
  calls: Array<{ id: string; started_at: number | null; ended_at: number | null; status: string }>;
  processing_status: string;
  transcript: RecapTranscriptLine[];
  transcript_lines_total: number;
  board_text: string;
  chat: Array<{ from: string; text: string; at: string | null }>;
  report: Pick<CallReport, 'summary' | 'topics' | 'vocabulary' | 'corrections' | 'follow_ups'> | null;
  /** The caller's lesson notes written around the lesson (a tutor's logged notes arrive as "[From tutor …]"). */
  lesson_notes: Array<{ text: string; given_at: string | null; created_at: string }>;
  /** Homework the caller was sent from / around this lesson (empty for the tutor). */
  homework: RecapHomework[];
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) — compared with datetime(column) so ISO and SQLite's own format both work. */
function sqlTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export async function lessonRecapMaterial(db: D1Database, callId: string, userId: string, opts: { maxSegments?: number } = {}): Promise<LessonRecapMaterial> {
  const call = await requireCall(db, callId, userId);
  const material = call.lesson_id ? await lessonMaterial(db, call.lesson_id) : null;
  const calls: CallRow[] = material ? material.calls : [call];
  const participants = await getParticipants(db, call);

  // Who is the tutor (a relationship's tutor side), so lines read "Minghui (tutor)".
  let tutorId: string | null = null;
  if (call.relationship_id) {
    const rel = await db
      .prepare('SELECT requester_id, recipient_id, requester_role FROM tutor_relationships WHERE id = ?')
      .bind(call.relationship_id)
      .first<{ requester_id: string; recipient_id: string; requester_role: string }>();
    if (rel) tutorId = rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
  }
  const people: RecapPerson[] = participants.map((p) => {
    const role: RecapPerson['role'] = !call.relationship_id ? 'me' : p.id === tutorId ? 'tutor' : 'student';
    return { id: p.id, name: p.name?.trim() || (role === 'tutor' ? 'Tutor' : role === 'student' ? 'Student' : 'Me'), role, is_me: p.id === userId };
  });
  const nameOf = new Map(people.map((p) => [p.id, tutorId ? `${p.name} (${p.role})` : p.name]));
  const myRole: LessonRecapMaterial['my_role'] = !call.relationship_id ? 'solo' : userId === tutorId ? 'tutor' : 'student';

  const segments = material
    ? material.segments
    : ((await db
        .prepare('SELECT id, call_id, piece_id, user_id, start_ms, end_ms, text, language, pinyin, translation FROM call_transcript_segments WHERE call_id = ? ORDER BY start_ms')
        .bind(call.id)
        .all()).results ?? []) as NonNullable<Awaited<ReturnType<typeof lessonMaterial>>>['segments'];
  const merged = mergeTranscript(segments);
  const startedAt = material?.lesson.started_at ?? call.started_at ?? null;
  const base = startedAt ?? (merged.length ? merged[0].start_ms : 0);
  const max = Math.max(1, opts.maxSegments ?? RECAP_MAX_SEGMENTS);
  const transcript: RecapTranscriptLine[] = merged.slice(0, max).map((s) => {
    const ms = Math.max(0, s.start_ms - base);
    return {
      at: formatOffset(ms),
      ms,
      speaker: nameOf.get(s.user_id) ?? 'Someone',
      me: s.user_id === userId,
      text: s.text,
      pinyin: s.pinyin ?? null,
      english: s.translation ?? null,
    };
  });

  const endedAt = material?.lesson.last_ended_at ?? call.ended_at ?? null;
  const chatRaw: CallChatMessage[] = material ? material.chat : parse<CallChatMessage[]>(call.chat_json, []);
  const reportRaw = parse<CallReport | null>(material?.lesson.summary_json ?? call.summary_json, null);

  // The window "around" the lesson: from a little before it to the next lesson of the pair (≤ 7 days).
  const lessonStart = startedAt ?? Date.parse(call.created_at);
  let windowEnd = (endedAt ?? lessonStart) + RECAP_HOMEWORK_WINDOW_MS;
  if (call.relationship_id && Number.isFinite(lessonStart)) {
    const next = await db
      .prepare('SELECT MIN(started_at) AS next FROM call_lessons WHERE relationship_id = ? AND started_at > ?')
      .bind(call.relationship_id, material?.lesson.started_at ?? lessonStart)
      .first<{ next: number | null }>();
    if (next?.next) windowEnd = Math.min(windowEnd, next.next);
  }
  const windowStart = lessonStart - RECAP_HOMEWORK_LEAD_MS;

  const notes = Number.isFinite(lessonStart)
    ? ((await db
        .prepare(
          `SELECT raw_text, given_at, created_at FROM lesson_notes
            WHERE user_id = ? AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
            ORDER BY created_at LIMIT 20`,
        )
        .bind(userId, sqlTime(windowStart), sqlTime(windowEnd))
        .all<{ raw_text: string; given_at: string | null; created_at: string }>()).results ?? [])
    : [];

  const homework = myRole === 'student' && call.relationship_id && Number.isFinite(lessonStart)
    ? await recapHomework(db, userId, call.relationship_id, calls.map((c) => c.id), windowStart, windowEnd)
    : [];

  return {
    call_id: call.id,
    lesson_id: call.lesson_id ?? null,
    title: material?.title ?? call.title ?? null,
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: startedAt && endedAt && endedAt > startedAt ? Math.round((endedAt - startedAt) / 60000) : null,
    my_role: myRole,
    people,
    calls: calls.map((c) => ({ id: c.id, started_at: c.started_at, ended_at: c.ended_at, status: c.status })),
    processing_status: material ? material.lesson.processing_status : call.processing_status,
    transcript,
    transcript_lines_total: merged.length,
    board_text: material ? material.boardText : call.board_text ?? '',
    chat: chatRaw.map((m) => ({ from: m.user_id === userId ? `${m.name || 'Me'} (me)` : m.name || 'Someone', text: m.text, at: Number.isFinite(m.at) && startedAt ? formatOffset(Math.max(0, m.at - startedAt)) : null })),
    report: reportRaw
      ? { summary: reportRaw.summary, topics: reportRaw.topics ?? [], vocabulary: reportRaw.vocabulary ?? [], corrections: reportRaw.corrections ?? [], follow_ups: reportRaw.follow_ups ?? [] }
      : null,
    lesson_notes: notes.map((n) => ({ text: n.raw_text, given_at: n.given_at, created_at: n.created_at })),
    homework,
  };
}

async function recapHomework(db: D1Database, studentId: string, relationshipId: string, callIds: string[], fromMs: number, toMs: number): Promise<RecapHomework[]> {
  const marks = callIds.map(() => '?').join(',') || "''";
  const { results } = await db
    .prepare(
      `SELECT a.id, a.kind, a.target_id, a.title, a.mode, a.due_date, a.status, a.item_ids, a.item_count, a.created_at,
              (a.batch_id IS NOT NULL AND a.batch_id IN (SELECT id FROM tutor_note_jobs WHERE source_call_id IN (${marks}))) AS linked
         FROM assignments a
        WHERE a.student_id = ? AND a.relationship_id = ? AND a.status != 'cancelled'
          AND ((a.batch_id IS NOT NULL AND a.batch_id IN (SELECT id FROM tutor_note_jobs WHERE source_call_id IN (${marks})))
               OR datetime(a.created_at) BETWEEN datetime(?) AND datetime(?))
        ORDER BY a.created_at, a.part_index
        LIMIT 30`,
    )
    .bind(...callIds, studentId, relationshipId, ...callIds, sqlTime(fromMs), sqlTime(toMs))
    .all<{ id: string; kind: string; target_id: string; title: string; mode: string; due_date: string | null; status: string; item_ids: string | null; item_count: number; created_at: string; linked: number }>();
  const out: RecapHomework[] = [];
  for (const a of results ?? []) {
    const hw: RecapHomework = {
      id: a.id,
      kind: a.kind,
      title: a.title,
      mode: a.mode,
      due_date: a.due_date,
      status: a.status,
      created_at: a.created_at,
      from_this_lesson: !!a.linked,
    };
    if (a.kind === 'deck') {
      // The student's own copy (a deck of theirs): the assignment's part when it is split.
      const ids = parse<string[]>(a.item_ids, []).filter((x) => typeof x === 'string');
      const rows = ids.length
        ? await db
            .prepare(
              `SELECT n.hanzi, n.pinyin, n.english FROM notes n JOIN decks d ON d.id = n.deck_id
                WHERE d.id = ? AND d.user_id = ? AND n.id IN (${ids.slice(0, RECAP_MAX_WORDS).map(() => '?').join(',')}) ORDER BY n.created_at, n.id`,
            )
            .bind(a.target_id, studentId, ...ids.slice(0, RECAP_MAX_WORDS))
            .all<{ hanzi: string; pinyin: string; english: string }>()
        : await db
            .prepare(
              `SELECT n.hanzi, n.pinyin, n.english FROM notes n JOIN decks d ON d.id = n.deck_id
                WHERE d.id = ? AND d.user_id = ? ORDER BY n.created_at, n.id LIMIT ?`,
            )
            .bind(a.target_id, studentId, RECAP_MAX_WORDS)
            .all<{ hanzi: string; pinyin: string; english: string }>();
      hw.words = (rows.results ?? []).map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin ?? '', english: w.english ?? '' }));
      hw.word_count = ids.length || a.item_count || hw.words.length;
    }
    out.push(hw);
  }
  return out;
}

/** "Recap of the 21 Nov lesson" — a composed lesson's source label (the caller's time zone when known). */
export function recapSourceLabel(startedAtMs: number | null, timeZone: string | null): string {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) return 'Recap of a video lesson';
  let day: string;
  try {
    day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: timeZone || 'UTC' }).format(new Date(startedAtMs));
  } catch {
    day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(startedAtMs));
  }
  return `Recap of the ${day} lesson`;
}

/**
 * A composed lesson's `source` checked against the caller: the call (or the lesson, by any of its
 * calls) must be one they were in. Returns the stored source with its label, or null + why.
 */
export async function resolveRecapSource(
  db: D1Database,
  userId: string,
  source: { call_id?: unknown; lesson_id?: unknown; label?: unknown },
): Promise<{ ok: true; source: { call_id?: string; lesson_id?: string; label: string } } | { ok: false; error: string }> {
  const label = typeof source.label === 'string' && source.label.trim() ? source.label.trim().slice(0, 80) : null;
  let callId = typeof source.call_id === 'string' && source.call_id.trim() ? source.call_id.trim() : null;
  const lessonId = typeof source.lesson_id === 'string' && source.lesson_id.trim() ? source.lesson_id.trim() : null;
  if (!callId && lessonId) {
    const first = await db.prepare('SELECT id FROM calls WHERE lesson_id = ? ORDER BY created_at, id LIMIT 1').bind(lessonId).first<{ id: string }>();
    if (!first) return { ok: false, error: 'source.lesson_id is not one of your lessons' };
    callId = first.id;
  }
  if (!callId) {
    if (label) return { ok: true, source: { label } };
    return { ok: false, error: 'source: give call_id, lesson_id or label' };
  }
  let call: CallRow;
  try {
    call = await requireCall(db, callId, userId);
  } catch {
    return { ok: false, error: lessonId ? 'source.lesson_id is not one of your lessons' : 'source.call_id is not one of your lessons' };
  }
  if (lessonId && call.lesson_id !== lessonId) return { ok: false, error: 'source.call_id is not part of source.lesson_id' };
  const lesson = call.lesson_id ? await getLesson(db, call.lesson_id) : null;
  const tz = await db.prepare('SELECT time_zone FROM users WHERE id = ?').bind(userId).first<{ time_zone: string | null }>().catch(() => null);
  return {
    ok: true,
    source: {
      call_id: call.id,
      ...(call.lesson_id ? { lesson_id: call.lesson_id } : {}),
      label: label ?? recapSourceLabel(lesson?.started_at ?? call.started_at ?? Date.parse(call.created_at), tz?.time_zone ?? null),
    },
  };
}
