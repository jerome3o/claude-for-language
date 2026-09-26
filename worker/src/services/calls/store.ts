/**
 * Video calls — rows and access. A call belongs to a tutor relationship
 * (either party may join, see and process it) or, with no relationship, to
 * its creator alone (a solo test call).
 */

import { generateId } from '../cards';
import { verifyRelationshipAccess, getOtherUserId } from '../relationships';
import { createConversation, sendMessage } from '../conversations';
import { fetchLastConversationId } from '../../db/tutor-dashboard-queries';
import type { BoardItem, CallChatMessage } from '@shared/calls';
import { CLAUDE_AI_USER_ID } from '../../types';

export class CallError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

export type CallStatus = 'live' | 'ended';
export type ProcessingStatus = 'none' | 'waiting_uploads' | 'transcribing' | 'summarizing' | 'done' | 'failed';

export interface CallRow {
  id: string;
  relationship_id: string | null;
  created_by: string;
  title: string | null;
  status: CallStatus;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  started_at: number | null;
  ended_at: number | null;
  board_json: string | null;
  chat_json: string | null;
  summary_json: string | null;
  created_at: string;
}

export interface CallParticipant {
  id: string;
  name: string | null;
  email: string;
  picture_url: string | null;
}

export async function getCall(db: D1Database, callId: string): Promise<CallRow | null> {
  return db.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first<CallRow>();
}

/** The user ids allowed into a call: both sides of the relationship, or the creator. */
export async function callMemberIds(db: D1Database, call: CallRow): Promise<string[]> {
  if (!call.relationship_id) return [call.created_by];
  const rel = await db
    .prepare('SELECT requester_id, recipient_id FROM tutor_relationships WHERE id = ?')
    .bind(call.relationship_id)
    .first<{ requester_id: string; recipient_id: string }>();
  return rel ? [rel.requester_id, rel.recipient_id] : [call.created_by];
}

/** Load a call the user may access, or throw 404 (never reveal someone else's call). */
export async function requireCall(db: D1Database, callId: string, userId: string): Promise<CallRow> {
  const call = await getCall(db, callId);
  if (!call) throw new CallError(404, 'Call not found');
  const members = await callMemberIds(db, call);
  if (!members.includes(userId)) throw new CallError(404, 'Call not found');
  return call;
}

