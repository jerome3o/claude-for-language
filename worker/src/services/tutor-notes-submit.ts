/**
 * Starting a session-notes job — shared by the two entry points:
 *   - the tutor pastes notes (POST /api/relationships/:relId/session-notes)
 *   - the tutor makes homework from a recorded video lesson (POST /api/calls/:id/homework),
 *     where the "notes" are the call's transcript, whiteboard text, chat and report.
 *
 * `composeCallNotes` is pure so the transcript → notes shaping is unit-tested.
 */

import { transcriptToText, mergeTranscript, type BoardItem, type CallChatMessage, type TranscriptSegment } from '@shared/calls';
import type { Env } from '../types';
import type { User } from '../types';
import * as jobs from '../db/tutor-notes-queries';
import * as iq from '../db/insights-queries';
import { MAX_NOTES_CHARS } from './tutor-notes-agent';
import { lessonMaterials } from './materials';
import type { LessonMaterial } from './calls/lessons';
import type { CallRow, CallParticipant } from './calls/store';
import { roleNames, type CallReport } from './calls/report';

export class SubmitError extends Error {
  constructor(public status: 400 | 409 | 503, message: string) {
    super(message);
  }
}

/** At most this many jobs may be queued or running per student at once. */
export const MAX_ACTIVE_JOBS = 2;

export interface SubmitInput {
  relationshipId: string;
  tutor: Pick<User, 'id' | 'name' | 'email'>;
  studentId: string;
  notes: string;
  title: string | null;
  /** ISO timestamp, or null for "now". */
  lessonAt: string | null;
  priority: jobs.TutorNotesPriority;
  autoShare: boolean;
  logLesson: boolean;
  sourceCallId?: string | null;
  /** A DRAFT the tutor reviews before anything is sent (docs/HOMEWORK.md). */
  review?: boolean;
  /** Draft homework from an existing lesson-notes entry (it is not logged again). */
  lessonLogId?: string | null;
}

/** Validate, log the lesson when asked, create the row and queue it. */
export async function submitSessionNotes(env: Env, input: SubmitInput): Promise<jobs.TutorNotesJob> {
  if (!env.ANTHROPIC_API_KEY) throw new SubmitError(503, 'The session-notes assistant is not configured on this server (missing ANTHROPIC_API_KEY)');
  if (!env.TUTOR_NOTES_QUEUE) throw new SubmitError(503, 'The session-notes queue is not configured on this server');
  const notes = input.notes.trim();
  if (notes.length < 20) throw new SubmitError(400, 'Paste the notes from the session (at least a few lines)');
  if (notes.length > MAX_NOTES_CHARS * 2) throw new SubmitError(400, `Notes are too long (max ${MAX_NOTES_CHARS * 2} characters)`);

  const active = await jobs.countRunningJobs(env.DB, input.relationshipId);
  if (active >= MAX_ACTIVE_JOBS) throw new SubmitError(409, 'Two sets of notes are already being worked on for this student — wait for one to finish');

  // The notes are a lesson: log it (anchors "since last lesson" in Insights)
  // and hand the text to the student's Lesson Notes like the manual log does.
  let lessonLogId: string | null = input.lessonLogId ?? null;
  if (input.logLesson && !lessonLogId) {
    const at = input.lessonAt ?? new Date().toISOString();
    const entry = await iq.createLessonLogEntry(env.DB, {
      relationship_id: input.relationshipId,
      tutor_id: input.tutor.id,
      student_id: input.studentId,
      lesson_at: at,
      notes: input.title ? `${input.title}\n${notes}` : notes,
      title: input.title,
    });
    lessonLogId = entry.id;
    const tutorName = input.tutor.name || input.tutor.email || 'your tutor';
    const excerpt = notes.length > 6000 ? `${notes.slice(0, 6000)}…` : notes;
    await iq.createStudentLessonNote(env.DB, input.studentId, `[From tutor ${tutorName}, ${at.slice(0, 10)}]\n${input.title ? `${input.title}\n` : ''}${excerpt}`, at.slice(0, 10));
  }

  const job = await jobs.createJob(env.DB, {
    relationship_id: input.relationshipId,
    tutor_id: input.tutor.id,
    student_id: input.studentId,
    title: input.title,
    notes,
    lesson_at: input.lessonAt,
    priority: input.priority,
    auto_share: input.autoShare,
    lesson_log_id: lessonLogId,
    source_call_id: input.sourceCallId ?? null,
    review: input.review ?? false,
  });
  await env.TUTOR_NOTES_QUEUE.send({ jobId: job.id });
  return job;
}

// ============ A recorded video lesson as session notes ============

export interface CallNotesInput {
  title: string | null;
  startedAt: number | null;
  /** user id → display name (with the role in brackets when known). */
  names: Record<string, string>;
  transcript: readonly Pick<TranscriptSegment, 'id' | 'user_id' | 'start_ms' | 'end_ms' | 'text' | 'translation'>[];
  board: readonly BoardItem[];
  /** The shared text board, typed together during the call. */
  boardText?: string | null;
  chat: readonly CallChatMessage[];
  report: Pick<CallReport, 'summary' | 'corrections' | 'follow_ups'> | null;
  /** Lesson materials presented in the call(s) (round 4): title, the pages shown (0-based) and their text. */
  materials?: { title: string; page_count: number; pages_shown: number[]; text: string }[];
}

/** The materials' share of the notes. */
const MATERIALS_BUDGET = 12_000;

/** Roughly what the transcript may take of the notes budget; the rest is for board / chat / report. */
const TRANSCRIPT_BUDGET = Math.floor(MAX_NOTES_CHARS * 0.85);

