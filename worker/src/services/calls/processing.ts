/**
 * After-call processing, driven by readiness rather than a single "finalize"
 * call — uploads can arrive late (a participant's phone finishes uploading on
 * the next sync), so every event that might unblock work calls
 * `advanceCallProcessing`:
 *
 *   call ended · piece closed · last chunk uploaded · piece transcribed · "Process now"
 *
 * It enqueues each ready piece once (status ready → queued is conditional),
 * and once nothing is in flight and the call has ended, the call counts as
 * transcribed ('done') and its LESSON takes over (services/calls/lessons.ts):
 * the report is written per lesson, over every call of it. A call from before
 * lessons (no lesson_id) still gets its own report (processing_status →
 * summarizing is conditional).
 */

import type { Env, CallProcessingMessage } from '../../types';
import { generateId } from '../cards';
import { getCall, getParticipants } from './store';
import { assemblePiece, getPiece, listPieces } from './recording';
import { transcribeAudio, pickTranscriber } from './transcribe';
import { writeCallReport, writeReport } from './report';
import { advanceLessonProcessing, getLesson, lessonCalls, lessonMaterial } from './lessons';

export async function advanceCallProcessing(env: Env, callId: string): Promise<void> {
  const call = await getCall(env.DB, callId);
  if (!call) return;
  const pieces = await listPieces(env.DB, callId);

  for (const piece of pieces) {
    if (piece.status !== 'ready') continue;
    const res = await env.DB
      .prepare(`UPDATE call_recording_pieces SET status = 'queued', updated_at = datetime('now') WHERE id = ? AND status = 'ready'`)
      .bind(piece.id)
      .run();
    if ((res.meta?.changes ?? 0) > 0) {
      piece.status = 'queued';
      await env.CALL_QUEUE.send({ kind: 'piece', pieceId: piece.id } satisfies CallProcessingMessage);
    }
  }

  if (call.status !== 'ended') return;
  const waiting = pieces.some((p) => p.status === 'recording');
  const inFlight = pieces.some((p) => p.status === 'ready' || p.status === 'queued' || p.status === 'transcribing');
  if (waiting) {
    await env.DB
      .prepare(`UPDATE calls SET processing_status = 'waiting_uploads' WHERE id = ? AND processing_status IN ('none', 'transcribing')`)
      .bind(callId)
      .run();
    return;
  }
  if (inFlight) {
    await env.DB
      .prepare(`UPDATE calls SET processing_status = 'transcribing' WHERE id = ? AND processing_status IN ('none', 'waiting_uploads')`)
      .bind(callId)
      .run();
    return;
  }
  if (call.lesson_id) {
    // Transcribed: the lesson's report (over all its calls) takes it from here.
    await env.DB
      .prepare(`UPDATE calls SET processing_status = 'done', processing_error = NULL WHERE id = ? AND processing_status IN ('none', 'waiting_uploads', 'transcribing')`)
      .bind(callId)
      .run();
    await advanceLessonProcessing(env, call.lesson_id);
    return;
  }
  const res = await env.DB
    .prepare(
      `UPDATE calls SET processing_status = 'summarizing', processing_error = NULL
        WHERE id = ? AND processing_status IN ('none', 'waiting_uploads', 'transcribing')`,
    )
    .bind(callId)
    .run();
  if ((res.meta?.changes ?? 0) > 0) {
    await env.CALL_QUEUE.send({ kind: 'report', callId } satisfies CallProcessingMessage);
  }
}

/** Queue job: the lesson report over every ended call of the lesson. */
export async function processLessonReport(env: Env, lessonId: string): Promise<void> {
  const lesson = await getLesson(env.DB, lessonId);
  if (!lesson || lesson.processing_status !== 'summarizing') return;
  const m = await lessonMaterial(env.DB, lessonId);
  const ended = (m?.calls ?? []).filter((c) => c.status === 'ended');
  const covered = JSON.stringify(ended.map((c) => c.id).sort());
  try {
    if (!m || ended.length === 0) throw new Error('No ended call in the lesson');
    const participants = await getParticipants(env.DB, ended[0]);
    const endedIds = new Set(ended.map((c) => c.id));
    const report = await writeReport(env, {
      call: ended[0],
      segments: m.segments.filter((s) => endedIds.has(s.call_id)),
      chat: m.chat,
      board: m.board,
      boardText: m.boardText,
      title: m.title,
      startedAt: m.startedAt,
      callCount: ended.length,
    }, participants);
    await env.DB
      .prepare(`UPDATE call_lessons SET summary_json = ?, processing_status = 'done', processing_error = NULL, report_call_ids = ? WHERE id = ?`)
      .bind(report ? JSON.stringify(report) : null, covered, lessonId)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calls] lesson report failed:', lessonId, message);
    await env.DB
      .prepare(`UPDATE call_lessons SET processing_status = 'failed', processing_error = ?, report_call_ids = ? WHERE id = ?`)
      .bind(message.slice(0, 500), covered, lessonId)
      .run();
  }
  // A call joined the lesson while this was written: write it again for all of them.
  await advanceLessonProcessing(env, lessonId);
}