export async function getParticipants(db: D1Database, call: CallRow): Promise<CallParticipant[]> {
  const ids = await callMemberIds(db, call);
  const rows = await db
    .prepare(`SELECT id, name, email, picture_url FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<CallParticipant>();
  return rows.results ?? [];
}

export interface CreateCallInput {
  relationship_id?: string | null;
  title?: string | null;
}

/**
 * Start a call. With a relationship, a line goes into its chat so the other
 * side sees a Join link (and the usual unread badge / notification fires).
 */
export async function createCall(
  db: D1Database,
  userId: string,
  input: CreateCallInput,
  opts: { joinUrl?: (callId: string) => string } = {},
): Promise<CallRow> {
  const relId = input.relationship_id || null;
  if (relId) {
    try {
      const rel = await verifyRelationshipAccess(db, relId, userId);
      if (getOtherUserId(rel, userId) === CLAUDE_AI_USER_ID) throw new CallError(400, "Claude can't take video calls (yet)");
    } catch (err) {
      if (err instanceof CallError) throw err;
      throw new CallError(404, 'Relationship not found or not active');
    }
  }
  const id = generateId();
  const title = (input.title || '').trim().slice(0, 120) || null;
  await db
    .prepare(`INSERT INTO calls (id, relationship_id, created_by, title, status) VALUES (?, ?, ?, ?, 'live')`)
    .bind(id, relId, userId, title)
    .run();
  if (relId && opts.joinUrl) {
    try {
      let conversationId = await fetchLastConversationId(db, relId);
      if (!conversationId) conversationId = (await createConversation(db, relId, userId, {})).id;
      await sendMessage(db, conversationId, userId, `📹 I started a video call — join here: ${opts.joinUrl(id)}`);
    } catch (err) {
      console.error('[calls] chat notice failed:', err);
    }
  }
  return (await getCall(db, id))!;
}

export interface CallListItem {
  id: string;
  relationship_id: string | null;
  created_by: string;
  title: string | null;
  status: CallStatus;
  processing_status: ProcessingStatus;
  started_at: number | null;
  ended_at: number | null;
  created_at: string;
  other_user_name: string | null;
  segment_count: number;
  has_summary: boolean;
}

/** Calls the user is part of, newest first (optionally one relationship's, or only live ones). */
export async function listCalls(
  db: D1Database,
  userId: string,
  opts: { relationshipId?: string; liveOnly?: boolean; limit?: number } = {},
): Promise<CallListItem[]> {
  const where: string[] = [
    `(c.created_by = ? OR c.relationship_id IN (
        SELECT id FROM tutor_relationships WHERE (requester_id = ? OR recipient_id = ?)))`,
  ];
  const whereParams: unknown[] = [userId, userId, userId];
  if (opts.relationshipId) {
    where.push('c.relationship_id = ?');
    whereParams.push(opts.relationshipId);
  }
  if (opts.liveOnly) where.push(`c.status = 'live'`);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await db
    .prepare(
      `SELECT c.id, c.relationship_id, c.created_by, c.title, c.status, c.processing_status, c.started_at, c.ended_at, c.created_at,
              (c.summary_json IS NOT NULL) AS has_summary,
              (SELECT COUNT(*) FROM call_transcript_segments s WHERE s.call_id = c.id) AS segment_count,
              (SELECT COALESCE(u.name, u.email) FROM tutor_relationships r
                 JOIN users u ON u.id = CASE WHEN r.requester_id = ? THEN r.recipient_id ELSE r.requester_id END
                WHERE r.id = c.relationship_id) AS other_user_name
         FROM calls c
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT ?`,
    )
    // Placeholders in text order: the CASE in the select list, the WHERE, the LIMIT.
    .bind(userId, ...whereParams, limit)
    .all<Omit<CallListItem, 'has_summary'> & { has_summary: number }>();
  return (rows.results ?? []).map((r) => ({ ...r, has_summary: Boolean(r.has_summary) }));
}

/** Room snapshot → D1 (the Durable Object calls this when people leave and when the call ends). */
export async function saveRoomSnapshot(
  db: D1Database,
  callId: string,
  snapshot: { board: BoardItem[]; chat: CallChatMessage[]; startedAt: number | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE calls SET board_json = ?, chat_json = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
    )
    .bind(JSON.stringify(snapshot.board), JSON.stringify(snapshot.chat), snapshot.startedAt, callId)
    .run();
}

/** Mark the call ended (idempotent). Returns true when this call did the transition. */
export async function markCallEnded(db: D1Database, callId: string, endedAt = Date.now()): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'live'`)
    .bind(endedAt, callId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deleteCallRows(db: D1Database, callId: string): Promise<string[]> {
  const keys: string[] = [];
  const pieces = await db.prepare('SELECT id, audio_key FROM call_recording_pieces WHERE call_id = ?').bind(callId).all<{ id: string; audio_key: string | null }>();
  for (const p of pieces.results ?? []) {
    if (p.audio_key) keys.push(p.audio_key);
    const chunks = await db.prepare('SELECT r2_key FROM call_recording_chunks WHERE piece_id = ?').bind(p.id).all<{ r2_key: string }>();
    for (const c of chunks.results ?? []) keys.push(c.r2_key);
  }
  const ids = (pieces.results ?? []).map((p) => p.id);
  const stmts = [
    db.prepare('DELETE FROM call_transcript_segments WHERE call_id = ?').bind(callId),
    db.prepare('DELETE FROM call_recording_pieces WHERE call_id = ?').bind(callId),
    db.prepare('DELETE FROM calls WHERE id = ?').bind(callId),
  ];
  for (const id of ids) stmts.push(db.prepare('DELETE FROM call_recording_chunks WHERE piece_id = ?').bind(id));
  await db.batch(stmts);
  return keys;
}
