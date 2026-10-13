/**
 * What the prepared-activities generator reads about one student (and what
 * "What <student> has covered" shows the tutor): the newest lesson reports,
 * the last lesson's board + activities, the tutor's lesson-log notes, words
 * they struggle with and mix up, recent homework words, known counts and the
 * tutor's private profile. Everything already exists — this only gathers it.
 */

import type { CallReport } from '../calls/report';
import { lessonMaterial } from '../calls/lessons';
import { activitiesNotes, listCallActivities } from '../calls/activities';
import { getKnownCounts } from '../known-counts';
import { rankStruggling } from '../insights';
import * as iq from '../../db/insights-queries';
import { getStudentProfile } from '../../db/student-profile-queries';
import { deriveMixUps, type MixUp } from '@shared/recordings/mixups';
import type { StudentProfileFields } from '@shared/students';
import type { CoveredLesson, CoverageWord, StudentCoverage } from '@shared/students/coverage';

export interface CallLessonInput {
  id: string;
  started_at: number;
  report: CallReport | null;
}

export interface LogEntryInput {
  lesson_at: string;
  title: string | null;
  notes: string | null;
}

/** "2026-10-03" from epoch ms / an ISO string. */
const day = (t: number | string) => (typeof t === 'number' ? new Date(t).toISOString() : t).slice(0, 10);

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The coverage picture (pure): call lessons and lesson-log entries merged by
 * day (a logged lesson on the day of a recorded one is the same lesson), the
 * newest `maxLessons` listed; recent words from the newest reports first, then
 * homework, each word once.
 */
export function buildCoverage(input: {
  callLessons: CallLessonInput[];
  logEntries: LogEntryInput[];
  known: { words: { known: number; learning: number }; characters: { known: number; learning: number } };
  homeworkWords: CoverageWord[];
  /** Every lesson day on record (for the count), when more than the lists above. */
  allLessonDays?: string[];
  maxLessons?: number;
  maxWords?: number;
}): StudentCoverage {
  const byDay = new Map<string, CoveredLesson>();
  for (const l of [...input.callLessons].sort((a, b) => b.started_at - a.started_at)) {
    const date = day(l.started_at);
    const r = l.report;
    const entry: CoveredLesson = {
      date,
      title: null,
      topics: (r?.topics ?? []).map((t) => oneLine(t, 80)).filter(Boolean).slice(0, 6),
      source: 'call',
      new_words: r?.vocabulary?.length ?? 0,
      corrections: r?.corrections?.length ?? 0,
    };
    const cur = byDay.get(date);
    if (!cur) byDay.set(date, entry);
    else if (cur.source === 'call') {
      // Two lessons on one day: one row with both lessons' topics.
      cur.topics = [...new Set([...cur.topics, ...entry.topics])].slice(0, 8);
      cur.new_words += entry.new_words;
      cur.corrections += entry.corrections;
    }
  }
  for (const e of input.logEntries) {
    const date = day(e.lesson_at);
    const cur = byDay.get(date);
    const title = e.title?.trim() || (e.notes ? oneLine(e.notes.split('\n')[0] ?? '', 80) : null) || null;
    if (cur) {
      if (!cur.title && title) cur.title = title;
      continue;
    }
    byDay.set(date, { date, title, topics: [], source: 'notes', new_words: 0, corrections: 0 });
  }
  const lessons = [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const days = new Set([...(input.allLessonDays ?? []).map((d) => d.slice(0, 10)), ...lessons.map((l) => l.date)]);

  const recent: CoverageWord[] = [];
  const seen = new Set<string>();
  const add = (w: CoverageWord) => {
    const k = w.hanzi.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    recent.push({ hanzi: k, pinyin: w.pinyin ?? '', english: w.english ?? '' });
  };
  for (const l of [...input.callLessons].sort((a, b) => b.started_at - a.started_at)) {
    for (const v of l.report?.vocabulary ?? []) add(v);
  }
  for (const w of input.homeworkWords) add(w);

  const newest = [...input.callLessons].sort((a, b) => b.started_at - a.started_at).find((l) => (l.report?.corrections?.length ?? 0) > 0);
  return {
    lessons: lessons.slice(0, input.maxLessons ?? 8),
    lesson_count: days.size,
    words: input.known.words,
    characters: input.known.characters,
    recent_words: recent.slice(0, input.maxWords ?? 24),
    recent_corrections: (newest?.report?.corrections ?? []).slice(0, 6).map((c) => ({ said: c.said, better: c.better })),
  };
}

export interface RelationshipPeople {
  relationshipId: string;
  tutorId: string;
  studentId: string;
  tutorName: string | null;
  studentName: string | null;
}

/** The tutor / student of an ACTIVE relationship (null otherwise). */
export async function relationshipPeople(db: D1Database, relationshipId: string): Promise<RelationshipPeople | null> {
  const rel = await db
    .prepare(
      `SELECT r.id, r.requester_id, r.recipient_id, r.requester_role, rq.name AS requester_name, rc.name AS recipient_name
         FROM tutor_relationships r
         LEFT JOIN users rq ON rq.id = r.requester_id
         LEFT JOIN users rc ON rc.id = r.recipient_id
        WHERE r.id = ? AND r.status = 'active'`,
    )
    .bind(relationshipId)
    .first<{ id: string; requester_id: string; recipient_id: string; requester_role: string; requester_name: string | null; recipient_name: string | null }>();
  if (!rel) return null;
  const requesterIsTutor = rel.requester_role === 'tutor';
  return {
    relationshipId: rel.id,
    tutorId: requesterIsTutor ? rel.requester_id : rel.recipient_id,
    studentId: requesterIsTutor ? rel.recipient_id : rel.requester_id,
    tutorName: requesterIsTutor ? rel.requester_name : rel.recipient_name,
    studentName: requesterIsTutor ? rel.recipient_name : rel.requester_name,
  };
}

function parseReport(json: string | null): CallReport | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as CallReport;
  } catch {
    return null;
  }
}