/** Queue job: assemble one piece, transcribe it, store its segments. */
export async function processPiece(env: Env, pieceId: string): Promise<void> {
  const piece = await getPiece(env.DB, pieceId);
  if (!piece || (piece.status !== 'queued' && piece.status !== 'transcribing')) return;
  await env.DB
    .prepare(`UPDATE call_recording_pieces SET status = 'transcribing', attempts = attempts + 1, error = NULL, updated_at = datetime('now') WHERE id = ?`)
    .bind(pieceId)
    .run();
  try {
    const { bytes } = await assemblePiece(env, piece);
    const transcriber = pickTranscriber(env);
    const result = await transcribeAudio(env, transcriber, bytes, piece.mime_type);
    const stmts = [env.DB.prepare('DELETE FROM call_transcript_segments WHERE piece_id = ?').bind(pieceId)];
    for (const seg of result.segments) {
      const start = piece.started_at + Math.round(seg.start * 1000);
      const end = piece.started_at + Math.round(Math.max(seg.end, seg.start) * 1000);
      stmts.push(
        env.DB
          .prepare(
            `INSERT INTO call_transcript_segments (id, call_id, piece_id, user_id, start_ms, end_ms, text, language, pinyin, translation)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(generateId(), piece.call_id, pieceId, piece.user_id, start, end, seg.text, seg.language ?? null, seg.pinyin ?? null, seg.translation ?? null),
      );
    }
    stmts.push(
      env.DB
        .prepare(`UPDATE call_recording_pieces SET status = 'done', provider = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(result.provider, pieceId),
    );
    await env.DB.batch(stmts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calls] piece transcription failed:', pieceId, message);
    await env.DB
      .prepare(`UPDATE call_recording_pieces SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(message.slice(0, 500), pieceId)
      .run();
  }
  await advanceCallProcessing(env, piece.call_id);
}

/** Queue job: Claude's lesson report over the merged transcript (a call from before lessons). */
export async function processReport(env: Env, callId: string): Promise<void> {
  const call = await getCall(env.DB, callId);
  if (!call || call.processing_status !== 'summarizing') return;
  if (call.lesson_id) {
    // Queued before lessons existed: the lesson writes it now.
    await env.DB.prepare(`UPDATE calls SET processing_status = 'done' WHERE id = ?`).bind(callId).run();
    await advanceLessonProcessing(env, call.lesson_id, { force: true });
    return;
  }
  try {
    const participants = await getParticipants(env.DB, call);
    const report = await writeCallReport(env, call, participants);
    await env.DB
      .prepare(`UPDATE calls SET summary_json = ?, processing_status = 'done', processing_error = NULL WHERE id = ?`)
      .bind(report ? JSON.stringify(report) : null, callId)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calls] report failed:', callId, message);
    await env.DB
      .prepare(`UPDATE calls SET processing_status = 'failed', processing_error = ? WHERE id = ?`)
      .bind(message.slice(0, 500), callId)
      .run();
  }
}

/** "Retry": failed pieces go back to ready, a failed/done report is redone. */
export async function reprocessCall(env: Env, callId: string, opts: { pieces?: boolean; report?: boolean } = { pieces: true, report: true }): Promise<void> {
  if (opts.pieces) {
    await env.DB
      .prepare(`UPDATE call_recording_pieces SET status = 'ready', error = NULL, updated_at = datetime('now') WHERE call_id = ? AND status = 'failed'`)
      .bind(callId)
      .run();
  }
  const call = await getCall(env.DB, callId);
  // "Process now" on a lesson: every call of it (pieces of each, then the lesson report).
  const calls = call?.lesson_id ? await lessonCalls(env.DB, call.lesson_id) : call ? [call] : [];
  for (const c of calls) {
    if (opts.pieces && c.id !== callId) {
      await env.DB
        .prepare(`UPDATE call_recording_pieces SET status = 'ready', error = NULL, updated_at = datetime('now') WHERE call_id = ? AND status = 'failed'`)
        .bind(c.id)
        .run();
    }
    if (opts.report) {
      await env.DB.prepare(`UPDATE calls SET processing_status = 'none', processing_error = NULL WHERE id = ? AND status = 'ended'`).bind(c.id).run();
    }
  }
  if (call?.lesson_id && opts.report) {
    await env.DB.prepare(`UPDATE call_lessons SET processing_status = 'none', processing_error = NULL, report_call_ids = NULL WHERE id = ? AND processing_status <> 'summarizing'`).bind(call.lesson_id).run();
  }
  for (const c of calls) await advanceCallProcessing(env, c.id);
}

export async function handleCallQueueMessage(env: Env, body: CallProcessingMessage): Promise<void> {
  if (body.kind === 'piece') await processPiece(env, body.pieceId);
  else if (body.kind === 'report') await processReport(env, body.callId);
  else if (body.kind === 'lesson_report') await processLessonReport(env, body.lessonId);
}
