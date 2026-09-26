/**
 * Recording pieces and chunks. Each participant's browser records its own
 * microphone in pieces (a fresh MediaRecorder every few minutes, so every
 * piece is a standalone webm file) and uploads each piece in ~10 s chunks
 * from a local queue, so a dropped connection only delays the upload.
 *
 *   register piece → PUT chunk 0..n-1 → close { chunk_count }
 *
 * A piece is 'ready' once it is closed and every chunk is in R2; readiness
 * is what starts transcription (see processing.ts).
 */

import { CallError, type CallRow } from './store';

export const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_PIECE_CHUNKS = 200;
const ALLOWED_MIME = /^audio\/(webm|ogg|mp4|mpeg|wav)(;.*)?$/;

export type PieceStatus = 'recording' | 'ready' | 'queued' | 'transcribing' | 'done' | 'failed';

export interface PieceRow {
  id: string;
  call_id: string;
  user_id: string;
  piece_index: number;
  started_at: number;
  duration_ms: number | null;
  mime_type: string;
  chunk_count: number | null;
  status: PieceStatus;
  audio_key: string | null;
  size_bytes: number | null;
  provider: string | null;
  error: string | null;
  attempts: number;
}

export function chunkKey(callId: string, pieceId: string, idx: number): string {
  return `calls/${callId}/chunks/${pieceId}/${String(idx).padStart(4, '0')}`;
}

export function pieceAudioKey(callId: string, pieceId: string, mime: string): string {
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'webm';
  return `calls/${callId}/${pieceId}.${ext}`;
}