async function callLessons(db: D1Database, relationshipId: string, limit: number): Promise<CallLessonInput[]> {
  const rows = await db
    .prepare(
      `SELECT id, started_at, summary_json FROM call_lessons
        WHERE relationship_id = ? AND summary_json IS NOT NULL
        ORDER BY started_at DESC LIMIT ?`,
    )
    .bind(relationshipId, limit)
    .all<{ id: string; started_at: number; summary_json: string | null }>();
  return (rows.results ?? []).map((r) => ({ id: r.id, started_at: r.started_at, report: parseReport(r.summary_json) }));
}

async function lessonDays(db: D1Database, relationshipId: string): Promise<string[]> {
  const [calls, log] = await Promise.all([
    db.prepare(`SELECT started_at FROM call_lessons WHERE relationship_id = ? AND summary_json IS NOT NULL`).bind(relationshipId).all<{ started_at: number }>(),
    db.prepare(`SELECT lesson_at FROM tutor_lesson_log WHERE relationship_id = ?`).bind(relationshipId).all<{ lesson_at: string }>(),
  ]);
  return [...(calls.results ?? []).map((r) => day(r.started_at)), ...(log.results ?? []).map((r) => day(r.lesson_at))];
}

/** Words of decks sent as homework in the last `days` days (the student's copies), newest first. */
async function recentHomeworkWords(db: D1Database, relationshipId: string, days = 21, limit = 30): Promise<CoverageWord[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = await db
    .prepare(
      `SELECT n.hanzi, n.pinyin, n.english
         FROM assignments a JOIN notes n ON n.deck_id = a.target_id
        WHERE a.relationship_id = ? AND a.kind = 'deck' AND a.status <> 'cancelled' AND a.created_at >= ?
        ORDER BY a.created_at DESC, n.created_at DESC LIMIT ?`,
    )
    .bind(relationshipId, since, limit)
    .all<CoverageWord>();
  return rows.results ?? [];
}

/** "What <student> has covered" for the tutor's student page. */
export async function loadCoverage(db: D1Database, people: RelationshipPeople): Promise<StudentCoverage> {
  const [lessons, log, known, homework, days] = await Promise.all([
    callLessons(db, people.relationshipId, 8),
    iq.listLessonLog(db, people.relationshipId, 8).catch(() => []),
    getKnownCounts(db, people.studentId).catch(() => ({ words: { known: 0, learning: 0 }, characters: { known: 0, learning: 0 }, sentences: { known: 0, learning: 0 } })),
    recentHomeworkWords(db, people.relationshipId).catch(() => []),
    lessonDays(db, people.relationshipId).catch(() => []),
  ]);
  return buildCoverage({
    callLessons: lessons,
    logEntries: log.map((e) => ({ lesson_at: e.lesson_at, title: e.title ?? null, notes: e.notes ?? null })),
    known,
    homeworkWords: homework,
    allLessonDays: days,
  });
}