function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n\n[… middle of the lesson omitted for length …]\n\n${text.slice(-half)}`;
}

/**
 * The text the agent reads for a recorded lesson: transcript with
 * translations, whiteboard text, in-call chat and the lesson report when
 * there is one. Empty string when the call has nothing to work from.
 */
export function composeCallNotes(input: CallNotesInput): string {
  const segments = mergeTranscript(input.transcript);
  const boardText = input.board.filter((b): b is Extract<BoardItem, { type: 'text' }> => b.type === 'text').map((b) => b.text.trim()).filter(Boolean);
  const chatLines = input.chat.map((m) => `${input.names[m.user_id] || m.name}: ${m.text}`).filter((l) => l.trim());
  const sharedNotes = (input.boardText ?? '').trim();
  if (segments.length === 0 && boardText.length === 0 && chatLines.length === 0 && !input.report && !sharedNotes && !(input.materials ?? []).some((m) => m.text.trim())) return '';

  const startMs = input.startedAt ?? segments[0]?.start_ms ?? 0;
  const parts: string[] = [];
  parts.push(`Recorded video lesson${input.title ? `: ${input.title}` : ''}`);
  parts.push(`Participants: ${Object.values(input.names).join(', ')}`);
  if (input.report) {
    parts.push('');
    parts.push('LESSON REPORT (written by Claude from the same recording)');
    parts.push(`Summary: ${input.report.summary}`);
    if (input.report.corrections.length > 0) {
      parts.push('Corrections of what the learner said:');
      for (const c of input.report.corrections) parts.push(`- said "${c.said}" → better "${c.better}"${c.pinyin ? ` (${c.pinyin})` : ''}: ${c.explanation}`);
    }
    if (input.report.follow_ups.length > 0) {
      parts.push('To practise before next time:');
      for (const f of input.report.follow_ups) parts.push(`- ${f}`);
    }
  }
  const mats = (input.materials ?? []).filter((m) => m.text.trim());
  if (mats.length > 0) {
    parts.push('');
    parts.push('LESSON MATERIALS PRESENTED (the slides / pages the tutor showed — their text; pages shown in the call are marked)');
    const per = Math.floor(MATERIALS_BUDGET / mats.length);
    for (const m of mats) {
      const shown = m.pages_shown.length ? ` — pages shown: ${m.pages_shown.map((p) => p + 1).join(', ')} of ${m.page_count}` : '';
      parts.push(`"${m.title}"${shown}`);
      parts.push(m.text.length > per ? `${m.text.slice(0, per)}\n[… rest of the material cut for length …]` : m.text);
    }
  }
  if (sharedNotes) {
    parts.push('');
    parts.push('SHARED NOTES (typed together on the board during the lesson — the most deliberate record of what was taught)');
    parts.push(sharedNotes.slice(0, 20_000));
  }
  if (boardText.length > 0) {
    parts.push('');
    parts.push('WRITTEN ON THE WHITEBOARD');
    parts.push(...boardText);
  }
  if (chatLines.length > 0) {
    parts.push('');
    parts.push('IN-CALL CHAT');
    parts.push(...chatLines);
  }
  parts.push('');
  parts.push('TRANSCRIPT (time from the start of the call; translations in brackets where the recogniser gave one)');
  parts.push(segments.length > 0 ? trimMiddle(transcriptToText(segments, input.names, startMs, { translations: true }), TRANSCRIPT_BUDGET) : '(no speech was transcribed)');
  return parts.join('\n');
}

/** Load a LESSON's material (every call of it) and shape it as session notes. */
export async function lessonNotesFor(env: Env, m: LessonMaterial, participants: CallParticipant[]): Promise<{ notes: string; names: Record<string, string> }> {
  const names = await roleNames(env.DB, m.calls[0], participants);
  const report = m.lesson.summary_json ? (JSON.parse(m.lesson.summary_json) as CallReport) : null;
  const materials = await lessonMaterials(env.DB, m.calls.map((c) => c.id)).catch(() => []);
  const notes = composeCallNotes({
    materials,
    title: m.calls.length > 1 ? `${m.title ?? 'Lesson'} (${m.calls.length} calls in a row, one lesson)` : m.title,
    startedAt: m.startedAt,
    names,
    transcript: m.segments,
    board: m.board,
    boardText: m.boardText,
    chat: m.chat,
    report,
  });
  return { notes, names };
}

/** Load a call's material and shape it as session notes. */
export async function callNotesFor(env: Env, call: CallRow, participants: CallParticipant[]): Promise<{ notes: string; names: Record<string, string> }> {
  const rows = await env.DB
    .prepare('SELECT id, user_id, start_ms, end_ms, text, translation FROM call_transcript_segments WHERE call_id = ? ORDER BY start_ms')
    .bind(call.id)
    .all<{ id: string; user_id: string; start_ms: number; end_ms: number; text: string; translation: string | null }>();
  const names = await roleNames(env.DB, call, participants);
  const materials = await lessonMaterials(env.DB, [call.id]).catch(() => []);
  const notes = composeCallNotes({
    materials,
    title: call.title,
    startedAt: call.started_at,
    names,
    transcript: rows.results ?? [],
    board: call.board_json ? (JSON.parse(call.board_json) as BoardItem[]) : [],
    boardText: call.board_text ?? null,
    chat: call.chat_json ? (JSON.parse(call.chat_json) as CallChatMessage[]) : [],
    report: call.summary_json ? (JSON.parse(call.summary_json) as CallReport) : null,
  });
  return { notes, names };
}