/** Base mime type without codec parameters ("audio/webm;codecs=opus" → "audio/webm"). */
export function baseMime(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

export async function getPiece(db: D1Database, pieceId: string): Promise<PieceRow | null> {
  return db.prepare('SELECT * FROM call_recording_pieces WHERE id = ?').bind(pieceId).first<PieceRow>();
}

export async function listPieces(db: D1Database, callId: string): Promise<PieceRow[]> {
  const rows = await db
    .prepare('SELECT * FROM call_recording_pieces WHERE call_id = ? ORDER BY user_id, piece_index')
    .bind(callId)
    .all<PieceRow>();
  return rows.results ?? [];
}

async function requireOwnPiece(db: D1Database, call: CallRow, pieceId: string, userId: string): Promise<PieceRow> {
  const piece = await getPiece(db, pieceId);
  if (!piece || piece.call_id !== call.id || piece.user_id !== userId) throw new CallError(404, 'Recording piece not found');
  return piece;
}

export interface RegisterPieceInput {
  id: string;
  piece_index: number;
  started_at: number;
  mime_type?: string;
}

/** Idempotent by the client-made id. */
export async function registerPiece(db: D1Database, call: CallRow, userId: string, input: RegisterPieceInput): Promise<PieceRow> {
  if (!input.id || !/^[A-Za-z0-9_-]{8,64}$/.test(input.id)) throw new CallError(400, 'A piece id is required');
  const index = Number(input.piece_index);
  const startedAt = Number(input.started_at);
  if (!Number.isInteger(index) || index < 0 || index > 10_000) throw new CallError(400, 'piece_index must be a non-negative integer');
  if (!Number.isFinite(startedAt) || startedAt <= 0) throw new CallError(400, 'started_at must be epoch ms');
  const mime = (input.mime_type || 'audio/webm').slice(0, 100);
  if (!ALLOWED_MIME.test(mime)) throw new CallError(400, 'Unsupported audio type');
  const existing = await getPiece(db, input.id);
  if (existing) {
    if (existing.call_id !== call.id || existing.user_id !== userId) throw new CallError(409, 'Piece id already used');
    return existing;
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO call_recording_pieces (id, call_id, user_id, piece_index, started_at, mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'recording')`,
    )
    .bind(input.id, call.id, userId, index, Math.round(startedAt), mime)
    .run();
  return (await getPiece(db, input.id))!;
}

/** Store one chunk (idempotent by index). Returns the piece after readiness is re-checked. */
export async function storeChunk(
  env: { DB: D1Database; AUDIO_BUCKET: R2Bucket },
  call: CallRow,
  userId: string,
  pieceId: string,
  idx: number,
  body: ArrayBuffer,
): Promise<PieceRow> {
  const piece = await requireOwnPiece(env.DB, call, pieceId, userId);
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_PIECE_CHUNKS) throw new CallError(400, 'Bad chunk index');
  if (body.byteLength === 0) throw new CallError(400, 'Empty chunk');
  if (body.byteLength > MAX_CHUNK_BYTES) throw new CallError(400, 'Chunk too large');
  if (piece.status !== 'recording' && piece.status !== 'ready') return piece; // already assembled — a retry after success
  const key = chunkKey(call.id, pieceId, idx);
  await env.AUDIO_BUCKET.put(key, body, { httpMetadata: { contentType: baseMime(piece.mime_type) } });
  await env.DB
    .prepare(
      `INSERT INTO call_recording_chunks (piece_id, idx, r2_key, size_bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT (piece_id, idx) DO UPDATE SET size_bytes = excluded.size_bytes`,
    )
    .bind(pieceId, idx, key, body.byteLength)
    .run();
  return refreshReadiness(env.DB, pieceId);
}

export async function closePiece(
  db: D1Database,
  call: CallRow,
  userId: string,
  pieceId: string,
  input: { chunk_count: number; duration_ms?: number },
): Promise<PieceRow> {
  const piece = await requireOwnPiece(db, call, pieceId, userId);
  const count = Number(input.chunk_count);
  if (!Number.isInteger(count) || count < 0 || count > MAX_PIECE_CHUNKS) throw new CallError(400, 'chunk_count must be an integer');
  const duration = Number(input.duration_ms);
  if (piece.chunk_count === null) {
    await db
      .prepare(`UPDATE call_recording_pieces SET chunk_count = ?, duration_ms = ?, updated_at = datetime('now') WHERE id = ? AND chunk_count IS NULL`)
      .bind(count, Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null, pieceId)
      .run();
  }
  return refreshReadiness(db, pieceId);
}

async function contiguousChunkCount(db: D1Database, pieceId: string): Promise<number> {
  const rows = await db.prepare('SELECT idx FROM call_recording_chunks WHERE piece_id = ? ORDER BY idx').bind(pieceId).all<{ idx: number }>();
  let n = 0;
  for (const r of rows.results ?? []) {
    if (r.idx !== n) break;
    n++;
  }
  return n;
}

/** recording → ready once closed and all chunks are in; a closed piece with 0 chunks is simply done. */
export async function refreshReadiness(db: D1Database, pieceId: string): Promise<PieceRow> {
  const piece = await getPiece(db, pieceId);
  if (!piece) throw new CallError(404, 'Recording piece not found');
  if (piece.status !== 'recording' || piece.chunk_count === null) return piece;
  if (piece.chunk_count === 0) {
    await db.prepare(`UPDATE call_recording_pieces SET status = 'done', updated_at = datetime('now') WHERE id = ? AND status = 'recording'`).bind(pieceId).run();
  } else if ((await contiguousChunkCount(db, pieceId)) >= piece.chunk_count) {
    await db.prepare(`UPDATE call_recording_pieces SET status = 'ready', updated_at = datetime('now') WHERE id = ? AND status = 'recording'`).bind(pieceId).run();
  } else {
    return piece;
  }
  return (await getPiece(db, pieceId))!;
}

/**
 * Pieces that will never be closed (the tab crashed, the phone died): close
 * them with whatever contiguous chunks arrived. Used by "Process now".
 */
export async function forceClosePieces(db: D1Database, callId: string): Promise<number> {
  const open = await db
    .prepare(`SELECT id FROM call_recording_pieces WHERE call_id = ? AND status = 'recording'`)
    .bind(callId)
    .all<{ id: string }>();
  let closed = 0;
  for (const { id } of open.results ?? []) {
    const n = await contiguousChunkCount(db, id);
    await db
      .prepare(`UPDATE call_recording_pieces SET chunk_count = ?, updated_at = datetime('now') WHERE id = ? AND status = 'recording'`)
      .bind(n, id)
      .run();
    await refreshReadiness(db, id);
    closed++;
  }
  return closed;
}

/**
 * Concatenate a piece's chunks into one file (MediaRecorder timeslice chunks
 * of one recording concatenate into a valid file), store it, delete the chunks.
 */
export async function assemblePiece(env: { DB: D1Database; AUDIO_BUCKET: R2Bucket }, piece: PieceRow): Promise<{ key: string; bytes: Uint8Array }> {
  if (piece.audio_key) {
    const existing = await env.AUDIO_BUCKET.get(piece.audio_key);
    if (existing) return { key: piece.audio_key, bytes: new Uint8Array(await existing.arrayBuffer()) };
  }
  const rows = await env.DB
    .prepare('SELECT idx, r2_key FROM call_recording_chunks WHERE piece_id = ? ORDER BY idx')
    .bind(piece.id)
    .all<{ idx: number; r2_key: string }>();
  const chunks = (rows.results ?? []).slice(0, piece.chunk_count ?? undefined);
  const parts: Uint8Array[] = [];
  for (const c of chunks) {
    const obj = await env.AUDIO_BUCKET.get(c.r2_key);
    if (!obj) throw new Error(`Chunk ${c.idx} missing from storage`);
    parts.push(new Uint8Array(await obj.arrayBuffer()));
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.byteLength;
  }
  const key = pieceAudioKey(piece.call_id, piece.id, piece.mime_type);
  await env.AUDIO_BUCKET.put(key, bytes, { httpMetadata: { contentType: baseMime(piece.mime_type) } });
  await env.DB
    .prepare(`UPDATE call_recording_pieces SET audio_key = ?, size_bytes = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(key, total, piece.id)
    .run();
  const keys = (rows.results ?? []).map((c) => c.r2_key);
  if (keys.length) {
    await env.AUDIO_BUCKET.delete(keys);
    await env.DB.prepare('DELETE FROM call_recording_chunks WHERE piece_id = ?').bind(piece.id).run();
  }
  return { key, bytes };
}