/** Everything the generator reads. */
export interface ActivityContext {
  people: RelationshipPeople;
  profile: StudentProfileFields | null;
  coverage: StudentCoverage;
  /** The newest lesson with a report (the one the activities follow up on). */
  lastLesson: { id: string; date: string; report: CallReport; boardText: string; activities: string } | null;
  /** The lesson before it (its report, briefly), for spacing. */
  earlierLesson: { date: string; report: CallReport } | null;
  /** Lesson-log notes newer than the last recorded lesson (a lesson without a call). */
  newerNotes: { date: string; title: string | null; notes: string }[];
  struggling: { hanzi: string; english: string; again: number; attempts: number; wrong: string[] }[];
  mixUps: Pick<MixUp, 'a' | 'b' | 'count'>[];
  homeworkWords: CoverageWord[];
  /** Titles of activities already prepared (not dismissed) — not to repeat. */
  existingTitles: string[];
}

export async function loadActivityContext(db: D1Database, people: RelationshipPeople): Promise<ActivityContext> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const [lessons, log, profile, rows, homework, existing, coverage] = await Promise.all([
    callLessons(db, people.relationshipId, 2),
    iq.listLessonLog(db, people.relationshipId, 5).catch(() => []),
    getStudentProfile(db, people.relationshipId, people.tutorId).catch(() => null),
    iq.fetchReviewRows(db, people.studentId, from, to, 4000).catch(() => []),
    recentHomeworkWords(db, people.relationshipId).catch(() => []),
    db
      .prepare(`SELECT title FROM prepared_activities WHERE relationship_id = ? AND status <> 'dismissed' ORDER BY created_at DESC LIMIT 20`)
      .bind(people.relationshipId)
      .all<{ title: string }>()
      .then((r) => (r.results ?? []).map((x) => x.title))
      .catch(() => [] as string[]),
    loadCoverage(db, people),
  ]);
  let lastLesson: ActivityContext['lastLesson'] = null;
  const newest = lessons.find((l) => l.report);
  if (newest?.report) {
    const material = await lessonMaterial(db, newest.id).catch(() => null);
    const played = material ? await listCallActivities(db, material.calls.map((c) => c.id)).catch(() => []) : [];
    lastLesson = {
      id: newest.id,
      date: day(newest.started_at),
      report: newest.report,
      boardText: (material?.boardText ?? '').trim().slice(0, 3000),
      activities: played.length ? activitiesNotes(played, 1500) : '',
    };
  }
  const older = lessons.find((l) => l.report && l.id !== newest?.id);
  const newerNotes = log
    .filter((e) => (e.notes ?? '').trim() && (!lastLesson || day(e.lesson_at) > lastLesson.date))
    .slice(0, 3)
    .map((e) => ({ date: day(e.lesson_at), title: e.title ?? null, notes: (e.notes ?? '').trim().slice(0, 2500) }));
  return {
    people,
    profile,
    coverage,
    lastLesson,
    earlierLesson: older?.report ? { date: day(older.started_at), report: older.report } : null,
    newerNotes,
    struggling: rankStruggling(rows, 12).map((s) => ({ hanzi: s.note.hanzi, english: s.note.english, again: s.again_count, attempts: s.attempts, wrong: s.wrong_answers.slice(0, 3) })),
    mixUps: deriveMixUps(rows, 8).map((m) => ({ a: m.a, b: m.b, count: m.count })),
    homeworkWords: homework,
    existingTitles: existing,
  };
}

/** The newest source the activities would follow (lesson report or lesson-log entry), ISO; null = nothing yet. */
export async function newestSourceAt(db: D1Database, relationshipId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(t) AS t FROM (
         SELECT datetime(COALESCE(last_ended_at, started_at) / 1000, 'unixepoch') AS t FROM call_lessons WHERE relationship_id = ?1 AND summary_json IS NOT NULL
         UNION ALL
         SELECT created_at AS t FROM tutor_lesson_log WHERE relationship_id = ?1 AND notes IS NOT NULL AND notes <> ''
       )`,
    )
    .bind(relationshipId)
    .first<{ t: string | null }>();
  return row?.t ?? null;
}
